# chatita-mail — Documentación Técnica y de Desarrollo para Rollout Comercial

**Fecha:** 2026-09-18
**Repositorio:** https://github.com/cadena-chatita/chatita-mail
**Entorno destino:** AWS EC2 M5 (us-west-2c)
**Imagen base:** chatita-mail:repo
**Descripción:** Chatita Mail - servicio de correo

---

## 1. Propósito y alcance comercial

chatita-mail forma parte del ecosistema AION/CitrusMax/Chatita consolidado en M5. Este documento proporciona todo lo necesario para build, deploy, pruebas y mantenimiento comercial.

## 2. Stack tecnológico

- **Lenguaje/Runtime:** Python 3.11 / Node.js 20 según componente
- **Base de datos:** PostgreSQL (M5 / RDS)
- **Caché:** Redis
- **Objetos:** Amazon S3
- **Web/API:** FastAPI / Uvicorn / Express / Next.js
- **Contenedores:** Docker + Docker Compose
- **Proxy inverso:** Traefik (8880/8443)
- **Infraestructura:** AWS EC2, EBS, S3, RDS, DynamoDB, ElastiCache

## 3. Arquitectura

- M5 ejecuta el contenedor chatita-mail apuntando a PostgreSQL local y S3.
- Los datos persistentes viven en S3 y RDS, nunca en el contenedor.
- Chatita permanece como standby para AION Brain.

## 4. Estructura de archivos

- `Dockerfile` — imagen base
- `docker-compose.yml` — orquestación local
- `.env.example` — variables requeridas
- `docs/COMERCIAL_ROLLOUT.md` — este documento
- `README.md` — setup rápido

## 5. Variables de entorno

Copiar `.env.example` a `.env` y completar. Nunca commitear `.env`.

```bash
cp .env.example .env
```

Variables típicas:
- `DATABASE_URL`
- `REDIS_URL`
- `S3_BUCKET`
- `AWS_REGION`
- `API_KEY_*`

## 6. Build

```bash
docker build -t chatita-mail:repo .
```

## 7. Despliegue

1. Clonar en M5: `git clone https://github.com/cadena-chatita/chatita-mail.git /data/opt/repos/chatita-mail`
2. Crear `.env` desde `.env.example`.
3. `docker-compose up -d` o `docker run -d --env-file .env -p <PORT>:<PORT> chatita-mail:repo`.
4. Verificar health endpoint.

## 8. Health checks

```bash
curl -s http://localhost:<PORT>/health | jq .
```

## 9. Backup y restore

- **Código:** git push/pull.
- **Base de datos:** `pg_dump -Fc` diario a S3.
- **Objetos:** S3 versioning activado.
- **Rollback:** `git checkout <sha-anterior>` y restaurar snapshot EBS/DB.

## 10. Seguridad

- No commitear `.env` ni credenciales.
- Usar IAM roles en M5, no keys en `.env` si es posible.
- `.dockerignore` excluye `.env`, logs, datos y claves.
- Contenedores corren como usuario no-root.

## 11. Rollout comercial

1. Build verificado.
2. Variables de entorno en Parameter Store / SSM.
3. DNS/Route 53 apuntando a M5.
4. CloudFront/WAF si aplica.
5. Logs y monitoreo con CloudWatch.
6. Plan de rollback probado.

## 12. Roadmap

- [ ] CI/CD GitHub Actions
- [ ] Tests E2E automatizados
- [ ] Multi-AZ RDS para datos transaccionales
- [ ] S3 Intelligent-Tiering para activos

---
