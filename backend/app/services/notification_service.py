"""
Notification dispatch and provider integration matching Uptime Kuma.
Uses native httpx for high-fidelity webhook, Discord, Telegram, and Slack payloads,
and Apprise as the universal fallback for 80+ alert integrations.
"""
import logging
import datetime
import json
from typing import Dict, Any, Optional
import httpx
import apprise

logger = logging.getLogger(__name__)

def build_apprise_uri(notif_type: str, cfg: Dict[str, Any]) -> Optional[str]:
    """
    ponytail: Translate Uptime Kuma provider fields to standard Apprise URIs.
    """
    t = notif_type.lower()
    if t == "apprise":
        return cfg.get("appriseURL") or cfg.get("url")

    elif t == "telegram":
        token = cfg.get("telegramBotToken", "").strip()
        chat_id = cfg.get("telegramChatID", "").strip()
        if token and chat_id:
            return f"tgram://{token}/{chat_id}"

    elif t == "discord":
        webhook_url = cfg.get("discordWebhookUrl", "").strip()
        if webhook_url:
            return webhook_url

    elif t == "slack":
        webhook_url = cfg.get("slackwebhookURL", "").strip()
        if webhook_url:
            return webhook_url

    elif t in ("smtp", "email"):
        host = cfg.get("smtpHost", "").strip()
        port = cfg.get("smtpPort", 587)
        user = cfg.get("smtpUsername", "").strip()
        pwd = cfg.get("smtpPassword", "").strip()
        to_addr = cfg.get("smtpTo", "").strip()
        from_addr = cfg.get("smtpFrom", "").strip()
        secure = cfg.get("smtpSecure", False)
        proto = "mailtos" if secure else "mailto"
        if host and to_addr:
            auth = f"{user}:{pwd}@" if user else ""
            from_q = f"&from={from_addr}" if from_addr else ""
            return f"{proto}://{auth}{host}:{port}?to={to_addr}{from_q}"

    elif t == "teams":
        return cfg.get("teamsWebhookURL", "").strip() or None

    elif t == "pushover":
        key = cfg.get("pushoveruserkey", "").strip()
        token = cfg.get("pushoverapptoken", "").strip()
        if key and token:
            return f"pover://{key}@{token}"

    elif t == "gotify":
        server = cfg.get("gotifyserverurl", "").strip().rstrip("/")
        token = cfg.get("gotifyapplicationToken", "").strip()
        if server and token:
            server_clean = server.replace("https://", "").replace("http://", "")
            proto = "gotifys" if server.startswith("https") else "gotify"
            return f"{proto}://{server_clean}/{token}"

    elif t == "ntfy":
        server = cfg.get("ntfyserverurl", "").strip().rstrip("/") or "https://ntfy.sh"
        topic = cfg.get("ntfytopic", "").strip()
        if topic:
            clean = server.replace("https://", "").replace("http://", "")
            proto = "ntfys" if server.startswith("https") else "ntfy"
            return f"{proto}://{clean}/{topic}"

    return None


