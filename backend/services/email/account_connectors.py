"""Per-account connector factory (DWD Gmail, OAuth Gmail, Microsoft Graph, generic IMAP)."""
from __future__ import annotations

import imaplib
import logging
import smtplib
import ssl
import time
from datetime import datetime
from email.message import EmailMessage

import httpx
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from backend.config import settings
from backend.models.entities import AccountProvider, EmailAccount
from backend.services.accounts import crypto, oauth
from backend.services.email.gmail_connector import GmailConnector, NormalizedEmail, _SCOPES
from backend.services.email.icloud_connector import ICloudConnector

logger = logging.getLogger("chatita_mail.connectors")

GRAPH = "https://graph.microsoft.com/v1.0"


class OAuthGmailConnector(GmailConnector):
    """Gmail API with a per-user OAuth refresh token (no domain delegation)."""

    def __init__(self, creds: dict, email: str) -> None:
        super().__init__(key_path="", subject=email)
        self._creds = creds

    def _get_service(self):
        if self._service is None:
            c = Credentials(
                token=None,
                refresh_token=self._creds["refresh_token"],
                token_uri=oauth.GOOGLE_TOKEN,
                client_id=settings.google_oauth_client_id,
                client_secret=settings.google_oauth_client_secret,
                scopes=oauth.GOOGLE_SCOPES,
            )
            self._service = build("gmail", "v1", credentials=c, cache_discovery=False)
        return self._service


class GenericImapConnector(ICloudConnector):
    """Password IMAP mailbox (WorkMail, Exchange IMAP, Proofpoint-fronted, ...)."""

    def __init__(self, username: str, password: str, host: str, port: int = 993,
                 smtp_host: str | None = None, smtp_port: int = 587) -> None:
        super().__init__(username=username, app_password=password)
        self.host, self.port = host, port
        self.smtp_host, self.smtp_port = smtp_host, smtp_port

    def _connect(self) -> imaplib.IMAP4_SSL:
        imap = imaplib.IMAP4_SSL(self.host, self.port)
        imap.login(self.username, self.app_password)
        return imap

    def send_message(self, *, to: list[str], subject: str, body_text: str, cc: list[str] | None = None,
                     bcc: list[str] | None = None, **_) -> dict:
        if not self.smtp_host:
            raise RuntimeError("SMTP host not configured for this account")
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.username, ", ".join(to), subject
        if cc:
            msg["Cc"] = ", ".join(cc)
        rcpts = list(to) + list(cc or []) + list(bcc or [])
        msg.set_content(body_text)
        ctx = ssl.create_default_context()
        smtp = (smtplib.SMTP_SSL(self.smtp_host, self.smtp_port, timeout=30, context=ctx)
                if self.smtp_port == 465 else smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=30))
        with smtp as s:
            if self.smtp_port != 465:
                s.starttls(context=ctx)
            s.login(self.username, self.app_password)
            s.send_message(msg, to_addrs=rcpts)
        return {"ok": True}


