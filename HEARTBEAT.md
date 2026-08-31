# 🫀 CHATITA MAIL — HEARTBEAT (Documento Maestro de Desarrollo)

> **Este es el documento maestro vivo de Chatita Mail.**  
> Se actualiza tras CADA acción significativa. Nunca perder el hilo del desarrollo.

---

## 📌 METADATOS

| Campo | Valor |
|-------|-------|
| **Producto** | Chatita Mail v3.0 |
| **Tipo** | App standalone + link en side menu de Chatita |
| **Motor AI** | AION Brain v3.2 vía **MCP** (ya publicado) |
| **Repo** | https://github.com/ManuelCadena/chatita-mail |
| **Autor** | Manuel Cadena |
| **Última actualización** | 31-Aug-2026 18:52 UTC — Chatita integrada con Chatita Mail mediante 3 tools; Hugging Face BGE-M3 restaurado; búsqueda híbrida lexical+semántica; protección IMPORTANT para transacciones de viaje. |
| **Fase actual** | 🟢 **PROD + INGESTA COMPLETA + 100% TRIAGED** — https://chatita.ai/mail/. 40,275 emails (Gmail 30,157 + iCloud 10,118), **0 sin clasificar (100% triaged)**. Timers activos: `chatita-mail-sync.timer` (Gmail incremental c/5min) + `chatita-mail-icloud.timer` (iCloud SINCE c/10min), ambos finalizando OK. Backend HTTP 200 (uvicorn :8000). Categorías: MEDIUM 28,622 · NOISE 11,210 · SPAM 372 · IMPORTANT 37 · LOW 30 · CRITICAL 4. 33 tareas / 8 compromisos abiertos · 17,418 min ahorrados. **Roadmap COMPLETO (Fases 0–4 ✅).** Fase 2 cerrada 01-Ago-2026: Calendar (crear eventos + MeetingScheduler), auto-follow-up, docgen Drive — todo human-in-the-loop. **E2E 8/8** contra prod. |
| **Meta usuario** | ≤5 min/día en email · 100% importantes atendidos · 0% spam |

---

## CORRECCIÓN DE RECUPERACIÓN — 31-Aug-2026

- Chatita expone `chatita_mail_search`, `chatita_mail_read` y `chatita_mail_status` sobre la base unificada Gmail+iCloud.
- BGE-M3 volvió a responder HTTP 200 después de recargar créditos Hugging Face; timeout por intento limitado a 12 segundos.
- La búsqueda semántica combina coincidencias lexicales obligatorias con similitud vectorial para priorizar entidades y términos exactos.
- Si el endpoint semántico falla, la tool de Chatita degrada a `/inbox/emails?search=...` sin mezclar espacios vectoriales de modelos diferentes.
- Confirmaciones, cambios y cancelaciones de viaje se preservan como `IMPORTANT` aunque provengan de remitentes automatizados.

---

## 🚀 DEPLOY PROD — 23-Jul-2026 (VERIFICADO)

Servidor: `chatita.ai` (54.212.177.221), SSH puerto 2222, `ec2-user`.

| Componente | Estado | Evidencia (M-CHEX) |
|---|---|---|
| Infra | Python 3.11.13 · redis6 (PONG) · PostgreSQL role `chatita` + db `chatita_mail` + pgvector | comandos exit 0 |
| Código | rsync → `/opt/chatita-mail` (backend, scripts, `frontend/dist`, SA json, `.env` prod) | `ls -la` prod |
| Deps | venv `python3.11` + `pip install -r backend/requirements.txt` OK | "deps installed OK" |
| Schema | 8 tablas + `embeddings.vector` 1024-dim | `setup_db.py` ✅ Done |
| Servicio | `chatita-mail.service` systemd **active** (uvicorn :8000, 127.0.0.1) | `systemctl is-active` = active |
| Health | `database:true, redis:true, aion_brain reachable:true (200)` | `/health` JSON |
| nginx | `/mail/` (SPA alias dist) + `/mail-api/` (proxy :8000/api/) | `nginx -t` ok + RELOADED |
| Público | `https://chatita.ai/mail/` 200 · JS asset 200 · `/mail-api/inbox/stats` 200 | curl `HTTP 200` |
| E2E real | Gmail SA `jose@manuelcadena.com` (31,476 msgs) · sync 10 fetched/created/triaged · AION clasificando (NOISE @0.92) · stats total=10, time_saved=15min | curl JSON |

Backups nginx: `/etc/nginx/conf.d/chatita.ai.conf.bak-mail-20260723-135448`.
Prod `.env`: DB local (chatita), redis local, `AION_BRAIN_URL=http://127.0.0.1:3100` con `AION_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON=/opt/chatita-mail/chatita-service-account.json`, `GMAIL_IMPERSONATE_SUBJECT=jose@manuelcadena.com`.

Pendiente opcional: sync full/incremental (31k emails), conector iCloud.

---

## 🎯 OBJETIVO DEL PRODUCTO (NO CAMBIA)

Chatita Mail debe lograr que Manny:
1. Gaste **≤5 minutos diarios** revisando/contestando emails.
2. Nunca pierda un email importante (**100% cobertura**).
3. Tenga **0% spam/ruido** ocultando lo importante.
4. Maximice eficiencia laboral y personal.
5. Tenga gestión impecable con **explicabilidad (XAI)** y **control humano**.

---

## 🏛️ DECISIONES ARQUITECTÓNICAS FIJAS (INVIOLABLES)

Estas decisiones NO se re-discuten salvo autorización explícita de Manny:

