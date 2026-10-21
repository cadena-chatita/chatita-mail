"""Mail server discovery + connection tests (Apple-Mail-style "set up from address + password").

Sources used, in order: MX / autodiscover / TXT records of the domain (dnspython) and known provider presets
(GoDaddy Workspace/Titan, Amazon WorkMail, iCloud, Microsoft 365, Google). Nothing here ever logs a password.

Microsoft 365 / Exchange Online does NOT accept passwords over IMAP (server advertises LOGINDISABLED + AUTH=XOAUTH2),
so for those domains we report `login_disabled` without attempting a login (avoids lockouts) and point to OAuth.
"""
from __future__ import annotations

import imaplib
import smtplib
import socket
import ssl
from dataclasses import dataclass, field

import dns.exception
import dns.resolver

_RES = dns.resolver.Resolver()
_RES.lifetime = 6.0


def _q(name: str, rtype: str) -> list[str]:
    try:
        return [r.to_text().strip('"').lower() for r in _RES.resolve(name, rtype)]
    except (dns.exception.DNSException, OSError):
        return []


@dataclass
class Detection:
    domain: str
    provider: str = "unknown"  # microsoft365 | google | godaddy | workmail | icloud | titan | unknown
    method: str = "password"  # password | oauth_microsoft | oauth_google
    imap: tuple[str, int] | None = None
    smtp: tuple[str, int] | None = None
    evidence: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "domain": self.domain, "provider": self.provider, "method": self.method,
            "imap_host": self.imap[0] if self.imap else None, "imap_port": self.imap[1] if self.imap else None,
            "smtp_host": self.smtp[0] if self.smtp else None, "smtp_port": self.smtp[1] if self.smtp else None,
            "evidence": self.evidence,
        }


GATEWAYS = ("ppe-hosted.com", "pphosted.com", "mimecast.com", "barracudanetworks.com", "mailcontrol.com")


def detect(email: str) -> Detection:
    domain = email.rsplit("@", 1)[-1].lower().strip()
    d = Detection(domain=domain)
    mx = _q(domain, "MX")
    auto = _q(f"autodiscover.{domain}", "CNAME")
    txt = " ".join(_q(domain, "TXT"))
    d.evidence = [f"MX: {', '.join(m.split()[-1] for m in mx) or 'sin registros'}"]
    if auto:
        d.evidence.append(f"autodiscover: {', '.join(auto)}")
    mxs = " ".join(mx)
    is_m365 = "mail.protection.outlook.com" in mxs or any("outlook.com" in a for a in auto) or "onmicrosoft.com" in txt
    if is_m365:
        d.provider, d.method = "microsoft365", "oauth_microsoft"
        d.imap, d.smtp = ("outlook.office365.com", 993), ("smtp.office365.com", 587)
        if any(g in mxs for g in GATEWAYS):
            d.evidence.append("filtro de correo (gateway) delante de Microsoft 365")
        d.evidence.append("Microsoft 365 / Exchange Online (GoDaddy u otro revendedor)")
    elif "google.com" in mxs or "googlemail.com" in mxs:
        d.provider, d.method = "google", "oauth_google"
        d.imap, d.smtp = ("imap.gmail.com", 993), ("smtp.gmail.com", 465)
    elif "secureserver.net" in mxs:
        d.provider = "godaddy"
        d.imap, d.smtp = ("imap.secureserver.net", 993), ("smtpout.secureserver.net", 465)
        d.evidence.append("GoDaddy Workspace / Professional Email")
    elif "titan.email" in mxs:
        d.provider = "titan"
        d.imap, d.smtp = ("imap.titan.email", 993), ("smtp.titan.email", 465)
    elif "inbound-smtp" in mxs and "amazonaws.com" in mxs or any("awsapps.com" in a for a in auto):
        d.provider = "workmail"
        d.imap, d.smtp = ("imap.mail.us-east-1.awsapps.com", 993), ("smtp.mail.us-east-1.awsapps.com", 465)
        d.evidence.append("Amazon WorkMail (us-east-1)")
    elif "icloud.com" in mxs or domain in ("icloud.com", "me.com", "mac.com"):
        d.provider = "icloud"
        d.imap, d.smtp = ("imap.mail.me.com", 993), ("smtp.mail.me.com", 587)
    else:
        for h in (f"imap.{domain}", f"mail.{domain}"):
            if _q(h, "A") or _q(h, "CNAME"):
                d.imap, d.smtp = (h, 993), (f"smtp.{domain}" if _q(f"smtp.{domain}", "A") else h, 465)
                d.evidence.append(f"servidor encontrado: {h}")
                break
    return d


