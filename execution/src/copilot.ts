/**
 * The natural-language layer in front of the deterministic gate chain.
 *
 * Two narrow, single-purpose LLM calls -- nothing more:
 *   1. parseIntent    -- free text -> a structured trade intent (or a
 *                         clarification request if it can't be parsed
 *                         confidently). Extraction only, never a decision.
 *   2. explainDecision -- the gate chain's own JSON verdict -> a plain-
 *                         language explanation, grounded strictly in that
 *                         JSON. Translation only, never a new rule.
 *
 * Neither call ever touches the gate chain's verdict, the signer, or
 * /execute. This file cannot approve a trade and cannot cause one to be
 * signed -- see server.ts's /converse route for how it's wired: propose-only,
 * same trust boundary as /propose. The LLM stays firmly outside the trust
 * boundary, per CLAUDE.md's non-negotiable rule -- this module is the
 * "explain" half of the copilot, not a second gate.
 *
 * Uses OpenRouter (OpenAI-compatible chat completions, not the native
 * Anthropic Messages API) via OPENROUTER_API_KEY. Because OpenRouter's
 * schema-enforcement support varies by model, this does NOT rely on the
 * provider to guarantee valid structured output -- every response is
 * re-validated locally with Zod, and anything that fails validation or
 * doesn't parse falls back to clarification_needed rather than being
 * trusted. Same "never trust the LLM's raw output" posture as the rest of
 * this codebase applies here too.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import OpenAI from "openai";
import { z } from "zod";
import { SUPPORTED_ASSETS, type SupportedAsset, type OptionType } from "./tradeResolver.js";

// --- Fiqh-rationale grounding -------------------------------------------
//
// The gate chain's own JSON verdict only carries status/reason/category --
// enough to enforce the rule, not enough to explain *why* it exists. The
// actual reasoning (Riba/Gharar/Maysir citations, per-asset rationale) lives
// in data/crypto-underlying-universe.json, the same dataset
// gate-chain/underlying_screen.py itself screens against. Loading it here
// lets explainDecision() ground its explanation in that real, reviewed text
// instead of just paraphrasing gate_summary's bare status fields -- this is
// what actually makes the copilot explain Islamic finance reasoning rather
// than describe a JSON object. Read-only, additive to the explanation layer
// only -- this never touches or re-implements the compliance decision
// itself, which stays exclusively gate-chain's.
interface UnderlyingRecord {
  symbol: string;
  asset_name: string;
  category: string;
  shariah_status: string;
  rationale: string;
  restrictions?: string[];
}

let underlyingUniverseCache: UnderlyingRecord[] | null = null;

function loadUnderlyingUniverse(): UnderlyingRecord[] {
  if (underlyingUniverseCache) return underlyingUniverseCache;
  const here = dirname(fileURLToPath(import.meta.url));
  const datasetPath = join(here, "..", "..", "data", "crypto-underlying-universe.json");
  try {
    const raw = readFileSync(datasetPath, "utf-8");
    const parsed = JSON.parse(raw) as { records: UnderlyingRecord[] };
    underlyingUniverseCache = parsed.records;
  } catch {
    // Explanation-layer enrichment only -- if the dataset can't be read,
    // fall back to explaining from gate_summary alone rather than failing
    // the request. The compliance decision itself was already made by
    // gate-chain before this file ever runs.
    underlyingUniverseCache = [];
  }
  return underlyingUniverseCache;
}

function getRationale(symbol: string | undefined | null): UnderlyingRecord | null {
  if (!symbol) return null;
  const universe = loadUnderlyingUniverse();
  return universe.find((r) => r.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}

// gpt-4o-mini: cheap, fast, and reliably returns well-formed JSON for a
// narrow extraction/summarization task like this one -- no reasoning depth
// needed. Override via OPENROUTER_MODEL (OpenRouter's provider/model-name
// format, e.g. "anthropic/claude-3.5-haiku") if you want to try another.
const MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

// Built lazily, inside each call -- never at module load. The OpenAI SDK's
// constructor throws synchronously when no key is present; constructing it
// eagerly at import time would crash the whole API process (including
// unrelated routes like /orders and /propose) if OPENROUTER_API_KEY is
// unset, instead of failing only the one request that actually needs it.
// Same reasoning as why server.ts builds the signer client inside the
// /execute handler rather than at module scope.
function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set -- the copilot's natural-language layer is unavailable.");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      // OpenRouter's optional attribution headers -- harmless if left as
      // placeholders, worth pointing at the real repo/site once you have one.
      "HTTP-Referer": process.env.OPENROUTER_APP_URL ?? "https://github.com/mubaThetanuts_Track2",
      "X-Title": "Thetanuts Shariah Risk Copilot",
    },
  });
}

const TradeIntentSchema = z.object({
  understood: z.boolean(),
  clarification: z.string().nullable(),
  asset: z.enum(SUPPORTED_ASSETS as unknown as [SupportedAsset, ...SupportedAsset[]]).nullable(),
  optionType: z.enum(["put", "call"]).nullable(),
  spendUsdc: z.number().nullable(),
});

export type ParsedTradeIntent = z.infer<typeof TradeIntentSchema>;

const CLARIFICATION_FALLBACK: ParsedTradeIntent = {
  understood: false,
  clarification: `I couldn't parse that as a trade request. Try something like "buy an ETH put with 2 dollars".`,
  asset: null,
  optionType: null,
  spendUsdc: null,
};

const INTENT_SYSTEM_PROMPT =
  "You extract a structured options-trade intent from a user's message. " +
  `This system can ONLY buy (long, fully-paid) a single vanilla put or call on one of ${SUPPORTED_ASSETS.join("/")}, ` +
  "sized by a USD amount to spend. It cannot sell/write options, cannot build spreads or multi-leg structures, " +
  "and cannot trade any other asset. If the message asks for any of those, or doesn't state a dollar amount, " +
  "set understood=false and ask one short clarifying question -- never guess a value the user didn't give you.\n\n" +
  "Respond with ONLY a JSON object, no other text, matching exactly this shape:\n" +
  '{"understood": boolean, "clarification": string | null, ' +
  `"asset": ${SUPPORTED_ASSETS.map((a) => `"${a}"`).join(" | ")} | null, ` +
  '"optionType": "put" | "call" | null, "spendUsdc": number | null}\n' +
  "clarification is null when understood is true. asset/optionType/spendUsdc are null when understood is false.";

/**
 * Extraction only. This never sees gate-chain output and never decides
 * anything -- it either produces a fully-specified BUY intent or asks for
 * clarification. Any malformed/unparseable response fails safe to a
 * clarification request rather than being guessed at or retried blindly.
 */