def send_direct_discord(webhook_url: str, title: str, body: str, color: int = 0x3b82f6) -> bool:
    """Send rich Discord webhook message matching Uptime Kuma format."""
    payload = {
        "embeds": [
            {
                "title": title,
                "description": body,
                "color": color,
                "footer": {"text": "Snoomp Enterprise Observability"},
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
            }
        ]
    }
    with httpx.Client(timeout=8.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()
        return True


def send_direct_telegram(bot_token: str, chat_id: str, message: str) -> bool:
    """Send Telegram message matching Uptime Kuma format."""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    with httpx.Client(timeout=8.0) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
        return True


def send_direct_slack(webhook_url: str, title: str, body: str, color: str = "#3b82f6") -> bool:
    """Send Slack webhook message matching Uptime Kuma format."""
    payload = {
        "attachments": [
            {
                "fallback": f"{title}: {body}",
                "color": color,
                "title": title,
                "text": body,
                "ts": int(datetime.datetime.utcnow().timestamp())
            }
        ]
    }
    with httpx.Client(timeout=8.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()
        return True


def send_direct_webhook(cfg: Dict[str, Any], title: str, body: str, monitor_data: Optional[Dict[str, Any]] = None) -> bool:
    """Send Webhook matching Uptime Kuma payload format."""
    url = cfg.get("webhookURL", "").strip()
    if not url:
        raise ValueError("Webhook URL is required")

    method = (cfg.get("httpMethod") or "POST").upper()
    headers = {"User-Agent": "Snoomp-Monitor/0.3.1"}

    add_headers = cfg.get("webhookAdditionalHeaders")
    if add_headers:
        if isinstance(add_headers, str):
            try:
                headers.update(json.loads(add_headers))
            except Exception:
                pass
        elif isinstance(add_headers, dict):
            headers.update(add_headers)

    content_type = cfg.get("webhookContentType", "json")
    payload = {
        "msg": f"{title}\n{body}",
        "title": title,
        "body": body,
        "monitor": monitor_data or {},
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }

    with httpx.Client(timeout=10.0) as client:
        if method == "GET":
            resp = client.get(url, params={"msg": payload["msg"]}, headers=headers)
        elif content_type == "form-data":
            resp = client.post(url, data={"data": json.dumps(payload)}, headers=headers)
        else:
            resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return True


def dispatch_notification(notif_type: str, cfg: Dict[str, Any], title: str, body: str, status: str = "up", monitor_data: Optional[Dict[str, Any]] = None) -> bool:
    """
    Unified dispatcher: attempts direct native delivery first, falls back to Apprise.
    """
    t = notif_type.lower()
    color_hex = "#10b981" if status.lower() == "up" else ("#f59e0b" if status.lower() == "warning" else "#ef4444")
    color_int = 0x10b981 if status.lower() == "up" else (0xf59e0b if status.lower() == "warning" else 0xef4444)

    try:
        if t == "discord":
            webhook_url = cfg.get("discordWebhookUrl", "").strip()
            if webhook_url:
                return send_direct_discord(webhook_url, title, body, color=color_int)

        elif t == "telegram":
            bot_token = cfg.get("telegramBotToken", "").strip()
            chat_id = cfg.get("telegramChatID", "").strip()
            if bot_token and chat_id:
                formatted_html = f"<b>{title}</b>\n\n<pre>{body}</pre>"
                return send_direct_telegram(bot_token, chat_id, formatted_html)

        elif t == "slack":
            webhook_url = cfg.get("slackwebhookURL", "").strip()
            if webhook_url:
                return send_direct_slack(webhook_url, title, body, color=color_hex)

        elif t == "webhook":
            return send_direct_webhook(cfg, title, body, monitor_data)

    except Exception as e:
        logger.warning(f"Direct delivery failed for {t}, attempting Apprise fallback: {e}")

    # Fallback or universal Apprise
    apprise_uri = build_apprise_uri(notif_type, cfg)
    if apprise_uri:
        ap = apprise.Apprise()
        # Support single URI or multiple comma/newline separated URIs (matching Apprise CLI & Uptime Kuma)
        uris = [u.strip() for u in apprise_uri.replace("\n", ",").split(",") if u.strip()]
        for u in uris:
            ap.add(u)
        custom_prefix = cfg.get("title", "").strip()
        final_title = f"{custom_prefix} {title}".strip() if custom_prefix else title
        return bool(ap.notify(title=final_title, body=body))

    raise ValueError(f"Unsupported notification type or missing credentials for {notif_type}")


def test_notification_channel(notif_type: str, name: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Test a notification configuration and return result."""
    title = f"⚠️ [TEST] Snoomp Alert Test: {name}"
    body = (
        f"This is a test alert from Snoomp Enterprise Infrastructure Observability.\n"
        f"Notification Channel: {name} ({notif_type.upper()})\n"
        f"Time: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC\n\n"
        f"If you received this message, your alert configuration is working properly!"
    )
    monitor_dummy = {
        "name": "Test Monitor (Snoomp)",
        "type": "http",
        "url": "https://snoomp.local",
        "status": "up"
    }

    try:
        success = dispatch_notification(notif_type, cfg, title, body, status="up", monitor_data=monitor_dummy)
        if success:
            return {"success": True, "message": f"Test alert sent successfully to {name}."}
        else:
            return {"success": False, "message": f"Provider rejected the alert message. Please verify configuration."}
    except Exception as e:
        return {"success": False, "message": f"Failed to send test alert: {str(e)}"}