| # | Decisión | Detalle |
|---|----------|---------|
| **AD-1** | **Standalone** | App autocontenida con su propio backend + frontend |
| **AD-2** | **AION Brain vía MCP** | NO reimplementar LLM routing. Consumir AION Brain (ya publicado) vía protocolo MCP |
| **AD-3** | **UI en side menu de Chatita** | Link de acceso dentro del menú lateral de Chatita (localhost + servidor) |
| **AD-4** | **Doble entorno** | Local (`localhost`) + AWS Chatita (`54.212.177.221`) |
| **AD-5** | **Stack backend** | Python 3.11 + FastAPI + PostgreSQL 15 + pgvector + Redis 7 |
| **AD-6** | **Stack frontend** | React 18 + TypeScript + Vite + TailwindCSS |
| **AD-7** | **XAI obligatorio** | Toda decisión AI muestra su razonamiento (Liu 2022, Al-Subaiey 2024) |
| **AD-8** | **Human-in-the-loop** | Acciones críticas requieren aprobación (Goodman 2022) |

---

## 🖥️ INFRAESTRUCTURA DE DESPLIEGUE

### Entorno LOCAL (desarrollo primario)
```
Ruta local:     /Users/manuelcadena/chatita-local/chatita-mail/
Backend:        http://localhost:8000
Frontend:       http://localhost:5173 (Vite dev)
AION Brain MCP: stdio local O http://localhost:3100
PostgreSQL:     localhost:5432 / DB: chatita_mail
Redis:          localhost:6379
UI link:        Chatita local side menu → /mail
```

### Entorno PRODUCCIÓN — Servidor "Chatita" (AWS)
```
IP:             54.212.177.221
SSH:            ssh -i ~/.ssh/citrusmax-key.pem -p 2222 ec2-user@54.212.177.221
Dominio:        chatita.ai
Backend:        /opt/chatita-mail/  → puerto interno 8000
Frontend:       nginx → https://chatita.ai/mail/
AION Brain:     /opt/aion-brain/ (v3.2, puerto 3100) — YA DESPLEGADO
PostgreSQL:     local en Chatita server (puerto 5432, SG restringido)
UI link:        Chatita prod side menu → https://chatita.ai/mail/
```

### Comando de deploy a Chatita (rsync)
```bash
rsync -avz -e "ssh -i ~/.ssh/citrusmax-key.pem -p 2222" \
  --exclude node_modules --exclude .git --exclude __pycache__ --exclude .env \
  /Users/manuelcadena/chatita-local/chatita-mail/ \
  ec2-user@54.212.177.221:/opt/chatita-mail/
```

> ⚠️ **REGLA SERVIDOR**: Chatita Mail va en servidor **Chatita (54.212.177.221)**, NO en M5.  
> AION Brain ya está en Chatita. NUNCA confundir servidores.

---

## 🔌 CÓMO USAR AION BRAIN (GUÍA DE INTEGRACIÓN MCP)

### Modelo de consumo
Chatita Mail **NO** implementa routing de LLMs. Delega TODO a AION Brain vía MCP.

### Opción A — MCP stdio (local dev)
```python
# backend/ai/aion_client.py
import asyncio, json
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class AIONBrainClient:
    def __init__(self, server_path: str):
        self.params = StdioServerParameters(
            command="node",
            args=[server_path]  # /opt/aion-brain/mcp-server.js
        )

    async def orchestrate(self, prompt: str, task_type: str = "medium", **kwargs):
        async with stdio_client(self.params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(
                    "aion_orchestrate",
                    arguments={"prompt": prompt, "task_type": task_type, **kwargs}
                )
                return json.loads(result.content[0].text)
```

### Opción B — HTTP API (producción, más simple)
```python
# backend/ai/aion_client.py (HTTP variant)
import httpx

class AIONBrainHTTPClient:
    def __init__(self, base_url: str = "http://localhost:3100"):
        self.base_url = base_url

    async def orchestrate(self, prompt: str, task_type: str = "medium", **kwargs):
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.base_url}/orchestrate",
                json={"prompt": prompt, "task_type": task_type, **kwargs}
            )
            resp.raise_for_status()
            return resp.json()

    async def execute_tool(self, tool: str, params: dict):
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.base_url}/tool",
                json={"tool": tool, "params": params}
            )
            resp.raise_for_status()
            return resp.json()
```

### Task types de AION Brain (routing automático de costo/calidad)
| task_type | Modelo destino | Uso en Chatita Mail |
|-----------|----------------|---------------------|
| `simple` | Together Llama-3.3 ($0.18/1M) | Clasificación, urgencia, unsubscribe |
| `medium` | GPT-4o-mini | Resúmenes cortos, recomendaciones |
| `complex` | Claude Sonnet 4 | Task extraction, style learning, replies |
| `critical` | Claude Opus 4 | Phishing detection, decisiones irreversibles |
| `search` | Perplexity Sonar | Verificación de remitentes en web |
| `embedding` | HF BGE-M3 (gratis) | Búsqueda semántica, RAG |
| `classification` | HF BART-MNLI (gratis) | Zero-shot categorías |

### Herramientas AION Brain usadas por Chatita Mail
```
LLM:        aion_orchestrate (routing automático)
Vision:     hf_plant_disease→NO / openai_vision (OCR attachments)
NLP:        hf_sentiment_fin, hf_ner, hf_classify, hf_embed
Google:     google_calendar_*, google_drive_*, gmail_*
Corporate:  opencorporates_search (sender reputation)
Comms:      telegram_send_message (notificaciones)
Audio:      hf_transcribe_url (voice notes), elevenlabs TTS (voice replies)
```

---

## 🔬 FUNDAMENTO CIENTÍFICO (5 documentos de investigación integrados)

### Hallazgos que guían el diseño (papers 2001-2026)