class GraphConnector:
    """Microsoft 365 / Outlook.com via Microsoft Graph (delegated)."""

    def __init__(self, creds: dict, email: str, on_refresh=None) -> None:
        self.creds, self.username, self._on_refresh = creds, email, on_refresh

    def _token(self) -> str:
        if self.creds.get("access_token") and self.creds.get("expires_at", 0) > time.time():
            return self.creds["access_token"]
        fresh = oauth.refresh_ms_token_sync(self.creds["refresh_token"])
        self.creds.update(fresh)
        if self._on_refresh:
            self._on_refresh(self.creds)
        return self.creds["access_token"]

    def _get(self, path: str, **params) -> dict:
        r = httpx.get(f"{GRAPH}{path}", params=params, timeout=60,
                      headers={"Authorization": f"Bearer {self._token()}", "Prefer": 'outlook.body-content-type="html"'})
        r.raise_for_status()
        return r.json()

    def health(self) -> dict:
        try:
            me = self._get("/me", **{"$select": "mail,userPrincipalName"})
            return {"ok": True, "email": me.get("mail") or me.get("userPrincipalName")}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}

    def list_inbox(self, max_results: int = 50, unread_only: bool = False,
                   since_date: datetime | None = None) -> list[NormalizedEmail]:
        out: list[NormalizedEmail] = []
        flt = []
        if unread_only:
            flt.append("isRead eq false")
        if since_date:
            flt.append(f"receivedDateTime ge {since_date.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        params = {
            "$top": min(max_results, 50),
            "$orderby": "receivedDateTime desc",
            "$select": "id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,receivedDateTime,hasAttachments",
        }
        if flt:
            params["$filter"] = " and ".join(flt)
        data = self._get("/me/mailFolders/inbox/messages", **params)
        while True:
            for m in data.get("value", []):
                fa = (m.get("from") or {}).get("emailAddress", {})
                body = m.get("body") or {}
                html = body.get("content") if body.get("contentType") == "html" else None
                out.append(NormalizedEmail(
                    provider_message_id=m["id"], thread_id=m.get("conversationId"),
                    from_address=fa.get("address", ""), from_name=fa.get("name"),
                    to_addresses=[r["emailAddress"]["address"] for r in m.get("toRecipients", [])],
                    cc_addresses=[r["emailAddress"]["address"] for r in m.get("ccRecipients", [])],
                    subject=m.get("subject"),
                    body_text=m.get("bodyPreview") if not html else None,
                    snippet=m.get("bodyPreview"), received_at=m.get("receivedDateTime"),
                    body_html=html,
                    attachments=[{"filename": "(attachment)"}] if m.get("hasAttachments") else [],
                ))
                if len(out) >= max_results:
                    return out
            nxt = data.get("@odata.nextLink")
            if not nxt:
                return out
            r = httpx.get(nxt, timeout=60, headers={"Authorization": f"Bearer {self._token()}",
                                                    "Prefer": 'outlook.body-content-type="html"'})
            r.raise_for_status()
            data = r.json()

    def send_message(self, *, to: list[str], subject: str, body_text: str, cc: list[str] | None = None,
                     bcc: list[str] | None = None, **_) -> dict:
        payload = {"message": {
            "subject": subject, "body": {"contentType": "Text", "content": body_text},
            "toRecipients": [{"emailAddress": {"address": a}} for a in to],
            "ccRecipients": [{"emailAddress": {"address": a}} for a in (cc or [])],
            "bccRecipients": [{"emailAddress": {"address": a}} for a in (bcc or [])],
        }, "saveToSentItems": True}
        r = httpx.post(f"{GRAPH}/me/sendMail", json=payload, timeout=60,
                       headers={"Authorization": f"Bearer {self._token()}"})
        r.raise_for_status()
        return {"ok": True}


def build_connector(account: EmailAccount, persist_creds=None):
    """Return a connector exposing health() and list_inbox(...) for the account."""
    if account.auth_type == "dwd" or (account.auth_type is None and account.provider == AccountProvider.GMAIL):
        return GmailConnector(subject=account.email_address)
    if account.provider == AccountProvider.ICLOUD and account.auth_type in (None, "password") and not account.credentials_enc:
        return ICloudConnector()
    creds = crypto.decrypt(account.credentials_enc)
    if account.provider == AccountProvider.GMAIL:
        return OAuthGmailConnector(creds, account.email_address)
    if account.provider == AccountProvider.MICROSOFT:
        return GraphConnector(creds, account.email_address, on_refresh=persist_creds)
    if account.provider == AccountProvider.ICLOUD:
        return ICloudConnector(username=creds.get("username") or account.email_address,
                               app_password=creds.get("password"))
    return GenericImapConnector(
        username=creds.get("username") or account.email_address, password=creds.get("password", ""),
        host=account.imap_host or "", port=account.imap_port or 993,
        smtp_host=account.smtp_host, smtp_port=account.smtp_port or 587,
    )
