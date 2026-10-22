"""
Chatita Mail — task lifecycle (completion that sticks).

When the user completes or cancels a task, the system must remember it:

  * the closure is stamped (`completed_at`, `closed_via`)
  * other PENDING tasks that are the same obligation announced again by the same
    sender (same fingerprint) are settled together ("already paid")
  * a later re-extraction never brings a closed task back (see task_extractor)
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.entities import Email, Task
from backend.services.workflow.task_value import fingerprint, same_obligation

CLOSED = ("done", "dismissed")


async def set_status(
    session: AsyncSession, task: Task, status: str, *, via: str = "user", now: datetime | None = None
) -> list[Task]:
    """Apply a status change. Returns the extra tasks settled as duplicates."""
    now = now or datetime.now(timezone.utc)
    task.status = status
    if status in CLOSED:
        task.completed_at = now
        task.closed_via = via
    else:  # reopened
        task.completed_at = None
        task.closed_via = None
    await session.flush()
    if status not in CLOSED:
        return []
    return await _settle_duplicates(session, task, status, now)


async def _settle_duplicates(session: AsyncSession, task: Task, status: str, now: datetime) -> list[Task]:
    src = await session.scalar(select(Email.from_address).where(Email.id == task.email_id))
    if not src:
        return []
    fp = fingerprint(task.description)
    rows = (
        await session.scalars(
            select(Task)
            .join(Email, Email.id == Task.email_id)
            .where(Email.from_address == src, Task.status == "pending", Task.id != task.id)
        )
    ).all()
    settled = []
    for other in rows:
        if fingerprint(other.description) == fp or same_obligation(other.description, task.description):
            other.status = status
            other.completed_at = now
            other.closed_via = "duplicate"
            settled.append(other)
    if settled:
        await session.flush()
    return settled
