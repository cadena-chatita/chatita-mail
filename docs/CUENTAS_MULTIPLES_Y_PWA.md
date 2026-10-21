# Chatita Mail — cuentas multiples y app movil (PWA)

Diseno (AION Brain `aion_orchestrate` + Consensus, 2026-10-20): bandeja unificada por defecto con selector de cuenta
(color + estado de sincronizacion), identidad "De" explicita al redactar, credenciales cifradas en servidor (Fernet),
baja suave (detiene sync y borra credenciales; `purge=true` borra tambien los correos locales), PWA instalable.

## Modelo
`email_accounts` (+ `auth_type` dwd|oauth|password, `status`, `color`, `credentials_enc`, `imap_*`, `smtp_*`, `is_default`, `sort_order`, `deleted_at`).
Proveedores: `gmail` (DWD legado o OAuth por usuario), `microsoft` (Graph), `imap` (WorkMail/Exchange IMAP/otros), `icloud`.

## API (`/api/accounts`)
GET lista · POST alta · PATCH (nombre/color/activa/predeterminada) · DELETE `?purge=` · POST `/{id}/authorize` (URL OAuth) ·
GET `/oauth/{google|microsoft}/callback` · POST `/{id}/test` · POST `/{id}/sync` · POST `/{id}/password`.
`GET /api/inbox/emails?account_id=` y `/api/inbox/stats?account_id=` filtran por cuenta. `POST /api/inbox/compose` acepta `from_account_id`.

## Variables de entorno (solo nombres)
`MAIL_CRED_KEY` (Fernet), `SECRET_KEY` (firma de sesion/estado, no usar el default), `PUBLIC_BASE_URL`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`,
`MS_CLIENT_ID/SECRET/TENANT`, `LOGIN_ALLOWED_EMAILS`.

## Pasos externos obligatorios
1. Google Cloud Console (cliente OAuth de Chatita): agregar redirect URIs
   `https://mail.chatita.ai/auth/callback` y `https://mail.chatita.ai/api/accounts/oauth/google/callback`.
2. Microsoft Entra: registrar app multi-tenant (Web), redirect `https://mail.chatita.ai/api/accounts/oauth/microsoft/callback`,
   permisos delegados `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`; crear secreto; poner `MS_CLIENT_ID/SECRET` en `.env`.
   Los tenants de cada dominio pueden exigir consentimiento de administrador.
3. WorkMail (hospitalhmg.com): contrasena IMAP del buzon (en la UI: Configuracion -> cuenta -> contrasena).

## mail.chatita.ai
DNS Route53 `mail.chatita.ai A 44.247.163.1`; nginx `/etc/nginx/conf.d/mail-chatita-ai.conf`; certificado Let's Encrypt; sesion propia
(Google OIDC, lista `LOGIN_ALLOWED_EMAILS`, cookie firmada). PWA: `manifest.webmanifest`, `sw.js` (solo shell; nunca cachea API).

## Cron (M5)
`scripts/sync_all_accounts.py` cada 10 min (cuentas con `auth_type` definido). Gmail DWD e iCloud legados siguen con `sync_gmail.sh` / `sync_icloud.sh`.

## Cuentas GoDaddy / Microsoft 365 (decision 2026-10-21)
- Verificado: `outlook.office365.com:993` anuncia `LOGINDISABLED` y solo `AUTH=XOAUTH2` -> Microsoft 365 NO acepta contrasena por IMAP
  (GoDaddy: "Microsoft 365 no longer supports POP and IMAP settings in Outlook, Apple Mail..."; Microsoft: Basic auth disabled). Apple Mail usa
  Exchange + inicio de sesion de Microsoft (OAuth), no contrasena.
- GoDaddy Workspace/Professional Email (legacy) si usa contrasena: `imap.secureserver.net:993` SSL, `smtpout.secureserver.net:465` SSL.
- `POST /api/accounts/discover` (DNS, sin login), `POST /api/accounts/{id}/connect-password` (prueba IMAP+SMTP, guarda solo si funciona,
  max. 1 intento IMAP por llamada; M365 se reporta `login_disabled` sin intentar login).
- Para M365: una sola app de Entra multi-tenant (cualquier directorio gratuito, sin ser admin de GoDaddy) y `MS_CLIENT_ID/SECRET` en `.env`.
