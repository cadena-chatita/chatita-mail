"""
Chatita Mail v3.0 — Brief de caso generado por LLM (vista "Casos").

Reúne el contexto que AION Agent ya consolidó (línea de tiempo omnicanal:
WhatsApp, correo, agenda, adjuntos, pendientes) y lo condensa en un brief
en español que Manuel puede leer en menos de un minuto.

Modelo: task_type="medium" vía AION Brain (el router asigna un modelo de
síntesis de gama media — hoy Claude Sonnet). "simple" queda corto para
síntesis multi-fuente; "complex" es innecesario. ~1 llamada por caso/día.
"""
from __future__ import annotations

import logging

from backend.ai.aion_client import AIONBrainClient, aion as default_aion

logger = logging.getLogger("chatita_mail.case_brief")

_CHAN = {"whatsapp": "WhatsApp", "mail": "Correo", "event": "Agenda", "attachment": "Adjunto"}

_PROMPT = """Eres el analista personal de Manuel Cadena. Redacta el BRIEF del caso "{code}" ({title}).

Datos reales del caso (WhatsApp, correo, agenda, pendientes — ya consolidados por el sistema):

Organizaciones: {orgs}
Grupos de WhatsApp/Telegram: {groups}
Palabras clave: {keywords}
Actividad últimos 30 días: {activity}

Línea de tiempo (más reciente primero, hasta {n_items} elementos):
{timeline}

Pendientes abiertos ligados al caso:
{open_items}

Próximos eventos:
{upcoming}

Brief anterior (para continuidad; puede estar desactualizado):
{prev_brief}

Escribe el brief NUEVO en español, en markdown ligero, con EXACTAMENTE estas secciones:
## Resumen (2-3 líneas: de qué trata el caso y su estado)
## Estado actual y últimos movimientos (bullets con lo más reciente y relevante)
## Pendientes (bullets; escribe "Sin pendientes detectados" si no hay)
## Próximos pasos sugeridos (2-4 bullets accionables)

Reglas: solo hechos presentes en los datos — prohibido inventar nombres, fechas o cifras;
si un dato falta, omítelo. Máximo ~250 palabras. Sin encabezado de título ni preámbulo."""


def _fmt_timeline(timeline: list[dict]) -> str:
    if not timeline:
        return "(sin actividad registrada)"
    return "\n".join(
        f"- [{_CHAN.get(t['channel'], t['channel'])}] {t['at'] or '?'}: {t['summary']}"
        for t in timeline
    )


def _fmt_items(items: list[dict]) -> str:
    if not items:
        return "(ninguno)"
    return "\n".join(
        f"- {i.get('kind', '?')}: {i.get('title', '')} ({i.get('when') or 'sin fecha'})"
        for i in items
    )


def _fmt_events(events: list[dict]) -> str:
    if not events:
        return "(ninguno)"
    return "\n".join(
        f"- {e.get('at') or '?'}: {e.get('title', '')} ({e.get('calendar') or ''})"
        for e in events
    )


async def generate_brief(
    code: str,
    title: str,
    keywords: list[str],
    orgs: list[str],
    groups: list[str],
    activity_30d: dict,
    timeline: list[dict],
    open_items: list[dict],
    upcoming_events: list[dict],
    prev_brief: str | None = None,
    aion: AIONBrainClient | None = None,
) -> dict:
    """Generate a fresh brief for one case. Returns {text, ok, model, items_used, error?}."""
    client = aion or default_aion
    prompt = _PROMPT.format(
        code=code, title=title or "",
        orgs=", ".join(orgs) or "(ninguna)",
        groups=", ".join(groups) or "(ninguno)",
        keywords=", ".join(keywords) or "(ninguna)",
        activity=", ".join(f"{_CHAN.get(k, k)}: {n}" for k, n in (activity_30d or {}).items()) or "(sin actividad 30d)",
        n_items=len(timeline),
        timeline=_fmt_timeline(timeline),
        open_items=_fmt_items(open_items),
        upcoming=_fmt_events(upcoming_events),
        prev_brief=(prev_brief or "(no existe; es el primer brief)"),
    )
    result = await client.orchestrate(prompt=prompt, task_type="medium")
    text = (result.get("text") or "").strip() if isinstance(result, dict) else str(result).strip()
    return {
        "text": text,
        "ok": bool(result.get("ok")) and bool(text),
        "model": result.get("model") or result.get("provider"),
        "items_used": len(timeline),
        "error": result.get("error"),
    }
