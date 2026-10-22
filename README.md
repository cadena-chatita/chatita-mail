# Chatita Mail v3.0
**AI-Powered Email Management System with AION Brain Integration**

[![Status](https://img.shields.io/badge/status-development-yellow)](https://github.com/ManuelCadena/chatita-mail)
[![Version](https://img.shields.io/badge/version-3.0.0--alpha-blue)](https://github.com/ManuelCadena/chatita-mail)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> 🫀 **Documento maestro de desarrollo**: [`HEARTBEAT.md`](HEARTBEAT.md) — leer PRIMERO al iniciar cualquier sesión de desarrollo. Contiene decisiones arquitectónicas fijas, infra de despliegue (local + servidor Chatita `54.212.177.221`), guía de integración AION Brain vía MCP, y el roadmap de 5 fases con tareas desglosadas.

---

## 🎯 Overview

Chatita Mail is a next-generation email application that leverages **AION Brain v3.2** to provide:

- ✅ **11 LLM providers** with intelligent routing (68-93% cost savings)
- ✅ **Smart Replies** with complete context (Drive + Calendar + Contacts)
- ✅ **Emotion AI** (Hume AI) for voice, video, and facial analysis
- ✅ **Vision AI** for attachment analysis (OCR, invoices, screenshots)
- ✅ **Semantic Search** with natural language queries
- ✅ **Autonomous Agent** with 91+ APIs for intelligent automation
- ✅ **Multi-account support** (Gmail, iCloud, custom IMAP)

---

## 📊 Key Metrics

| Metric | Value |
|--------|-------|
| **Cost Savings** | 68-93% (validated) |
| **Time Saved** | 1.5 hours/day |
| **ROI** | 14,566% |
| **LLM Providers** | 11 |
| **Total Services** | 91+ |
| **Task Types** | 17 |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 15+
- Redis 7+
- AION Brain v3.2

### Installation

```bash
# Clone repository
git clone https://github.com/ManuelCadena/chatita-mail.git
cd chatita-mail

# Install backend dependencies
cd backend
pip install -r requirements.txt

# Install frontend dependencies
cd ../frontend
npm install

# Setup database
cd ../backend
python scripts/setup_db.py

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start development servers
npm run dev
```

---

## 📁 Project Structure

```
chatita-mail/
├── backend/                    # FastAPI backend
│   ├── ai/                    # AI orchestration
│   │   ├── aion_client.py    # AION Brain MCP client
│   │   ├── aion_orchestrator.py
│   │   └── cost_tracker.py
│   ├── models/                # Data models
│   ├── routes/                # API routes
│   ├── services/              # Business logic
│   └── tests/                 # Backend tests
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── pages/            # Page components
│   │   └── hooks/            # Custom hooks
│   └── public/
├── docs/                       # Documentation
│   ├── architecture/          # Architecture docs
│   ├── api/                   # API reference
│   └── guides/                # User guides
├── scripts/                    # Utility scripts
└── .github/                    # GitHub workflows
```

---

## 📚 Documentation

- [Architecture v2.0 (AION Powered)](docs/CHATITA_MAIL_ARCHITECTURE_v2.0_AION_POWERED.md)
- [AION Brain Integration Guide](docs/CHATITA_MAIL_AION_BRAIN_INTEGRATION_v3.2.md)
- [API Matrix](docs/CHATITA_MAIL_AION_API_MATRIX.md)
- [Executive Summary](docs/CHATITA_MAIL_EXECUTIVE_SUMMARY.md)
- [Implementation Plan](docs/CHATITA_MAIL_IMPLEMENTATION_PLAN.md)

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    CHATITA MAIL v2.0                        │
│              Standalone App + Dashboard Link                │
└────────────────────┬───────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌──────────────┐          ┌──────────────┐
│   FRONTEND   │          │   BACKEND    │
│              │          │              │
│ React + TS   │◄────────►│ FastAPI      │
│ TailwindCSS  │  WebSocket│ Python 3.11  │
└──────────────┘          └──────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
            ┌──────────┐  ┌──────────┐  ┌──────────┐
            │PostgreSQL│  │  Redis   │  │  AION    │
            │+ pgvector│  │  Cache   │  │  BRAIN   │
            └──────────┘  └──────────┘  └────┬─────┘
                                              │
                    ┌─────────────────────────┼─────────────┐
                    ▼                         ▼             ▼
            ┌──────────────┐          ┌──────────────┐  ┌────────┐
            │  11 LLMs     │          │  Vision AI   │  │ 91+    │
            │  Routing     │          │  Hume AI     │  │ APIs   │
            └──────────────┘          └──────────────┘  └────────┘
```

---

## 🎯 Features

### Smart Replies
- 3 contextual options (short, professional, with-attachment)
- Enriched with Google Drive, Calendar, and Contacts data
- Automatic attachment suggestions from Drive
- Meeting scheduling integration

### Emotion AI
- Voice emotion detection (Hume AI)
- Video emotion analysis
- Facial expression recognition
- Priority boosting based on detected urgency/frustration

### Vision AI
- OCR for screenshots and scanned documents
- Invoice/receipt extraction
- Image analysis for attachments
- Automatic categorization

### Semantic Search
- Natural language queries
- Vector embeddings (HuggingFace BGE-M3 — free)
- Web search integration (Perplexity)
- Google Drive search

### Autonomous Agent
- Auto-archive low priority emails
- Auto-schedule meetings without conflicts
- Auto-draft responses for urgent emails
- Daily briefing with audio narration
- Telegram notifications for priority emails

---

## 💰 Cost Comparison

| Component | Without AION | With AION | Savings |
|-----------|--------------|-----------|---------|
| LLM Inference | $50-100/mo | $15-30/mo | **70%** |
| Vision AI | $20/mo | $10/mo | **50%** |
| Embeddings | $10/mo | $0 (HF) | **100%** |
| **TOTAL** | **$85-135/mo** | **$30-45/mo** | **65-67%** |

**ROI**: $6,600/month (time saved) - $45/month (cost) = **14,566% ROI**

---

## 🔧 Development

### Run Tests

```bash
# Backend tests
cd backend
pytest tests/

# Frontend tests
cd frontend
npm test

# E2E tests
npm run test:e2e
```

### Code Quality

```bash
# Lint backend
cd backend
pylint ai/ models/ routes/

# Lint frontend
cd frontend
npm run lint

# Format code
npm run format
```

---

## 🚢 Deployment

### Development
```bash
npm run dev
```

### Production
```bash
# Build frontend
cd frontend
npm run build

# Deploy to Chatita server
./scripts/deploy.sh production
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🏆 Why Chatita Mail?

| Feature | Superhuman | HEY | **Chatita Mail** |
|---------|-----------|-----|------------------|
| AI Providers | 1 | 0 | **11** |
| Smart Replies | Basic | ❌ | **Contextual** |
| Emotion AI | ❌ | ❌ | **✅ Hume AI** |
| Vision AI | ❌ | ❌ | **✅ 8 services** |
| Cost | $30/mo | $99/yr | **FREE** |
| Time Saved | 30 min/day | 15 min/day | **1.5 hr/day** |

---

## 📧 Contact

**Author**: Manuel Cadena  
**Email**: manuel@manuelcadena.com  
**GitHub**: [@ManuelCadena](https://github.com/ManuelCadena)

---

## 🙏 Acknowledgments

- [AION Brain](https://github.com/ManuelCadena/aion-brain) - AI orchestration platform
- [Hume AI](https://hume.ai) - Emotion detection
- [HuggingFace](https://huggingface.co) - Free embeddings and NER
- [Perplexity](https://perplexity.ai) - Web search with citations

---

**Built with ❤️ by Manuel Cadena**

## Desarrollo local

```bash
python3 -m venv venv && venv/bin/pip install -r backend/requirements.txt
venv/bin/python -m scripts.setup_db                 # crea la base y las tablas (idempotente)
venv/bin/python -m uvicorn backend.main:app --port 8000
cd frontend && npm install && npm run dev            # http://localhost:5173/mail/ (proxy /api -> :8000)
```

- **El esquema se repara solo en desarrollo.** Al arrancar, el backend compara los modelos con la base y agrega las columnas y valores de enumeración que falten (nunca borra nada). En producción solo avisa en el registro y en `GET /health` (`schema_missing`).
- **Gmail no funciona en local** sin el archivo de la cuenta de servicio de Google: los envíos y la sincronización responden 503 con un mensaje claro. La base local contiene datos de demostración.
- Pruebas: `venv/bin/python -m pytest backend/tests` y, en `frontend/`, `npm run test:e2e:local` (API simulada, sin sesión). Con el backend local en marcha: `E2E_LIVE_BACKEND=1 npx playwright test -c playwright.local.config.ts live-backend` (el correo saliente se intercepta en el navegador: nunca se envía).