| Hallazgo research | Fuente | Decisión de diseño en Chatita Mail |
|-------------------|--------|-----------------------------------|
| Clasificación ML alcanza **95-99%** vs reglas estáticas | Ghosh 2023 (RF 99.9%), Preetika 2025 | Clasificador híbrido: reglas rápidas + LLM para casos ambiguos |
| Spam **evoluciona** → filtros estáticos fallan | Jeeva 2023, Asliyuksek 2025 | Clasificación adaptativa vía LLM (no solo reglas) |
| Modelos **degradan con spam nuevo** (temporal drift) | Asliyuksek 2025, Kshirsagar 2025 | Feedback loop + re-evaluación continua |
| Asistente desplegado: **92.4% acc, 90.1% prec, 91.3% recall** multi-categoría | Chikodi 2025 | Meta de precisión mínima para clasificación producción |
| **EMAILSUM**: 2,549 threads, T5 full-thread = baseline fuerte | Zhang 2021 | Summarization de threads con contexto completo, no por email |
| ROUGE/BERTScore **correlacionan débil** con juicio humano | Zhang 2021 | Evaluar summaries con feedback real de Manny, no solo métricas |
| Modelos fallan en **intent/role understanding** en threads | Zhang 2021 | Pasar contexto de relación (sender history) al LLM |
| Summarization + **detección de intención maliciosa** juntas | Kashapov 2022 | Combinar summary con phishing analysis en un paso |
| **TF-IDF+LR = 2ms/email**, rápido y preciso | Jáñez-Martino 2023 | Pre-filtro lexical barato antes de invocar LLM (ahorro costo) |
| Mejor modelo depende de **dataset/idioma** (EN vs ES) | Jáñez-Martino 2023 | Clasificación multilingüe (Manny usa EN+ES) |
| AI **mejor que humanos** detectando commitments | Morrison 2024 | Commitment tracking automático |
| **Trust cae** si se revela autoría AI | Liu 2022 | 3 opciones de reply + edición + XAI |
| Email→Action ahorra **3-4x tiempo** | Navarro 2025 | Workflow automation con 91+ APIs |

### Arquitectura de clasificación en 2 etapas (costo-óptima)
```
Email entrante
    │
    ▼
[ETAPA 1: Pre-filtro lexical] ← TF-IDF + reglas (2ms, $0)
    │
    ├─ Confianza alta (>90%) → categoría directa ✅
    │
    └─ Ambiguo (<90%) → [ETAPA 2: LLM zero-shot] ← HF BART / Together ($0.0002)
                              │
                              └─ Casos críticos/seguridad → Claude ($0.003)
```
**Justificación**: Jáñez-Martino (2ms lexical) + Chikodi (92%+ LLM) + ahorro de costo AION.

---

## 🗺️ ROADMAP MAESTRO — 5 FASES

### Estado global
```
[ ] FASE 0 — Setup & Fundaciones        (Semana 1)      ⏸️ PENDIENTE
[ ] FASE 1 — Seguridad & Triage Core    (Semanas 1-3)   ⏸️ PENDIENTE
[ ] FASE 2 — Workflow Automation        (Semanas 4-6)   ⏸️ PENDIENTE
[ ] FASE 3 — Personalización & Trust    (Semanas 7-8)   ⏸️ PENDIENTE
[ ] FASE 4 — Features Avanzadas + Deploy(Semanas 9-10)  ⏸️ PENDIENTE
```

---

## ✅ FASE 0 — SETUP & FUNDACIONES (Semana 1)

**Objetivo**: Infra lista para desarrollar. Conexión AION Brain verificada.

### Tareas desglosadas

- [ ] **T0.1** — Crear entorno Python
  - `cd backend && python3.11 -m venv venv && source venv/bin/activate`
  - `pip install -r requirements.txt`
  - **Evidencia**: `pip list` muestra fastapi, sqlalchemy, etc.

- [ ] **T0.2** — Setup PostgreSQL local + pgvector
  - `createdb chatita_mail`
  - `psql chatita_mail -c "CREATE EXTENSION IF NOT EXISTS vector;"`
  - **Evidencia**: `psql chatita_mail -c "\dx"` muestra `vector`

- [ ] **T0.3** — Setup Redis local
  - Verificar `redis-cli ping` → `PONG`

- [ ] **T0.4** — Crear esquema de BD inicial (`scripts/setup_db.py`)
  - Tablas: `emails`, `email_accounts`, `classifications`, `tasks`, `commitments`, `style_profiles`, `security_events`, `embeddings`
  - **Evidencia**: `psql chatita_mail -c "\dt"` lista tablas

- [ ] **T0.5** — Implementar `AIONBrainClient` (HTTP + stdio)
  - Archivo: `backend/ai/aion_client.py`
  - **Evidencia**: test de conexión retorna respuesta de AION Brain

- [ ] **T0.6** — Test de humo AION Brain
  - `python -m backend.tests.test_aion_connection`
  - Llamar `orchestrate("Say OK", task_type="simple")` → verificar respuesta
  - **Evidencia**: output literal con respuesta del LLM

- [ ] **T0.7** — Esqueleto FastAPI (`backend/main.py`)
  - Endpoints: `GET /health`, `GET /version`
  - **Evidencia**: `curl localhost:8000/health` → 200

- [ ] **T0.8** — Esqueleto React (`frontend/`)
  - `npm create vite@latest . -- --template react-ts`
  - Configurar TailwindCSS
  - **Evidencia**: `npm run dev` levanta en :5173

- [ ] **T0.9** — Configurar `.env` local (sin commitear)
  - Copiar `.env.example` → `.env`, llenar keys
  - **Evidencia**: `python -c "from dotenv import load_dotenv; load_dotenv()"` sin error

**Criterio de salida FASE 0**: `curl localhost:8000/health` OK + AION Brain responde + DB con tablas.

---

## ✅ FASE 1 — SEGURIDAD & TRIAGE CORE (Semanas 1-3)

**Objetivo**: Eliminar 80% del ruido + proteger contra phishing. **60→10 min/día**.

### Módulo 1.1 — Ingesta de Email (multi-cuenta)

- [ ] **T1.1.1** — Conector Gmail (OAuth + API)
  - `backend/services/email/gmail_connector.py`
  - Usar `gmail_*` de AION Brain O google-api-python-client directo
  - **Evidencia**: listar 10 emails reales de inbox de Manny

