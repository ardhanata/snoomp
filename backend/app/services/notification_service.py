"""
Apprise multi-channel notification dispatch and provider integration.
Dispatches alerts via direct webhooks or native in-process Apprise engine (140+ services).
"""
import logging
import datetime
import json
from typing import Dict, Any, Optional, List, Union
import httpx
import apprise

logger = logging.getLogger(__name__)

# Enterprise Snoomp asset branding for Apprise notifications
APPRISE_ASSET = apprise.AppriseAsset(
    app_id="Snoomp",
    app_desc="Snoomp Enterprise Observability",
    app_url="https://github.com/ardhanata/snoomp",
    default_html_color="#10b981",
)


def map_status_to_notify_type(status: str) -> apprise.NotifyType:
    """Map internal monitor health status to Apprise NotifyType."""
    s = (status or "").lower()
    if s in ("up", "recovered", "healthy"):
        return apprise.NotifyType.SUCCESS
    elif s in ("down", "critical", "danger", "error"):
        return apprise.NotifyType.FAILURE
    elif s in ("warning", "degraded", "slow"):
        return apprise.NotifyType.WARNING
    return apprise.NotifyType.INFO


def build_apprise_uri(notif_type: str, cfg: Dict[str, Any]) -> Optional[str]:
    """
    Translate provider fields or direct URIs to standard Apprise URIs.
    Supports native Apprise URIs along with presets for chat, push, email, and on-call services.
    """
    t = notif_type.lower()
    if t == "apprise":
        return cfg.get("appriseURL") or cfg.get("url") or cfg.get("uri")

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
        url = cfg.get("teamsWebhookURL", "").strip()
        if url:
            return url

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

    elif t == "pagerduty":
        api_key = cfg.get("pagerdutyApiKey", "").strip()
        routing_key = cfg.get("pagerdutyRoutingKey", "").strip()
        if routing_key:
            auth = f"{api_key}@" if api_key else ""
            return f"pagerduty://{auth}{routing_key}"

    elif t == "opsgenie":
        api_key = cfg.get("opsgenieApiKey", "").strip()
        region = cfg.get("opsgenieRegion", "").strip().lower()
        if api_key:
            region_suffix = "?region=eu" if region == "eu" else ""
            return f"opsgenie://{api_key}{region_suffix}"

    elif t == "matrix":
        server = cfg.get("matrixServer", "").strip().replace("https://", "").replace("http://", "")
        token = cfg.get("matrixToken", "").strip()
        room = cfg.get("matrixRoom", "").strip()
        if server and room:
            auth = f"{token}@" if token else ""
            return f"matrixs://{auth}{server}/#{room}"

    elif t == "mattermost":
        server = cfg.get("mattermostServer", "").strip().replace("https://", "").replace("http://", "")
        token = cfg.get("mattermostToken", "").strip()
        channel = cfg.get("mattermostChannel", "").strip()
        if server and token:
            chan_q = f"?channel={channel}" if channel else ""
            return f"mmosts://{server}/{token}{chan_q}"

    elif t == "twilio":
        account_sid = cfg.get("twilioAccountSid", "").strip()
        auth_token = cfg.get("twilioAuthToken", "").strip()
        from_phone = cfg.get("twilioFromPhone", "").strip()
        to_phone = cfg.get("twilioToPhone", "").strip()
        if account_sid and auth_token and from_phone and to_phone:
            return f"twilio://{account_sid}:{auth_token}@{from_phone}/{to_phone}"

    return None


def validate_apprise_uris(uris: Union[str, List[str]]) -> Dict[str, Any]:
    """
    Validate syntax and parseability of one or more Apprise URIs.
    """
    if not uris:
        return {"valid": False, "count": 0, "schemas": [], "error": "No Apprise URIs provided"}

    if isinstance(uris, str):
        parsed = [u.strip() for u in uris.replace("\n", ",").split(",") if u.strip()]
    else:
        parsed = [str(u).strip() for u in uris if u and str(u).strip()]

    if not parsed:
        return {"valid": False, "count": 0, "schemas": [], "error": "No valid URIs found"}

    ap = apprise.Apprise(asset=APPRISE_ASSET)
    added = 0
    schemas = []
    for u in parsed:
        if ap.add(u):
            added += 1

    for s in ap:
        try:
            if hasattr(s, "schema"):
                schemas.append(s.schema)
        except Exception:
            pass

    if added == 0:
        return {
            "valid": False,
            "count": 0,
            "schemas": [],
            "error": "Invalid Apprise URI syntax or unsupported provider scheme."
        }

    return {
        "valid": True,
        "count": added,
        "schemas": sorted(list(set(schemas))),
        "message": f"Successfully parsed {added} Apprise notification destination(s)."
    }


def get_apprise_service_catalog() -> List[Dict[str, Any]]:
    """
    Dynamically retrieve supported service schemas, protocols, and documentation from Apprise.
    Returns over 140+ native notification providers.
    """
    try:
        ap = apprise.Apprise(asset=APPRISE_ASSET)
        raw_schemas = ap.details().get("schemas", [])
        catalog = []
        for s in raw_schemas:
            service_name = str(s.get("service_name") or "")
            service_url = str(s.get("service_url") or "")
            setup_url = str(s.get("setup_url") or "")
            protocols = list(s.get("protocols") or []) + list(s.get("secure_protocols") or [])

            # Extract schema prefixes
            details = s.get("details") or {}
            tokens = details.get("tokens") or {}
            schema_token = tokens.get("schema") or {}
            schema_values = schema_token.get("values") or protocols

            templates = details.get("templates") or ()

            catalog.append({
                "service_name": service_name,
                "service_url": service_url,
                "setup_url": setup_url,
                "schemas": list(schema_values),
                "templates": list(templates) if templates else []
            })

        catalog.sort(key=lambda x: x["service_name"].lower())
        return catalog
    except Exception as e:
        logger.error("Failed to generate Apprise service catalog: %s", e)
        return []


