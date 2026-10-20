"""
Chatita Mail v3.0 — ORM Entities (8 core tables).

Tables:
  email_accounts   — connected mailboxes (Gmail, iCloud, IMAP)
  emails           — unified email store
  classifications  — 2-stage classification results (lexical + LLM)
  security_events  — phishing / prompt-injection findings
  tasks            — extracted actionable tasks (Phase 2)
  commitments      — tracked commitments (Phase 2)
  style_profiles   — learned writing style per user (Phase 3)
  embeddings       — pgvector semantic index
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.db import Base


# ── Enums ───────────────────────────────────────────────────
class EmailCategory(str, enum.Enum):
    CRITICAL = "CRITICAL"
    IMPORTANT = "IMPORTANT"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    SPAM = "SPAM"
    NOISE = "NOISE"
    UNCLASSIFIED = "UNCLASSIFIED"


class EmailStatus(str, enum.Enum):
    INBOX = "INBOX"
    ARCHIVED = "ARCHIVED"
    QUARANTINED = "QUARANTINED"
    BLOCKED = "BLOCKED"
    DELETED = "DELETED"
    SENT = "SENT"  # outbound mail persisted after a successful gmail.send


class RiskLevel(str, enum.Enum):
    SAFE = "safe"
    SUSPICIOUS = "suspicious"
    DANGEROUS = "dangerous"


class AccountProvider(str, enum.Enum):
    GMAIL = "gmail"
    ICLOUD = "icloud"
    IMAP = "imap"
    MICROSOFT = "microsoft"


def _uuid() -> str:
    return str(uuid.uuid4())


# ── email_accounts ──────────────────────────────────────────
class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    provider: Mapped[AccountProvider] = mapped_column(Enum(AccountProvider))
    email_address: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Gmail incremental sync anchor (users.history.list startHistoryId)
    last_history_id: Mapped[str | None] = mapped_column(String(64))
    # idle | running | error — surfaced by /sync/status for long backfills
    sync_status: Mapped[str | None] = mapped_column(String(32), default="idle")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # ── Multi-account (settings UI) ─────────────────────────
    # auth_type: dwd (service-account delegation) | oauth | password
    auth_type: Mapped[str | None] = mapped_column(String(16))
    # connected | pending_auth | error | disabled
    status: Mapped[str | None] = mapped_column(String(16), default="connected")
    color: Mapped[str | None] = mapped_column(String(9))
    # Fernet-encrypted JSON with refresh/access tokens or IMAP password
    credentials_enc: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(Text)
    imap_host: Mapped[str | None] = mapped_column(String(255))
    imap_port: Mapped[int | None] = mapped_column(Integer)
    smtp_host: Mapped[str | None] = mapped_column(String(255))
    smtp_port: Mapped[int | None] = mapped_column(Integer)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    emails: Mapped[list[Email]] = relationship(back_populates="account", cascade="all, delete-orphan")


# ── emails ──────────────────────────────────────────────────
class Email(Base):
    __tablename__ = "emails"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(ForeignKey("email_accounts.id", ondelete="CASCADE"), index=True)

    # Provider identifiers
    provider_message_id: Mapped[str] = mapped_column(String(512), index=True)
    thread_id: Mapped[str | None] = mapped_column(String(512), index=True)

    # Headers
    from_address: Mapped[str] = mapped_column(String(320), index=True)
    from_name: Mapped[str | None] = mapped_column(String(255))
    to_addresses: Mapped[list | None] = mapped_column(JSON)
    cc_addresses: Mapped[list | None] = mapped_column(JSON)
    subject: Mapped[str | None] = mapped_column(Text)

    # Content
    body_text: Mapped[str | None] = mapped_column(Text)
    body_html: Mapped[str | None] = mapped_column(Text)
    snippet: Mapped[str | None] = mapped_column(Text)
    attachments: Mapped[list | None] = mapped_column(JSON)

    # State
    status: Mapped[EmailStatus] = mapped_column(Enum(EmailStatus), default=EmailStatus.INBOX, index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped[EmailAccount] = relationship(back_populates="emails")
    classification: Mapped[Classification | None] = relationship(
        back_populates="email", cascade="all, delete-orphan", uselist=False
    )
    security_event: Mapped[SecurityEvent | None] = relationship(
        back_populates="email", cascade="all, delete-orphan", uselist=False
    )


# ── classifications ─────────────────────────────────────────
class Classification(Base):
    __tablename__ = "classifications"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email_id: Mapped[str] = mapped_column(ForeignKey("emails.id", ondelete="CASCADE"), unique=True, index=True)

    category: Mapped[EmailCategory] = mapped_column(Enum(EmailCategory), index=True)
    confidence: Mapped[float] = mapped_column(Float)
    # "lexical" (stage 1) or "llm" (stage 2)
    stage: Mapped[str] = mapped_column(String(20))
    reasoning: Mapped[str | None] = mapped_column(Text)  # XAI explanation
    is_newsletter: Mapped[bool] = mapped_column(Boolean, default=False)
    unsubscribe_url: Mapped[str | None] = mapped_column(Text)

    # Human feedback (temporal drift / active learning)
    user_corrected_category: Mapped[EmailCategory | None] = mapped_column(Enum(EmailCategory))
    corrected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    email: Mapped[Email] = relationship(back_populates="classification")


# ── security_events ─────────────────────────────────────────
class SecurityEvent(Base):
    __tablename__ = "security_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email_id: Mapped[str] = mapped_column(ForeignKey("emails.id", ondelete="CASCADE"), unique=True, index=True)

    risk_score: Mapped[int] = mapped_column(Integer, index=True)
    risk_level: Mapped[RiskLevel] = mapped_column(Enum(RiskLevel), index=True)
    event_type: Mapped[str] = mapped_column(String(50))  # phishing | prompt_injection | attachment
    risk_factors: Mapped[list | None] = mapped_column(JSON)
    explanation: Mapped[str | None] = mapped_column(Text)  # XAI
    recommended_action: Mapped[str] = mapped_column(String(20))  # allow | quarantine | block
    sender_reputation: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    email: Mapped[Email] = relationship(back_populates="security_event")


# ── tasks (Phase 2) ─────────────────────────────────────────
class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email_id: Mapped[str] = mapped_column(ForeignKey("emails.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(Text)
    task_type: Mapped[str | None] = mapped_column(String(50))  # calendar | document | reminder
    priority: Mapped[str | None] = mapped_column(String(20))
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── commitments (Phase 2) ───────────────────────────────────
class Commitment(Base):
    __tablename__ = "commitments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email_id: Mapped[str] = mapped_column(ForeignKey("emails.id", ondelete="CASCADE"), index=True)
    who: Mapped[str] = mapped_column(String(320))  # me | sender | person name
    what: Mapped[str] = mapped_column(Text)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── style_profiles (Phase 3) ────────────────────────────────
class StyleProfile(Base):
    __tablename__ = "style_profiles"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_key: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    profile: Mapped[dict] = mapped_column(JSON)  # learned style attributes
    sample_size: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ── style_feedback (Phase 3 / T3.3) ─────────────────────────
# Captures how Manny edits an AI-generated draft before sending, so the
# StyleLearningEngine can adapt (final_body = ground-truth Manny voice).
class StyleFeedback(Base):
    __tablename__ = "style_feedback"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_key: Mapped[str] = mapped_column(String(320), index=True)
    email_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    style: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_body: Mapped[str] = mapped_column(Text)
    edited: Mapped[bool] = mapped_column(Boolean, default=True)
    edit_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


# ── embeddings (semantic search / RAG) ──────────────────────
# Note: vector column added via raw SQL in setup_db.py (pgvector).
class EmbeddingMeta(Base):
    __tablename__ = "embeddings"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email_id: Mapped[str] = mapped_column(ForeignKey("emails.id", ondelete="CASCADE"), index=True)
    model: Mapped[str] = mapped_column(String(100), default="BAAI/bge-m3")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