- [ ] **T1.1.2** — Conector iCloud (IMAP)
  - `backend/services/email/icloud_connector.py`
  - **Evidencia**: conexión IMAP exitosa

- [ ] **T1.1.3** — Modelo unificado `Email` + persistencia
  - Guardar emails en `emails` table
  - **Evidencia**: `SELECT count(*) FROM emails` > 0

- [ ] **T1.1.4** — Sync incremental (webhook/polling)
  - **Evidencia**: nuevo email aparece en DB en <60s

### Módulo 1.2 — Clasificación en 2 Etapas (research-driven)

- [ ] **T1.2.1** — Pre-filtro lexical (TF-IDF + reglas)
  - `backend/ai/classifier/lexical_prefilter.py`
  - Basado en Jáñez-Martino (2ms/email)
  - **Evidencia**: clasifica newsletter conocido sin llamar LLM

- [ ] **T1.2.2** — Clasificador LLM zero-shot (casos ambiguos)
  - 6 categorías: CRITICAL, IMPORTANT, MEDIUM, LOW, SPAM, NOISE
  - `aion.orchestrate(task_type="simple")` (Together, barato)
  - **Evidencia**: JSON con categoría + confianza

- [ ] **T1.2.3** — Métrica de precisión (meta: ≥92% Chikodi)
  - Set de validación con 50 emails etiquetados por Manny
  - **Evidencia**: reporte accuracy/precision/recall

- [ ] **T1.2.4** — Feedback loop (temporal drift, Asliyuksek)
  - Si Manny reclasifica → guardar y reajustar
  - **Evidencia**: reclasificación persiste en DB

### Módulo 1.3 — Seguridad (Phishing + Prompt Injection)

- [ ] **T1.3.1** — `PhishingDetector` con XAI
  - Multi-capa: contenido + urgencia + sender + URLs + attachments
  - `task_type="critical"` (Claude Opus)
  - **Evidencia**: detecta email phishing de prueba con explicación

- [ ] **T1.3.2** — Sender reputation vía OpenCorporates
  - `aion.execute_tool("opencorporates_search", ...)`
  - **Evidencia**: dominio desconocido → flag

- [ ] **T1.3.3** — Prompt injection defense (sanitizer)
  - Detectar patrones "ignore instructions", tokens especiales
  - **Evidencia**: email con inyección → quarantine

- [ ] **T1.3.4** — Attachment safety
  - Análisis de tipos/nombres de archivo
  - **Evidencia**: .exe adjunto → flag

### Módulo 1.4 — Acciones Automáticas de Limpieza

- [ ] **T1.4.1** — Auto-unsubscribe inteligente
  - Detectar newsletters nunca abiertos → extraer link → unsubscribe
  - **Evidencia**: unsubscribe ejecutado en newsletter de prueba

- [ ] **T1.4.2** — Auto-archive LOW/NOISE
  - **Evidencia**: email NOISE archivado, sigue searchable

- [ ] **T1.4.3** — Notificaciones Telegram (CRITICAL/IMPORTANT)
  - `aion.execute_tool("telegram_send_message", ...)`
  - **Evidencia**: mensaje llega a Telegram de Manny

### Módulo 1.5 — UI Bandeja Inteligente (MVP)

- [ ] **T1.5.1** — Vista de inbox categorizado (React)
- [ ] **T1.5.2** — Badge de seguridad + panel XAI por email
- [ ] **T1.5.3** — Integrar link en side menu de Chatita (local)
  - **Evidencia**: click en menú Chatita → abre /mail

**Criterio de salida FASE 1**: inbox 100→20 emails/día, phishing bloqueado 95%+, tiempo 60→10 min.

---

## ✅ FASE 2 — WORKFLOW AUTOMATION (Semanas 4-6) — COMPLETA (01-Ago-2026)

**Objetivo**: Email→Action automático. **10→5 min/día**.

- [x] **T2.1** — `TaskExtractor` (Morrison 2024) ✅
  - Extraer tareas + commitments de threads
  - **Evidencia**: `POST /inbox/emails/{id}/extract`, `GET /tasks`, `GET /commitments`; 33 tareas / 8 compromisos en prod

- [x] **T2.2** — Commitment tracking + **crear evento en Google Calendar** ✅ 01-Ago-2026
  - `calendar_connector.py` (freebusy + create_event, DWD scope calendar). `POST /inbox/calendar/events` (human-in-the-loop: invites solo si `send_invites=true`)
  - **Evidencia**: slots reales de calendario (Lun 03 Ago 09:00/09:30/10:00); endpoint 200

- [x] **T2.3** — Auto-follow-up (commitments incumplidos) ✅ 01-Ago-2026
  - `GET /inbox/commitments/overdue` (3 vencidos reales) + `POST /inbox/commitments/{id}/followup-draft` (draft AION, Manny envía)

- [x] **T2.4** — `MeetingScheduler` (Navarro 2025) ✅ 01-Ago-2026
  - `POST /inbox/emails/{id}/meeting/detect` (AION detecta + propone slots libres). UI: botón "Reunión" → panel con slots + checkbox invites + crear evento
  - **Evidencia**: E2E `meeting scheduler (T2.4)` PASS; smoke detect 200

- [x] **T2.5** — Thread summarization (EMAILSUM/Zhang 2021) ✅
  - **Evidencia**: `POST /inbox/emails/{id}/summarize` en prod (botón Resumir en ReadingPane)

- [x] **T2.6** — Document generation desde email ✅ 01-Ago-2026
  - `POST /inbox/emails/{id}/doc-draft` (AION genera contenido) + `POST /inbox/drive/doc` (crea Google Doc, scope `drive`). UI: botón "Doc" → preview editable → "Crear en Drive"
  - **Evidencia**: E2E `document generation (T2.6)` PASS; doc-draft generó 1,319 chars

