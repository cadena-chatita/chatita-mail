"""
Chatita Mail v3.0 — Pydantic schemas (API request/response models).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.models.entities import EmailCategory, EmailStatus, RiskLevel


# ── Email ───────────────────────────────────────────────────
class EmailIn(BaseModel):
    """Normalized email used across the pipeline (provider-agnostic)."""

    provider_message_id: str
    thread_id: str | None = None
    from_address: str
    from_name: str | None = None
    to_addresses: list[str] = Field(default_factory=list)
    cc_addresses: list[str] = Field(default_factory=list)
    subject: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    snippet: str | None = None
    attachments: list[dict] = Field(default_factory=list)
    received_at: datetime | None = None


class EmailOut(BaseModel):
    id: str
    account_id: str | None = None
    from_address: str
    from_name: str | None
    subject: str | None
    snippet: str | None
    status: EmailStatus
    is_read: bool
    received_at: datetime | None
    thread_id: str | None = None
    has_html: bool = False
    has_attachments: bool = False
    category: EmailCategory | None = None
    confidence: float | None = None
    is_newsletter: bool = False
    unsubscribe_url: str | None = None
    risk_level: RiskLevel | None = None
    risk_score: int | None = None

    model_config = {"from_attributes": True}


class SemanticHit(EmailOut):
    """An email returned by semantic search, with its cosine similarity (0-1)."""

    similarity: float = 0.0


# ── Actions ─────────────────────────────────────────────────
class StatusUpdateIn(BaseModel):
    status: EmailStatus


class ReadUpdateIn(BaseModel):
    is_read: bool = True


# ── Stats (sidebar counts) ──────────────────────────────────
class InboxStats(BaseModel):
    total: int
    unread: int
    by_status: dict[str, int]
    by_category: dict[str, int]
    open_tasks: int
    open_commitments: int
    time_saved_minutes: int


# ── Phase 2: Tasks & Commitments ────────────────────────────
class TaskOut(BaseModel):
    id: str
    email_id: str
    description: str
    task_type: str | None = None
    priority: str | None = None
    deadline: datetime | None = None
    status: str
    created_at: datetime | None = None
    completed_at: datetime | None = None
    closed_via: str | None = None

    model_config = {"from_attributes": True}


class CommitmentOut(BaseModel):
    id: str
    email_id: str
    who: str
    what: str
    deadline: datetime | None = None
    status: str
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class TaskStatusIn(BaseModel):
    status: Literal["pending", "done", "dismissed"]


class TaskCountsOut(BaseModel):
    pending: int
    done: int
    dismissed: int
    overdue: int
    today: int
    week: int
    no_date: int


# ── Classification ──────────────────────────────────────────
class ClassificationResult(BaseModel):
    category: EmailCategory
    confidence: float
    stage: str  # lexical | llm
    reasoning: str | None = None
    is_newsletter: bool = False
    unsubscribe_url: str | None = None


class ReclassifyIn(BaseModel):
    category: EmailCategory


# ── Security ────────────────────────────────────────────────
class SecurityResult(BaseModel):
    risk_score: int
    risk_level: RiskLevel
    event_type: str
    risk_factors: list[str] = Field(default_factory=list)
    explanation: str | None = None
    recommended_action: str  # allow | quarantine | block
    sender_reputation: dict | None = None


# ── Health ──────────────────────────────────────────────────
class HealthOut(BaseModel):
    status: str
    version: str
    environment: str
    database: bool
    redis: bool
    aion_brain: dict
