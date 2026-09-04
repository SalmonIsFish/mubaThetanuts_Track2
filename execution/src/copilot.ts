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

// Two independent provider configs, not one shared MODEL -- the two calls in
// this file have very different latency sensitivity. parseIntent runs on
// every single message, including every round of a multi-turn clarification
// exchange, so its latency is what the user directly feels while chatting:
// it stays on a fast provider (OpenRouter/gpt-4o-mini by default).
// explainDecision runs exactly once, after the gate chain has already
// produced its verdict -- the frontend renders the structured PASS/FAIL
// result (gate_summary/blockers/decision) immediately, before this call's
// prose even arrives, so a slower model here costs far less felt latency.
// That's where a larger/cheaper/shared-capacity model (e.g. Qwen via
// Featherless) belongs. Point EXPLAIN_LLM_* at OPENROUTER_* too if you'd
// rather keep both calls on the same fast provider.
//
// Model choice matters little for correctness either way -- both calls are
// narrow extraction/translation (see file header), not reasoning, and every
// response is re-validated with Zod regardless of which model produced it.
interface ProviderConfig {
  baseURL: string;
  apiKey: string | undefined;
  model: string;
  disableThinking: boolean;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const EXTRACT_CONFIG: ProviderConfig = {
  baseURL: process.env.PARSE_LLM_BASE_URL ?? OPENROUTER_BASE_URL,
  apiKey: process.env.PARSE_LLM_API_KEY ?? process.env.OPENROUTER_API_KEY,
  model: process.env.PARSE_LLM_MODEL ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
  disableThinking: process.env.PARSE_LLM_DISABLE_THINKING === "true",
};

const EXPLAIN_CONFIG: ProviderConfig = {
  baseURL: process.env.EXPLAIN_LLM_BASE_URL ?? process.env.LLM_BASE_URL ?? EXTRACT_CONFIG.baseURL,
  apiKey: process.env.EXPLAIN_LLM_API_KEY ?? process.env.LLM_API_KEY ?? EXTRACT_CONFIG.apiKey,
  model: process.env.EXPLAIN_LLM_MODEL ?? process.env.LLM_MODEL ?? EXTRACT_CONFIG.model,
  disableThinking:
    process.env.EXPLAIN_LLM_DISABLE_THINKING === "true" || process.env.LLM_DISABLE_THINKING === "true",
};

// Hybrid-reasoning models (e.g. Qwen3) can emit a <think>...</think> block
// before the actual answer unless explicitly told not to -- for parseIntent
// that would break the strict JSON.parse() of the response body. Harmless
// no-op for providers/models without a thinking mode to disable.
type ExtraChatParams = { chat_template_kwargs?: { enable_thinking: boolean } };
function extraChatParams(config: ProviderConfig): ExtraChatParams {
  return config.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {};
}

// Built lazily, inside each call -- never at module load. The OpenAI SDK's
// constructor throws synchronously when no key is present; constructing it
// eagerly at import time would crash the whole API process (including
// unrelated routes like /orders and /propose) if no key is set, instead of
// failing only the one request that actually needs it. Same reasoning as why
// server.ts builds the signer client inside the /execute handler rather than
// at module scope.
function getClient(config: ProviderConfig): OpenAI {
  if (!config.apiKey) {
    throw new Error(
      "No API key configured for this provider (PARSE_LLM_API_KEY/EXPLAIN_LLM_API_KEY/LLM_API_KEY/OPENROUTER_API_KEY) -- the copilot's natural-language layer is unavailable.",
    );
  }
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.baseURL.includes("openrouter.ai")
      ? {
          // OpenRouter's optional attribution headers -- harmless if left as
          // placeholders, worth pointing at the real repo/site once you have one.
          "HTTP-Referer": process.env.OPENROUTER_APP_URL ?? "https://github.com/mubaThetanuts_Track2",
          "X-Title": "Thetanuts Shariah Risk Copilot",
        }
      : undefined,
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
  "You extract a structured options-trade intent from a user's message, which may be only one piece of a " +
  "multi-turn exchange (e.g. the user might say just \"2 dollars\" or just \"ETH\" in isolation, answering a " +
  "clarifying question you can't see). " +
  `This system can ONLY buy (long, fully-paid) a single vanilla put or call on one of ${SUPPORTED_ASSETS.join("/")}, ` +
  "sized by a USD amount to spend. It cannot sell/write options, cannot build spreads or multi-leg structures, " +
  "and cannot trade any other asset.\n\n" +
  "Extract asset/optionType/spendUsdc independently -- set each one whenever the message states it clearly, " +
  "REGARDLESS of whether the other fields are also present. Never leave a clearly-stated field null just " +
  "because the message doesn't mention everything. Never guess a value the message doesn't state.\n\n" +
  "Set understood=true only if the message clearly states asset AND optionType AND spendUsdc together. " +
  "Otherwise set understood=false and clarification to one short question about whichever of those three " +
  "the message does NOT state (extracted fields still get returned, not nulled out, even when understood " +
  "is false). If the message asks to sell/write, build a spread, or trade an unsupported asset, set " +
  "understood=false and explain why in clarification, leaving the unsupported field null.\n\n" +
  "If the message asks YOU to pick, recommend, or suggest which asset/direction to trade (e.g. \"what should " +
  "I buy\", \"suggest one for me\", \"give me a good stock\"), do not treat that as a partial trade -- set " +
  "understood=false and clarification to a short, direct explanation that you don't make trade picks or give " +
  "investment advice; you only screen and execute a trade the user has already decided on. Ask them to name " +
  "the asset, put/call, and USD amount themselves. Leave asset/optionType/spendUsdc null unless the SAME " +
  "message also separately states one of them.\n\n" +
  "Respond with ONLY a JSON object, no other text, matching exactly this shape:\n" +
  '{"understood": boolean, "clarification": string | null, ' +
  `"asset": ${SUPPORTED_ASSETS.map((a) => `"${a}"`).join(" | ")} | null, ` +
  '"optionType": "put" | "call" | null, "spendUsdc": number | null}\n' +
  "clarification is null only when understood is true.";

/**
 * Extraction only. This never sees gate-chain output and never decides
 * anything -- it either produces a fully-specified BUY intent or asks for
 * clarification. Any malformed/unparseable response fails safe to a
 * clarification request rather than being guessed at or retried blindly.
 */
export async function parseIntent(prompt: string): Promise<ParsedTradeIntent> {
  const completion = await getClient(EXTRACT_CONFIG).chat.completions.create({
    model: EXTRACT_CONFIG.model,
    max_tokens: 300,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    ...extraChatParams(EXTRACT_CONFIG),
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

  const completion = await getClient(EXPLAIN_CONFIG).chat.completions.create({
    model: EXPLAIN_CONFIG.model,
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
    ...extraChatParams(EXPLAIN_CONFIG),
  });

  return completion.choices[0]?.message?.content ?? "(no explanation generated)";
}
