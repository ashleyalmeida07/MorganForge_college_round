"""Application settings, loaded from environment / backend/.env."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # Solana
    solana_rpc_url: str = "https://api.devnet.solana.com"
    program_id: str = "ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1"
    zk_program_id: str = "A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv"
    cluster: str = "devnet"
    provider_keypair_json: str = ""
    verifier_keypairs_json: str = ""
    admin_keypair_json: str = ""
    requester_keypair_json: str = ""

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""

    # Pinata / IPFS
    pinata_api_key: str = ""
    pinata_api_secret: str = ""
    pinata_jwt: str = ""
    pinata_gateway: str = ""

    # App
    frontend_origin: str = "http://localhost:3000"
    admin_emails: str = "support@arhamfintech.ai"
    workers_enabled: bool = True
    provider_interval_secs: int = 8
    verifier_interval_secs: int = 8
    finalizer_interval_secs: int = 15
    indexer_interval_secs: int = 10
    audit_anchor_every: int = 20
    fuel_limit: int = 50_000_000
    groq_api_key: str = ""
    anthropic_api_key: str = ""

    @property
    def admin_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
