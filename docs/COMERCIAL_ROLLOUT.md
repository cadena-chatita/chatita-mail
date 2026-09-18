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

-  — imagen base
-  — orquestación local
-  — variables requeridas
-  — este documento
-  — setup rápido

## 5. Variables de entorno

Copiar  a  y completar. Nunca commitear .



Variables típicas:
- 
- 
- 
- 
- 

## 6. Build



## 7. Despliegue

1. Clonar en M5: 
2. Crear  desde .
3.  o .
4. Verificar health endpoint.

## 8. Health checks



## 9. Backup y restore

- **Código:** git push/pull.
- **Base de datos:**  diario a S3.
- **Objetos:** S3 versioning activado.
- **Rollback:**  y restaurar snapshot EBS/DB.

## 10. Seguridad

- No commitear  ni credenciales.
- Usar IAM roles en M5, no keys en  si es posible.
-  excluye , logs, datos y claves.
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