def send_apprise_notification(
    uris: Union[str, List[str]],
    title: str,
    body: str,
    status: str = "info",
    body_format: apprise.NotifyFormat = apprise.NotifyFormat.MARKDOWN,
    tag: Optional[str] = None
) -> bool:
    """
    Send push alert to one or more Apprise destination URIs with severity mapping.
    """
    if not uris:
        return False

    ap = apprise.Apprise(asset=APPRISE_ASSET)

    if isinstance(uris, str):
        parsed = [u.strip() for u in uris.replace("\n", ",").split(",") if u.strip()]
    else:
        parsed = [str(u).strip() for u in uris if u and str(u).strip()]

    added = 0
    for uri in parsed:
        if uri:
            if ap.add(uri):
                added += 1

    if added == 0:
        logger.warning("No valid Apprise destinations could be registered from provided URIs.")
        return False

    notify_type = map_status_to_notify_type(status)
    try:
        result = ap.notify(
            title=title,
            body=body,
            notify_type=notify_type,
            body_format=body_format,
            tag=tag
        )
        if result:
            logger.info("Apprise alert delivered successfully to %d target(s).", added)
        else:
            logger.warning("Apprise failed to deliver to one or more destination(s).")
        return bool(result)
    except Exception as e:
        logger.error("Error executing Apprise alert delivery: %s", e)
        return False


# Legacy alias for backward compatibility across worker / modules
send_notification = send_apprise_notification


def send_direct_discord(webhook_url: str, title: str, body: str, color: int = 0x3b82f6) -> bool:
    """Send rich Discord webhook message with embed styling."""
    payload = {
        "embeds": [
            {
                "title": title,
                "description": body,
                "color": color,
                "footer": {"text": "Snoomp Enterprise Observability"},
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
        ]
    }
    with httpx.Client(timeout=8.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()
        return True


def send_direct_telegram(bot_token: str, chat_id: str, message: str) -> bool:
    """Send HTML Telegram message."""
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
    """Send Slack webhook message with attachment payload."""
    payload = {
        "attachments": [
            {
                "fallback": f"{title}: {body}",
                "color": color,
                "title": title,
                "text": body,
                "ts": int(datetime.datetime.now(datetime.timezone.utc).timestamp())
            }
        ]
    }
    with httpx.Client(timeout=8.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()
        return True


def send_direct_webhook(cfg: Dict[str, Any], title: str, body: str, monitor_data: Optional[Dict[str, Any]] = None) -> bool:
    """Send Webhook HTTP payload."""
    url = cfg.get("webhookURL", "").strip()
    if not url:
        raise ValueError("Webhook URL is required")

    method = (cfg.get("httpMethod") or "POST").upper()
    headers = {"User-Agent": "Snoomp-Monitor/1.0.0"}

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
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
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


def dispatch_notification(
    notif_type: str,
    cfg: Dict[str, Any],
    title: str,
    body: str,
    status: str = "up",
    monitor_data: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Unified alert dispatcher: attempts direct native delivery for supported endpoints,
    or dispatches via Apprise multi-channel alert engine.
    """
    t = notif_type.lower()
    color_hex = "#10b981" if status.lower() == "up" else ("#f59e0b" if status.lower() == "warning" else "#ef4444")
    color_int = 0x10b981 if status.lower() == "up" else (0xf59e0b if status.lower() == "warning" else 0xef4444)

    # 1. Attempt direct delivery for custom formatted webhooks
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
        logger.warning("Direct delivery failed for %s, falling back to Apprise engine: %s", t, e)

    # 2. Universal Apprise Engine dispatch
    apprise_uri = build_apprise_uri(notif_type, cfg)
    if apprise_uri:
        custom_prefix = cfg.get("title", "").strip()
        final_title = f"{custom_prefix} {title}".strip() if custom_prefix else title
        return send_apprise_notification(
            uris=apprise_uri,
            title=final_title,
            body=body,
            status=status,
            body_format=apprise.NotifyFormat.MARKDOWN
        )

    raise ValueError(f"Unsupported notification type or missing configuration for '{notif_type}'")


def test_notification_channel(notif_type: str, name: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Test a notification configuration and return result."""
    now_str = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    title = f"⚠️ [TEST] Snoomp Alert Test: {name}"
    body = (
        f"This is a test alert from **Snoomp Enterprise Observability**.\n"
        f"- **Channel**: {name} (`{notif_type.upper()}`)\n"
        f"- **Time**: {now_str} UTC\n\n"
        f"If you received this message, your Apprise alert configuration is working properly!"
    )
    monitor_dummy = {
        "name": "Test Monitor (Snoomp)",
        "type": "http",
        "url": "https://snoomp.local",
        "status": "up"
    }

    try:
        success = dispatch_notification(
            notif_type,
            cfg,
            title,
            body,
            status="info",
            monitor_data=monitor_dummy
        )
        if success:
            return {"success": True, "message": f"Test alert sent successfully to '{name}' via Apprise engine."}
        else:
            return {"success": False, "message": f"Notification provider rejected the test message. Please verify credentials."}
    except Exception as e:
        return {"success": False, "message": f"Failed to send test alert: {str(e)}"}
