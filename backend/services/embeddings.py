"""
Chatita Mail v3.0 — Embedding service (semantic search / RAG).

Generates BGE-M3 (1024-dim) embeddings via the HuggingFace Inference Router and
stores them in the pgvector-backed `embeddings.vector` column (added in
scripts/setup_db.py). Cosine distance (`<=>`) powers semantic search and
"find similar emails".

Design notes:
  - Vectors are L2-normalized so cosine and inner-product operators agree.
  - The `vector` column is NOT ORM-mapped (added via raw SQL), so all reads and
    writes here use parameterized text() statements with a pgvector literal.
  - Batch embedding uses HF's list-input feature-extraction to amortize latency.
"""
from __future__ import annotations

import logging
import math
import uuid

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings

logger = logging.getLogger("chatita_mail.embeddings")


class EmbeddingError(Exception):
    """Raised when an embedding cannot be produced and no degraded path applies."""


def _endpoint() -> str:
    if settings.embedding_url:
        return settings.embedding_url
    return (
        "https://router.huggingface.co/hf-inference/models/"
        f"{settings.embedding_model}/pipeline/feature-extraction"
    )


def _l2_normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0.0:
        return vec
    return [x / norm for x in vec]


def to_pgvector_literal(vec: list[float]) -> str:
    """Render a float list as a pgvector text literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


def build_email_text(subject: str | None, body_text: str | None, snippet: str | None) -> str:
    """Compose the text used to represent an email in vector space."""
    subj = (subject or "").strip()
    body = (body_text or snippet or "").strip()
    # Subject + lead of the body carries the semantic signal; cap chars low so
    # embedding requests stay fast (throughput scales with token count).
    combined = f"{subj}\n\n{body}"[:2000].strip()
    return combined or "(empty email)"


class EmbeddingService:
    """Async client for HF BGE-M3 embeddings + pgvector persistence."""

    def __init__(self, token: str | None = None, timeout: int = 60) -> None:
        self.token = token if token is not None else settings.hf_token
        self.timeout = timeout
        self.model = settings.embedding_model
        self.dim = settings.embedding_dim

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    @staticmethod
    def _extract_vector(raw) -> list[float]:
        """HF feature-extraction may return [dim] or [[dim]] (token-mean pooled)."""
        if isinstance(raw, list) and raw and isinstance(raw[0], list):
            return [float(x) for x in raw[0]]
        if isinstance(raw, list):
            return [float(x) for x in raw]
        raise EmbeddingError(f"Unexpected embedding response shape: {type(raw)}")

    async def embed_text(self, text_input: str) -> list[float]:
        """Return a single L2-normalized 1024-dim embedding."""
        if not self.token:
            raise EmbeddingError("HF token not configured (settings.hf_token empty)")
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout, 12)) as client:
                resp = await client.post(
                    _endpoint(), json={"inputs": text_input}, headers=self._headers()
                )
                resp.raise_for_status()
                vec = self._extract_vector(resp.json())
        except httpx.HTTPError as exc:
            raise EmbeddingError(f"Hugging Face embedding request failed: {exc}") from exc
        if len(vec) != self.dim:
            raise EmbeddingError(f"Expected {self.dim}-dim, got {len(vec)}")
        return _l2_normalize(vec)

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of texts in one request. Falls back to per-item on shape issues."""
        if not texts:
            return []
        if not self.token:
            raise EmbeddingError("HF token not configured (settings.hf_token empty)")
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout, 12)) as client:
                resp = await client.post(
                    _endpoint(), json={"inputs": texts}, headers=self._headers()
                )
                resp.raise_for_status()
                raw = resp.json()
        except httpx.HTTPError as exc:
            raise EmbeddingError(f"Hugging Face batch request failed: {exc}") from exc
        out: list[list[float]] = []
        if isinstance(raw, list) and len(raw) == len(texts):
            for item in raw:
                out.append(_l2_normalize(self._extract_vector(item)))
        else:
            for item in texts:
                out.append(await self.embed_text(item))
        for vector in out:
            if len(vector) != self.dim:
                raise EmbeddingError(f"Expected {self.dim}-dim, got {len(vector)}")
        return out

    # ── Persistence (raw SQL against pgvector column) ──────────
    async def store_embedding(
        self, session: AsyncSession, email_id: str, vector: list[float]
    ) -> None:
        """Insert (or replace) the embedding row for an email."""
        lit = to_pgvector_literal(vector)
        # Remove any prior row for this email to keep it 1:1 and idempotent.
        await session.execute(
            text("DELETE FROM embeddings WHERE email_id = :eid"), {"eid": email_id}
        )
        await session.execute(
            text(
                "INSERT INTO embeddings (id, email_id, model, vector, created_at) "
                "VALUES (:id, :eid, :model, CAST(:vec AS vector), now())"
            ),
            {"id": str(uuid.uuid4()), "eid": email_id, "model": self.model, "vec": lit},
        )

    async def semantic_search(
        self,
        session: AsyncSession,
        query_vector: list[float],
        limit: int = 25,
        exclude_email_id: str | None = None,
    ) -> list[tuple[str, float]]:
        """Return [(email_id, similarity 0-1)] ordered by cosine similarity desc."""
        lit = to_pgvector_literal(query_vector)
        sql = (
            "SELECT email_id, 1 - (vector <=> CAST(:qvec AS vector)) AS similarity "
            "FROM embeddings "
        )
        params: dict = {"qvec": lit, "k": limit}
        if exclude_email_id:
            sql += "WHERE email_id <> :exclude "
            params["exclude"] = exclude_email_id
        sql += "ORDER BY vector <=> CAST(:qvec AS vector) ASC LIMIT :k"
        rows = (await session.execute(text(sql), params)).all()
        return [(str(r[0]), float(r[1])) for r in rows]

    async def get_email_vector(
        self, session: AsyncSession, email_id: str
    ) -> list[float] | None:
        """Fetch a stored email vector as a Python list (or None if absent)."""
        row = (
            await session.execute(
                text("SELECT vector::text FROM embeddings WHERE email_id = :eid LIMIT 1"),
                {"eid": email_id},
            )
        ).first()
        if not row or row[0] is None:
            return None
        # pgvector text form: '[0.1,0.2,...]'
        return [float(x) for x in row[0].strip("[]").split(",") if x]


# Module-level singleton for convenience
embedder = EmbeddingService()
