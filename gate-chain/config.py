"""Local configuration for the deterministic gate chain.

Mirrors the pattern in the Ai_Finance_Syariah backend/config.py: env-driven,
committed defaults so a fresh clone runs without extra setup, fail-closed on
malformed input.
"""

from dataclasses import dataclass
from pathlib import Path
import os

GATE_DIR = Path(__file__).resolve().parent
REPO_ROOT = GATE_DIR.parent

DEFAULT_UNDERLYING_UNIVERSE_PATH = REPO_ROOT / "data" / "crypto-underlying-universe.json"


def _load_local_env() -> None:
    env_file = GATE_DIR / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_local_env()


@dataclass(frozen=True)
class Settings:
    underlying_universe_path: str
    chain_id: int
    allowed_collateral_tokens: frozenset[str]
    allowed_structures: frozenset[str]
    rejected_structures: frozenset[str]
    max_notional_usd_per_trade: float
    max_notional_usd_per_day: float
    max_orders_per_day: int
    min_abs_delta: float
    max_abs_delta: float
    require_mainnet: bool


def _float_env(name: str, default: str, *, minimum: float | None = None) -> float:
    try:
        value = float(os.getenv(name, default))
    except ValueError as exc:
        raise ValueError(f"{name} must be numeric") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _int_env(name: str, default: str, *, minimum: int | None = None) -> int:
    try:
        value = int(os.getenv(name, default))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def load_settings() -> Settings:
    return Settings(
        underlying_universe_path=os.getenv(
            "UNDERLYING_UNIVERSE_PATH", str(DEFAULT_UNDERLYING_UNIVERSE_PATH)
        ),
        chain_id=_int_env("THETANUTS_CHAIN_ID", "8453"),  # Base mainnet
        allowed_collateral_tokens=frozenset(
            item.strip().upper()
            for item in os.getenv("ALLOWED_COLLATERAL_TOKENS", "USDC,WETH,cbBTC").split(",")
            if item.strip()
        ),
        allowed_structures=frozenset(
            item.strip().upper()
            for item in os.getenv(
                "ALLOWED_STRUCTURES", "VANILLA_PUT,VANILLA_CALL,PUT_SPREAD,CALL_SPREAD"
            ).split(",")
            if item.strip()
        ),
        rejected_structures=frozenset(
            item.strip().upper()
            for item in os.getenv(
                "REJECTED_STRUCTURES",
                "IRON_CONDOR,RANGER,PUT_FLY,CALL_FLY,PUT_CONDOR,CALL_CONDOR",
            ).split(",")
            if item.strip()
        ),
        max_notional_usd_per_trade=_float_env("MAX_NOTIONAL_USD_PER_TRADE", "25", minimum=0),
        max_notional_usd_per_day=_float_env("MAX_NOTIONAL_USD_PER_DAY", "100", minimum=0),
        max_orders_per_day=_int_env("MAX_ORDERS_PER_DAY", "5", minimum=1),
        min_abs_delta=_float_env("MIN_ABS_DELTA", "0.10", minimum=0),
        max_abs_delta=_float_env("MAX_ABS_DELTA", "0.90", minimum=0),
        require_mainnet=os.getenv("REQUIRE_MAINNET", "true").strip().lower() == "true",
    )
