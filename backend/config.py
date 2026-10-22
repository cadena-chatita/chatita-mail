"""
Chatita Mail v3.0 — Configuration
Centralized settings loaded from environment variables.
"""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Server ──────────────────────────────────────────────
    app_name: str = "Chatita Mail"
    app_version: str = "3.0.0-alpha"
    environment: Literal["development", "production"] = "development"
    port: int = 8000
    secret_key: str = "change-me-in-production"

    # ── Database ────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://manuelcadena@localhost:5432/chatita_mail"
    database_url_sync: str = "postgresql://manuelcadena@localhost:5432/chatita_mail"
    redis_url: str = "redis://localhost:6379/0"

    # ── AION Brain ──────────────────────────────────────────
    # Mode: "http" (recommended for prod) or "stdio" (local MCP)
    aion_mode: Literal["http", "stdio"] = "http"
    aion_brain_url: str = "http://localhost:3100"
    aion_brain_mcp_path: str = "/opt/aion-brain/mcp-server.js"
    aion_timeout_seconds: int = 60
    # API key sent as X-API-Key to AION Brain (required in prod; local dev may
    # leave empty if AION_AUTH_DISABLED=1 on the server).
    aion_api_key: str = ""
    # If AION Brain is unreachable, fall back to a local heuristic
    aion_allow_fallback: bool = True

    # ── Email Accounts ──────────────────────────────────────
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_refresh_token: str = ""
    icloud_username: str = ""
    icloud_app_password: str = ""

    # ── Google Workspace ────────────────────────────────────
    # Path to the service-account JSON key (Domain-Wide Delegation).
    # Reuses Chatita's existing service account by default.
    # Zoom (Server-to-Server OAuth). Optional: without them the "Zoom" option of the calendar is simply unavailable.
    zoom_account_id: str = ""
    zoom_client_id: str = ""
    zoom_client_secret: str = ""
    calendar_timezone: str = "America/Mexico_City"
    google_service_account_json: str = "/Users/manuelcadena/chatita-local/chatita-service-account.json"
    # Mailbox to impersonate via DWD (Manny's primary inbox).
    gmail_impersonate_subject: str = "jose@manuelcadena.com"

    # ── Multi-account OAuth + standalone login (mail.chatita.ai) ──
    # Fernet key (urlsafe base64, 32 bytes) used to encrypt stored credentials.
    mail_cred_key: str = ""
    # Public base URL used to build OAuth redirect URIs.
    public_base_url: str = "https://mail.chatita.ai"
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    ms_client_id: str = ""
    ms_client_secret: str = ""
    ms_tenant: str = "common"
    # Comma-separated emails allowed to sign in to the standalone app.
    login_allowed_emails: str = ""
    session_cookie_name: str = "chatita_mail_session"
    session_ttl_hours: int = 24 * 30

    # ── Communication ───────────────────────────────────────
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # ── Voice replies (T4.1 — ElevenLabs TTS) ───────────────
    # Key/voice live in the shared root .env; empty disables the voice endpoint.
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    elevenlabs_model_id: str = "eleven_multilingual_v2"

    # ── Embeddings (semantic search / RAG) ──────────────────
    # BGE-M3 (1024-dim) via HuggingFace Inference Router. Matches the pgvector
    # column dimension declared in scripts/setup_db.py.
    hf_token: str = ""
    embedding_model: str = "BAAI/bge-m3"
    embedding_dim: int = 1024
    # Optional explicit endpoint override; if empty it is derived from the model.
    embedding_url: str = ""

    # ── Classification thresholds (research-driven) ─────────
    # Jáñez-Martino: lexical prefilter is fast/cheap; escalate to LLM only if ambiguous
    lexical_confidence_threshold: float = 0.90
    # Chikodi 2025: production target accuracy
    min_classification_accuracy: float = 0.92
    # Phishing risk thresholds
    phishing_quarantine_threshold: int = 70
    phishing_block_threshold: int = 90

    # ── Task generation (Quipu DISENO_07: fewer, more recent, higher value) ──
    # Only emails received on/after this instant generate tasks automatically.
    task_extract_since: str = "2026-10-01T00:00:00+00:00"
    # Hard cap of tasks created per email (highest value first).
    task_max_per_email: int = 3
    # Same obligation from the same sender is not recreated within this window,
    # whatever its status (pending, done or dismissed).
    task_dedupe_days: int = 30

    # ── Logging ─────────────────────────────────────────────
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Return cached settings singleton."""
    return Settings()


settings = get_settings()
