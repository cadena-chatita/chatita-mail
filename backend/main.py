"""
Chatita Mail v3.0 — FastAPI application entrypoint.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from backend.ai.aion_client import aion
from backend.config import settings
from backend.models.db import engine
from backend.models.schemas import HealthOut

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("chatita_mail")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s (%s)", settings.app_name, settings.app_version, settings.environment)
    yield
    await engine.dispose()
    logger.info("Shutdown complete")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="AI-Powered Email Management System with AION Brain Integration",
    lifespan=lifespan,
)

# CORS: allow Chatita frontend (local + prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://chatita.ai",
        "https://mail.chatita.ai",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _check_database() -> bool:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("DB health check failed: %s", exc)
        return False


async def _check_redis() -> bool:
    try:
        r = aioredis.from_url(settings.redis_url)
        pong = await r.ping()
        await r.aclose()
        return bool(pong)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis health check failed: %s", exc)
        return False


@app.get("/health", response_model=HealthOut, tags=["system"])
async def health() -> HealthOut:
    db_ok = await _check_database()
    redis_ok = await _check_redis()
    aion_status = await aion.health()
    return HealthOut(
        status="ok" if db_ok else "degraded",
        version=settings.app_version,
        environment=settings.environment,
        database=db_ok,
        redis=redis_ok,
        aion_brain=aion_status,
    )


@app.get("/version", tags=["system"])
async def version() -> dict:
    return {"name": settings.app_name, "version": settings.app_version}


# ── Routers ─────────────────────────────────────────────────
from backend.routes import accounts as accounts_routes  # noqa: E402
from backend.routes import auth as auth_routes  # noqa: E402
from backend.routes import classify as classify_routes  # noqa: E402
from backend.routes import compose as compose_routes  # noqa: E402
from backend.routes import inbox as inbox_routes  # noqa: E402
from backend.routes import security as security_routes  # noqa: E402
from backend.routes import tasks as tasks_routes  # noqa: E402

app.include_router(auth_routes.router)
app.include_router(accounts_routes.router)
app.include_router(inbox_routes.router)
app.include_router(classify_routes.router)
app.include_router(security_routes.router)
app.include_router(tasks_routes.router)
app.include_router(compose_routes.router)