export async function parseIntent(prompt: string): Promise<ParsedTradeIntent> {
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 300,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return CLARIFICATION_FALLBACK;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return CLARIFICATION_FALLBACK;
  }

  const result = TradeIntentSchema.safeParse(parsedJson);
  return result.success ? result.data : CLARIFICATION_FALLBACK;
}

interface GateDecisionForExplanation {
  decision: "READY_FOR_EXECUTION" | "BLOCKED";
  blockers: string[];
  gate_summary: Record<string, unknown>;
}

// gate_summary comes typed as Record<string, unknown> from gateClient.ts (it
// crosses an HTTP boundary from the Python gate chain) -- these are narrow,
// defensive reads for explanation-grounding only, not a re-validation of
// anything the gate chain already decided.
function readStringField(obj: unknown, path: string[]): string | undefined {
  let current: unknown = obj;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Translation only, strictly grounded in the gate chain's own JSON plus the
 * reviewed dataset rationale for the specific tokens involved -- the system
 * prompt explicitly forbids inventing anything beyond those two sources, so
 * this can go deeper than paraphrasing status fields (it can say *why*, per
 * the actual reviewed reasoning) without ever drifting into inventing fiqh
 * reasoning gate-chain never applied.
 */
export async function explainDecision(
  intent: { asset: SupportedAsset; optionType: OptionType; spendUsdc: number },
  decision: GateDecisionForExplanation,
): Promise<string> {
  const underlyingSymbol = readStringField(decision.gate_summary, ["underlying_screen", "symbol"]) ?? intent.asset;
  const collateralSymbol =
    readStringField(decision.gate_summary, ["collateral_gate", "token_screen", "symbol"]) ??
    readStringField(decision.gate_summary, ["collateral_gate", "token"]);

  const rationale = {
    underlying: getRationale(underlyingSymbol),
    collateral: getRationale(collateralSymbol),
  };

  const completion = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You explain a Shariah compliance/risk gate's verdict to a non-technical user in 3-5 plain-language " +
          "sentences. You are given the exact JSON the gate produced, PLUS the reviewed Shariah rationale on " +
          "file for the specific tokens involved (from a dataset the gate itself screens against). Use that " +
          "rationale to explain the actual fiqh reasoning (Riba/interest, Gharar/uncertainty, Maysir/gambling) " +
          "behind the verdict where it's provided -- don't just restate 'compliant' or 'rejected', say why, in " +
          "the dataset's own terms. Ground every claim in gate_summary/blockers or the provided rationale text " +
          "only -- if no rationale is provided for a token, don't invent one; explain from gate_summary alone. " +
          "If decision is READY_FOR_EXECUTION, say so plainly and don't manufacture extra warnings. If BLOCKED, " +
          "name the specific gate(s) that failed and their reason, grounded in the rationale text when present.",
      },
      {
        role: "user",
        content: JSON.stringify({ requested_trade: intent, gate_result: decision, shariah_rationale: rationale }),
      },
    ],
  });

  return completion.choices[0]?.message?.content ?? "(no explanation generated)";
}