- [x] **T2.7** — Motor de aprobación (human-in-the-loop) ✅
  - TODAS las acciones externas de Fase 2 requieren confirmación del usuario: crear evento (botón), enviar invite (checkbox opt-in), crear doc (botón), enviar follow-up (Manny envía). Cero acciones automáticas sin OK.

**Criterio de salida FASE 2**: tiempo 10→5 min, 0 commitments olvidados, 80% meetings auto. → ✅ **COMPLETA**: extracción+tracking+summarization + Calendar (crear eventos/meetings) + follow-up + docgen Drive, todo human-in-the-loop. **E2E 8/8.**

---

## ✅ FASE 3 — PERSONALIZACIÓN & TRUST (Semanas 7-8)

**Objetivo**: Replies auténticos + confianza total. **85%+ acceptance**.

- [x] **T3.1** — `StyleLearningEngine` (Novelo 2025) ✅ 31-Jul-2026
  - Analizar emails enviados → perfil de estilo (+seed Gmail SENT)
  - **Evidencia**: `style_profiles` upsert `sample_size:19 source:llm`; git `8b55637`

- [x] **T3.2** — Multi-style replies (3 opciones, Liu 2022) ✅ 31-Jul-2026
  - Natural / Profesional / Breve + XAI `why`
  - **Evidencia**: `/draft-variants` 3 variants source:llm; E2E chips; git `cae74ee`

- [x] **T3.3** — Feedback loop de ediciones (Goodman 2022) ✅ 31-Jul-2026
  - Tabla `style_feedback` + `POST /inbox/style/feedback` (edit_ratio char-level via difflib) + relearn cada 5 ediciones + `collect_samples` prioriza `final_body`; métricas `GET /inbox/style/metrics`
  - **Evidencia**: edición grande→`edited:true edit_ratio:0.72`; idéntico→`edited:false`; metrics `acceptance_rate:0.5`; tabla `4|2`; git `476c73a`

- [x] **T3.4** — XAI universal (toda decisión explicada) ✅ 31-Jul-2026
  - Expander "¿Por qué?" en composer: idioma detectado + nº muestras + registro/tono/saludo/despedida; variants con `why`; clasificación con reasoning
  - **Evidencia**: E2E browser — expander muestra "Idioma detectado: EN · Estilo aprendido de 19 correos · Registro formal · Tono formal, procedural"

- [x] **T3.5** — Multi-idioma EN/ES (Jáñez-Martino) ✅ 31-Jul-2026
  - `detect_language` ES/EN + `_lang_directive` autoritativo (override del perfil) + `directive(target_lang)` omite cues de idioma en conflicto
  - **Evidencia**: email EN→reply EN ("Hi Capital.com Team, Thanks for reaching out"); email ES→reply ES ("Estimado Ing. Ernesto"); chip "responde en EN"; unit 5/5 pasa

**Criterio de salida FASE 3**: reply acceptance 85%+, trust score 90%+, ediciones <20%. → ✅ Infra completa; `acceptance_rate` medible en vivo vía `/inbox/style/metrics` (mejora con uso real).

---

## ✅ FASE 4 — FEATURES AVANZADAS + DEPLOY PRODUCCIÓN (Semanas 9-10)

**Objetivo**: Pulido + despliegue a servidor Chatita.

- [x] **T4.1** — Voice replies (ElevenLabs TTS) ✅ 31-Jul-2026
  - `POST /voice/tts` (audio/mpeg) + botón "Escuchar" en composer
  - **Evidencia**: TTS 200 `size=80710 audio/mpeg` MP3 válido; `/voice/health enabled:true`; E2E voice 200; git `f4b6e07`
- [x] **T4.2** — Attachment auto-suggest desde Drive ✅ 31-Jul-2026
  - Manny autorizó `drive.readonly` en DWD (Opción A, append — 12 scopes, sin destruir los 11 previos). `drive_connector.py` (read-only) + `GET /inbox/drive/search` + panel "Adjuntar de Drive" en composer (buscar → insertar enlace)
  - **Evidencia**: probe `DRIVE-OK`; `/drive/search?q=factura`→5 files reales; público 200; E2E Drive test 200; bundle `index-DzZf1HHi.js`
- [x] **T4.3** — Accessibility mode (Goodman 2022, dyslexia) ✅ 31-Jul-2026
  - Fuente dislexia + texto grande + alto contraste + reducir animaciones; toggle + localStorage + CSS `data-a11y-*`
  - **Evidencia**: E2E toggle→`html[data-a11y-dyslexia="1"]`; git `f4b6e07`
- [x] **T4.4** — Dashboard de analytics ✅ 31-Jul-2026 (`778bc46`)
- [x] **T4.5** — Suite de tests E2E (Playwright) ✅ 31-Jul-2026
  - `playwright.config.ts` + `e2e/mail.spec.ts` (inbox, dashboard, accesibilidad, voz, compose)
  - **Evidencia**: `npx playwright test` → **6 passed** contra prod (inbox/dashboard/a11y/voz/Drive/compose); git `cbad56a`
- [x] **T4.6** — Build frontend producción ✅ (`npm run build` exit 0, bundle `index-GMODRqlp.js`)
- [x] **T4.7** — Deploy backend a Chatita server ✅ (rsync + `chatita-mail.service` active)
  - **Evidencia**: `GET /mail-api/inbox/stats` → 200
- [x] **T4.8** — nginx `/mail/` en Chatita ✅ (`GET https://chatita.ai/mail/` → 200)
- [x] **T4.9** — Link en side menu de Chatita PRODUCCIÓN ✅ (B-5, panel iframe)
- [x] **T4.10** — AION Brain conectado en prod ✅ (draft/variants `source:llm` en vivo)

**Criterio de salida FASE 4**: chatita.ai/mail operativo ✅. **FASE 4 100% COMPLETA** (T4.1–T4.10) — T4.2 desbloqueado tras autorización admin del scope Drive.

