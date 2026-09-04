"""
Quant Agent Config — fork of alpaca-hackathon/agent/config.py:27 + Ai_Finance_Syariah/backend/config.py:35
Env-driven, no secrets in repo. AUTO_TRADE_THRESHOLD is the only knob judges need to touch.
"""
import os

def _load_dotenv(path=".env"):
    if not os.path.exists(path):
        # also try parent quant-agent/.env
        return
    for line in open(path):
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k,v=line.split("=",1)
        if k.strip() not in os.environ:
            os.environ[k.strip()]=v.strip().strip('"').strip("'")

_load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
_load_dotenv(".env")
_load_dotenv(os.path.join(os.path.dirname(__file__), "../execution/.env"))

class Settings:
    def __init__(self):
        # Thetanuts — paper via execution/.env (Base 8453, no Alpaca keys needed)
        self.thetanuts_rpc_url = os.getenv("THETANUTS_RPC_URL", "https://mainnet.base.org")
        self.gate_service_url = os.getenv("GATE_SERVICE_URL", "http://127.0.0.1:8787")
        self.execution_api_url = os.getenv("EXECUTION_API_URL", "http://127.0.0.1:8790")
        # Shariah universe — Thetanuts uses data/crypto-underlying-universe.json (BTC/ETH/SOL/AVAX/XRP/BNB)
        self.shariah_universe_path = os.getenv("SHARIAH_UNIVERSE_PATH", os.path.join(os.path.dirname(__file__), "../data/crypto-underlying-universe.json"))
        # Risk caps — alpaca-hackathon/.env.example:20 + Ai_Finance_Syariah/backend/risk_checks.py:3
        self.max_orders_per_day = int(os.getenv("MAX_ORDERS_PER_DAY", "5"))
        self.max_position_pct = float(os.getenv("MAX_POSITION_PCT", "40.0"))
        self.max_sector_pct = float(os.getenv("MAX_SECTOR_EXPOSURE_PCT", "15.0"))
        # Quant threshold — THE knob per spec
        self.auto_trade_threshold = float(os.getenv("AUTO_TRADE_THRESHOLD", "0.80"))
        # Other
        self.dry_run = os.getenv("DRY_RUN", "false").lower() in ("1","true","yes")

_settings=None
def get_settings():
    global _settings
    if _settings is None:
        _settings=Settings()
    return _settings

if __name__=="__main__":
    s=get_settings()
    print(f"auto_trade_threshold={s.auto_trade_threshold}")
    print(f"thetannuts_rpc={s.thetanuts_rpc_url[:40]}...")
    print(f"execution_api={s.execution_api_url}")
    print(f"max_position_pct={s.max_position_pct}")
