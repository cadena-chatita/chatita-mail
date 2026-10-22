"""
Dismiss pending tasks that repeat another pending task from the same sender in other words (never deletes).

  python -m scripts.dedupe_tasks            # dry run: prints what would be dismissed
  python -m scripts.dedupe_tasks --apply    # dismisses (status=dismissed, closed_via=duplicate); reversible from the Tasks view
The OLDEST task of each group stays open.
"""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, ".")

from sqlalchemy import select  # noqa: E402

from backend.models.db import AsyncSessionLocal  # noqa: E402
from backend.models.entities import Email, Task  # noqa: E402
from backend.services.workflow.task_value import same_obligation  # noqa: E402


async def main(apply: bool) -> int:
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(
            select(Task, Email.from_address).join(Email, Email.id == Task.email_id).where(Task.status == "pending").order_by(Task.created_at)
        )).all()
        kept: dict[str, list[Task]] = {}
        dups: list[tuple[Task, Task]] = []
        for task, sender in rows:
            for k in kept.setdefault(sender, []):
                if same_obligation(task.description, k.description):
                    dups.append((task, k)); break
            else:
                kept[sender].append(task)
        for task, keeper in dups:
            print(f"{'DISMISS' if apply else 'would dismiss'}: {task.description[:70]!r}  (same as {keeper.description[:50]!r})")
            if apply:
                task.status, task.completed_at, task.closed_via = "dismissed", datetime.now(timezone.utc), "duplicate"
        if apply:
            await s.commit()
        print(f"{len(rows)} pending, {len(dups)} duplicate(s){' dismissed' if apply else ' (dry run)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main("--apply" in sys.argv)))