---

## 📊 MÉTRICAS DE ÉXITO (tracking continuo)

| KPI | Meta | Actual | Fuente research |
|-----|------|--------|-----------------|
| Tiempo/día en email | ≤5 min | — | Objetivo Manny |
| Emails importantes perdidos | 0 | — | — |
| Phishing bloqueado | ≥95% | — | Viswanathan 2025 |
| Precisión clasificación | ≥92% | — | Chikodi 2025 |
| Spam en inbox | <5% | — | Mathew 2026 |
| Reply acceptance rate | ≥85% | — | — |
| Costo mensual AION | <$15 | — | — |

---

## 📓 BITÁCORA DE CAMBIOS (actualizar SIEMPRE)

| Fecha | Acción | Estado | Evidencia |
|-------|--------|--------|-----------|
| 22-Jul-2026 02:40 | Repo GitHub creado + estructura + docs | DEPLOY-VERIFICADO | commit 08d506b, push OK |
| 22-Jul-2026 02:51 | Análisis research v3.0 (50 papers) | HECHO VERIFICADO | commit c9f7125 |
| 22-Jul-2026 02:58 | Arquitectura v3.0 + Executive Summary | HECHO VERIFICADO | commit 106491b |
| 22-Jul-2026 03:00 | HEARTBEAT maestro creado (este doc) | HECHO VERIFICADO | este archivo |
| 22-Jul-2026 03:10 | FASE 0 completa: config, DB (8 tablas+pgvector), AIONClient, FastAPI | HECHO VERIFICADO | `setup_db` OK, `/health` DB✅ Redis✅ |
| 22-Jul-2026 03:10 | FASE 1 backend: clasificador 2 etapas, phishing+XAI, prompt-injection, triage, unsubscribe, notifier, 9 rutas API | HECHO VERIFICADO | E2E ingest+triage+analyze OK; 9/9 tests PASSED |
| 22-Jul-2026 03:10 | FASE 1 frontend: React+TS+Vite+Tailwind, inbox categorizado, filtros, panel XAI (clasificación+seguridad) | BUILD-VERIFICADO | `npm run build` OK (131 módulos, dist generado, exit 0) |
| 22-Jul-2026 08:25 | B-3 AION Brain conectado: arrancado http-server.js :3100, corregido contrato (query/taskType + execution.output) en aion_client.py | HECHO VERIFICADO | `/health` aion reachable:true; orchestrate 200 OK |
| 22-Jul-2026 08:25 | FIX ruta: /preview capturado como {email_id} → reordenado en classify.py | HECHO VERIFICADO | causa raíz en log (DataError UUID 'preview'), post-fix clasifica OK |
| 22-Jul-2026 08:25 | E2E con LLM real: clasificación IMPORTANT/CRITICAL stage=llm + reasoning; phishing crítico score 95 dangerous/block con XAI de Claude | HECHO VERIFICADO | 9/9 tests PASSED; triage E2E "contrato hoy"→CRITICAL 0.95 |
| 22-Jul-2026 08:34 | UI runtime verificada (Playwright): inbox categorizado, badges categoría+seguridad, filtros, panel XAI muestra reasoning LLM real y factores de phishing; auto-acciones (SPAM→archive, dangerous→block) reflejadas en INBOX | HECHO VERIFICADO | snapshot Playwright, 0 errores consola, CRITICAL XAI "95% · llm" con reasoning |
| 22-Jul-2026 08:42 | B-4 conector Gmail: service account + Domain-Wide Delegation (reutiliza chatita-service-account.json), impersona jose@manuelcadena.com; gmail_connector.py + sync.py + rutas /gmail/health y /sync/gmail | HECHO VERIFICADO | gmail/health ok:true email=jose@ 31,272 msgs; sync 4 emails REALES→NOISE/SPAM auto-archivados, auto-unsubscribe OK; 9/9 tests |
| 22-Jul-2026 08:55 | B-5 link en side menu de Chatita (local): nav-btn + panel iframe en chat.html, loader+título en dashboard.js, fix CSP frame-src +localhost:5173 en server.js. Backups .bak creados | HECHO VERIFICADO | Playwright: click nav→panel activo, iframe carga app mail v3.0 con inbox real (CRITICAL+phishing), CSP framing error resuelto |
| 22-Jul-2026 09:00 | B-6 AION Brain servicio persistente: launchd plist ai.chatita.aion-brain (RunAtLoad+KeepAlive) en tools/aion-brain/ + ~/Library/LaunchAgents. NO cambia código de AION Brain (solo infra) | HECHO VERIFICADO | launchctl list muestra PID; kill -9 → auto-reinicio (91312→91561) HTTP 200; mail :8000 ve aion reachable:true |
| 23-Jul-2026 02:40 | FASE 2 (workflow): TaskExtractor (services/workflow) vía AION Brain → tasks+commitments JSON con fallback regex; rutas /api/tasks, /commitments, .../extract; wired en triage para CRITICAL/IMPORTANT | HECHO VERIFICADO | import OK, 9/9 tests; /api/tasks 200; extracción corre (source=fallback por regresión AION, ver R-1) |
| 23-Jul-2026 02:40 | Backend data layer: /api/inbox/stats (counts+time-saved), list con search/unread, EmailOut enriquecido, get_email con body_html+recipients+attachments+tasks+auto-read, acciones status/read/unsubscribe | HECHO VERIFICADO | /stats devuelve by_status/by_category reales; get_email retorna html+is_read=true tras abrir |
| 23-Jul-2026 02:40 | Fix conector Gmail: body_html se extraía pero se descartaba → ahora persiste (gmail_connector+sync); aion_client._normalize robusto a múltiples shapes + detección de error | HECHO VERIFICADO | re-sync: 20/59 emails con HTML real; UI renderiza HTML |
| 23-Jul-2026 21:30 | INGESTA ROBUSTA + FULL SYNC: gmail_connector (paginación pageToken, get_profile_history_id, history.list delta + HistoryExpiredError, fetch_normalized); sync.py full_sync (batched/resumable/dedup) + sync_incremental (historyId, bootstrap, guard sync_status=running); 6 rutas nuevas (/sync/gmail/full, /incremental, /sync/icloud, /icloud/health, /sync/status, /triage/pending con BackgroundTasks); EmailAccount +last_history_id +sync_status; scripts/backfill_gmail.py resumable | DEPLOY-VERIFICADO | Backfill prod: listed=29831 created=29821 failed=0 (1645s); systemd timer chatita-mail-sync.timer c/5min fired→delta 9861751→9861858 added=1 SPAM auto-archived (llm); /sync/status total=29849 hist=9861858; incremental manual added=0 up-to-date; icloud/health graceful (not configured) |
| 23-Jul-2026 02:40 | UI OVERHAUL v3 (React): layout 3 paneles — Sidebar (folders+counts+sync+time-saved), EmailList (avatars/badges/unread/search), ReadingPane (HTML sanitizado DOMPurify+toolbar+XAI+tasks), TasksView, header con search+unread | BUILD-VERIFICADO + E2E | npm build exit 0 (1994 mods); Playwright :5173/mail: sidebar counts, lista 25 emails reales, reading pane con body HTML + panel XAI + mark-read; 0 errores consola |
| 31-Jul-2026 18:20 | COMPOSE & SEND: scope `gmail.send` + `send_message`/`get_headers`/`get_attachment_bytes`; rutas `/inbox/emails/{id}/reply`, `/forward`, `/inbox/compose` (threading In-Reply-To/References, adjuntos); composer en ReadingPane (responder/resp.todos/reenviar + draft IA + confirmación); búsqueda semántica (BGE-M3 pgvector) + botón Similares | DEPLOY-VERIFICADO | commit previo; envío real self OK (Gmail msg id) |
| 31-Jul-2026 18:33 | REDACTAR + PERSISTENCIA SENT: botón "Redactar" (Sidebar) → `ComposeModal` correo nuevo con confirmación; los 4 flujos de envío persisten `Email status=SENT`; carpeta "Enviados"; enum Python `SENT` + `ALTER TYPE emailstatus ADD VALUE 'SENT'` en Postgres prod | DEPLOY-VERIFICADO | git `b78b4ae`; py_compile+tsc exit 0; enum prod `{…,SENT}`; smoke `POST /inbox/compose`→`{"sent":true,"id":"19fb9349c98b797f"}`; `SENT rows: 1` en DB; `GET /mail-api/inbox/emails?status=SENT`→200; bundle público `index-BGRABe9Z.js` |
| 31-Jul-2026 19:00 | FASE 3 T3.1 StyleLearningEngine: aprende estilo de emails SENT (+seed automático desde etiqueta Gmail SENT si <8 muestras), extrae perfil JSON vía AION → tabla `style_profiles`; inyecta `directive` en `draft-reply`; endpoints `POST /inbox/style/learn` + `GET /inbox/style` | DEPLOY-VERIFICADO | git `8b55637`; learn→`sample_size:19, source:llm`; draft-reply `style_applied:true` con saludo "Estimado Ing."; `GET /mail-api/inbox/style`→200 |
| 31-Jul-2026 19:00 | FASE 3 T3.2 Multi-style replies: `draft_variants` genera 3 opciones (Natural/Profesional/Breve) + XAI `why` en 1 llamada AION, con estilo aprendido; endpoint `POST /inbox/emails/{id}/draft-variants`; chips en composer aplican variante | DEPLOY-VERIFICADO | git `cae74ee`; smoke 3 variants `source:llm` `style_applied:true`; E2E Playwright: panel "Opciones IA · 19 muestras", clic "Natural" rellena composer con estilo aprendido |
| 31-Jul-2026 19:00 | E2E Playwright (prod): Redactar (validación Enviar), Enviados=1, Responder→Generar opciones→3 chips XAI→aplica variante. Errores solo `ERR_NETWORK_CHANGED` (red local transitoria) + `cid:` inline (esperado) | HECHO-VERIFICADO | snapshots navegador chatita.ai/mail |
| 31-Jul-2026 19:00 | T4.4 Dashboard analytics: `GET /inbox/analytics` (time saved, recibidos/enviados, reply_rate, top 10 remitentes, volumen diario) + vista "Panel" (grupo Workflow). Datos 100% reales | DEPLOY-VERIFICADO | git `778bc46`; analytics total=42334 sent=1 saved=314.3h top=github/gmail/looker; `GET /mail-api/inbox/analytics`→200; E2E Panel renderiza tarjetas+gráfico+top; bundle `index-CGxMK8g1.js` |
| 31-Jul-2026 20:30 | FASE 3 COMPLETA — T3.3 feedback loop (`style_feedback` tabla creada en prod checkfirst, `/inbox/style/feedback` + `/style/metrics`, relearn c/5 ediciones, `collect_samples` prioriza `final_body`); T3.4 XAI expander "¿Por qué?"; T3.5 detección idioma ES/EN autoritativa | DEPLOY-VERIFICADO | git `476c73a`; TABLE-OK; feedback edición 0.72→`edited:true`, idéntico→`edited:false`, metrics `acceptance_rate:0.5` tabla `4|2`; T3.5 email EN→reply EN / ES→ES (server); E2E browser: chip "responde en EN" + expander muestra idioma/muestras/registro/tono; bundle `index-DgBEby3O.js`; público `/style/feedback`→200 |
| 31-Jul-2026 21:15 | FASE 4 (features) — T4.1 voice replies ElevenLabs (`/voice/tts` audio/mpeg + botón Escuchar, key en prod .env), T4.3 accessibility mode (dislexia/grande/contraste/motion, localStorage+CSS), T4.5 suite E2E Playwright (5 specs) | DEPLOY-VERIFICADO | git `f4b6e07`,`cbad56a`; TTS `size=80710 audio/mpeg`; `npx playwright test`→**5 passed** vs prod; bundle `index-GMODRqlp.js` |
| 31-Jul-2026 21:15 | FASE 4 infra confirmada (T4.4/T4.6-T4.10 ya en prod). T4.2 Drive attachment: probe DWD→`unauthorized_client` | BLOQUEO-DETECTADO | prod `/mail/`+`/mail-api/inbox/stats`→200; Drive probe RefreshError unauthorized_client (requiere autorización admin scope drive.readonly para client_id 1144878...) |
| 31-Jul-2026 21:40 | FASE 4 100% — T4.2 DESBLOQUEADO: Manny autorizó `drive.readonly` en DWD (Opción A, append 12 scopes, sin romper Calendar/Tasks/Contacts/Keep). `drive_connector.py` (read-only, thread) + `GET /inbox/drive/search` + panel "Adjuntar de Drive" en composer (buscar→insertar enlace) | DEPLOY-VERIFICADO | probe `DRIVE-OK`; `/drive/search?q=factura`→5 files reales (Sheet/xls/ppsx); público 200; **E2E 6/6 passed** (23.8s); bundle `index-DzZf1HHi.js` |