def _classify(exc: BaseException) -> tuple[str, str]:
    a0 = exc.args[0] if exc.args else ""
    msg = a0.decode("utf-8", "replace") if isinstance(a0, bytes) else str(exc)
    low = msg.lower()
    if isinstance(exc, socket.gaierror):
        return "dns_error", "El nombre del servidor no existe o no se pudo resolver."
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return "timeout", "El servidor no respondió a tiempo (puerto bloqueado o servidor incorrecto)."
    if isinstance(exc, ConnectionRefusedError):
        return "connect_error", "El servidor rechazó la conexión en ese puerto."
    if isinstance(exc, ssl.SSLError):
        return "tls_error", "Falló el cifrado TLS con el servidor (puerto o seguridad incorrectos)."
    if any(k in low for k in ("authenticationfailed", "login failed", "invalid credentials", "authentication failed", "[auth", "logon failure", "access denied", "temporary authentication failure", "535")):
        return "bad_credentials", "Usuario o contraseña rechazados por el servidor (en WorkMail también ocurre si el buzón no existe o IMAP no está habilitado)."
    return "error", msg[:200]


def test_imap(host: str, port: int, user: str, password: str) -> dict:
    """Probe capabilities, then try a LOGIN (unless the server forbids it). Never raises."""
    res: dict = {"host": host, "port": port, "ok": False}
    try:
        imap = imaplib.IMAP4_SSL(host, port, timeout=15) if port != 143 else imaplib.IMAP4(host, port, timeout=15)
    except Exception as exc:  # noqa: BLE001
        res["code"], res["message"] = _classify(exc)
        return res
    try:
        caps = " ".join(imap.capability()[1][0].decode().upper().split()) if imap.capability()[1] else ""
        res["capabilities"] = caps[:300]
        if "LOGINDISABLED" in caps and "AUTH=PLAIN" not in caps and "AUTH=LOGIN" not in caps:
            res["code"] = "login_disabled"
            res["message"] = ("Este servidor no acepta contraseña por IMAP (solo OAuth). Es lo normal en Microsoft 365 / Exchange Online.")
            return res
        imap.login(user, password)
        st, data = imap.select("INBOX", readonly=True)
        res.update(ok=True, code="ok", message="Conexión correcta", inbox_count=int(data[0]) if st == "OK" and data and data[0] else 0)
    except Exception as exc:  # noqa: BLE001
        res["code"], res["message"] = _classify(exc)
    finally:
        try:
            imap.logout()
        except Exception:  # noqa: BLE001
            pass
    return res


def test_smtp(host: str, port: int, user: str, password: str) -> dict:
    """Authenticate only (no message is sent). Never raises."""
    res: dict = {"host": host, "port": port, "ok": False}
    try:
        s = smtplib.SMTP_SSL(host, port, timeout=15, context=ssl.create_default_context()) if port == 465 else smtplib.SMTP(host, port, timeout=15)
        with s:
            s.ehlo()
            if port != 465:
                s.starttls(context=ssl.create_default_context())
                s.ehlo()
            s.login(user, password)
        res.update(ok=True, code="ok", message="SMTP correcto")
    except smtplib.SMTPAuthenticationError as exc:
        res["code"], res["message"] = "bad_credentials", f"SMTP rechazó las credenciales ({exc.smtp_code})."
    except Exception as exc:  # noqa: BLE001
        res["code"], res["message"] = _classify(exc)
    return res