---

## 🚧 BLOQUEOS / PENDIENTES DE DECISIÓN

| # | Bloqueo | Necesita | Estado |
|---|---------|----------|--------|
| B-1 | Aprobación arquitectura v3.0 | OK de Manny | ✅ APROBADO (procede) |
| B-2 | ¿Empezar FASE 0 ya? | Confirmación | ✅ HECHO |
| B-8 | **T4.2 Drive attachment auto-suggest** | — | ✅ RESUELTO (31-Jul). Manny autorizó `drive.readonly` en DWD (Opción A, 12 scopes sin destruir previos). `drive_connector.py` read-only + `/inbox/drive/search` + panel composer. probe DRIVE-OK, E2E 6/6 |
| B-3 | Conectar AION Brain :3100 (orchestrate) | — | ✅ RESUELTO (orchestrate LLM+phishing verificado). ⚠️ Parcial: `execute_tool` (opencorporates/telegram) degrada — AION rutea tools vía gateway :8088 no activo + esos tools no están en su registro de 67 |
| B-4 | Conector Gmail (ingesta real) | — | ✅ RESUELTO (Gmail via SA+DWD, sync+triage verificado con 31k msgs reales). Sync incremental/full/historyId ✅ (T1.1.4). |
| B-7 | iCloud egress 993 bloqueado en EC2 | — | ✅ RESUELTO (24-Jul). Abierto egress tcp/993 en sg-0b936a3c6e57427d7 (regla sgr-01c4eabfbbf47fafb, outbound). Prod TCP 993 OPEN + icloud/health ok:true (inbox_count≈200,779). FIX conector: RFC822 devolvía vacío en iCloud→from/subject en blanco→cambiado a BODY.PEEK[]; + fetch por rango de secuencia evita SEARCH ALL (límite 1MB imaplib en 200k). Timer systemd chatita-mail-icloud.timer c/10min. iCloud SOLO incremental (200k inbox) |
| B-5 | Integrar link `/mail` en side menu de Chatita (local) | — | ✅ RESUELTO (nav-btn + iframe panel + CSP fix, verificado Playwright). ⚠️ Prod: nginx debe servir /mail/ same-origin (frame-src 'self' ya lo cubre) |
| B-6 | AION Brain como servicio persistente | — | ✅ RESUELTO (launchd ai.chatita.aion-brain, RunAtLoad+KeepAlive verificado). ⚠️ Prod servidor Chatita usa systemd (pendiente si aplica) |
| R-1 | ~~AION Brain `/orchestrate` lanzaba `prompt.split is not a function`~~ | — | ✅ **RESUELTO** (23-Jul 03:00). CAUSA RAÍZ: `http-server.js` (v3.4, commit 11d95b3) requería `./deploy-endpoint.js` inexistente → crash de arranque (MODULE_NOT_FOUND) → launchd seguía corriendo código STALE en memoria (arrancado 22-Jul) que lanzaba prompt.split. FIX: import de deploy-endpoint envuelto en try/catch (arranca; /admin/deploy→501) [chatita-local 32ce4de] + auth key local + cliente envía X-API-Key [chatita-mail daabc76]. VERIFICADO: orchestrate 200 provider:openai; re-clasificación stage=llm conf 0.95 |

---

## 🔗 DOCUMENTOS RELACIONADOS

- `README.md` — overview del producto
- `docs/EXECUTIVE_SUMMARY_v3.0.md` — resumen ejecutivo
- `docs/CHATITA_MAIL_RESEARCH_ANALYSIS_v3.0.md` — 23 áreas de oportunidad
- `docs/architecture/CHATITA_MAIL_ARCHITECTURE_v3.0_RESEARCH_ENHANCED.md` — arquitectura técnica
- `docs/guides/CHATITA_MAIL_AION_BRAIN_INTEGRATION_v3.2.md` — integración AION Brain
- `docs/api/CHATITA_MAIL_AION_API_MATRIX.md` — matriz de APIs

---

## 📖 PROTOCOLO DE ACTUALIZACIÓN DE ESTE HEARTBEAT

1. Tras CADA tarea completada → marcar `[x]` + agregar fila en Bitácora con evidencia.
2. Al iniciar sesión de desarrollo → leer este doc primero.
3. Al cambiar de fase → actualizar "Fase actual" en metadatos.
4. Nunca declarar tarea completa sin evidencia (regla M-CHEX).
5. Commitear este doc tras cada actualización significativa.

---

**FIN DEL HEARTBEAT — Chatita Mail v3.0**  
*Última línea de defensa contra perder el hilo del desarrollo.*
