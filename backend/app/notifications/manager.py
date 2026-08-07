import logging
import apprise
from typing import List, Union, Dict, Any

logger = logging.getLogger(__name__)

def build_apprise_uri(provider_type: str, config: Dict[str, Any]) -> str | None:
    """
    Converts user-friendly parameters into Apprise URI.
    Supports: discord, telegram, slack, email (smtp), gotify, teams, webhook
    """
    try:
        if provider_type == "discord":
            # Discord webhook URL: https://discord.com/api/webhooks/12345/abcde
            webhook_url = config.get("webhook_url", "")
            if "discord.com/api/webhooks/" in webhook_url:
                parts = webhook_url.split("discord.com/api/webhooks/")[-1]
                return f"discord://{parts}"
            return webhook_url  # Fallback to direct URI
            
        elif provider_type == "telegram":
            bot_token = config.get("bot_token", "")
            chat_id = config.get("chat_id", "")
            if bot_token and chat_id:
                return f"tgram://{bot_token}/{chat_id}"
                
        elif provider_type == "slack":
            webhook_url = config.get("webhook_url", "")
            # Apprise supports slack://webhooks/token
            if "hooks.slack.com/services/" in webhook_url:
                parts = webhook_url.split("hooks.slack.com/services/")[-1]
                return f"slack://{parts}"
            return webhook_url
            
        elif provider_type == "email":
            host = config.get("host", "")
            port = config.get("port", 587)
            user = config.get("user", "")
            password = config.get("password", "")
            to_email = config.get("to_email", "")
            secure = "s" if config.get("use_ssl", True) else ""
            
            if host and to_email:
                auth_str = f"{user}:{password}@" if user and password else ""
                return f"mailto{secure}://{auth_str}{host}:{port}?to={to_email}"
                
        elif provider_type == "gotify":
            host = config.get("host", "")
            token = config.get("token", "")
            secure = "s" if config.get("use_ssl", True) else ""
            if host and token:
                # Remove http:// or https:// from host
                clean_host = host.replace("https://", "").replace("http://", "")
                return f"gotify{secure}://{clean_host}/{token}"
                
        elif provider_type == "teams":
            webhook_url = config.get("webhook_url", "")
            # Microsoft Teams webhook
            # msteams://uuidA/uuidB/uuidC
            if "webhook.office.com" in webhook_url:
                # Apprise parses msteams:// URL or we pass webhook URL directly
                return webhook_url.replace("https://", "msteams://")
            return webhook_url
            
        elif provider_type == "webhook":
            webhook_url = config.get("webhook_url", "")
            if webhook_url:
                return webhook_url.replace("https://", "json://").replace("http://", "json://")
                
        # If it is already a custom Apprise URI, return as-is
        elif provider_type == "custom":
            return config.get("custom_uri")
            
    except Exception as e:
        logger.error(f"Error building Apprise URI for {provider_type}: {e}")
        
    return None

def send_notification(
    uris: Union[str, List[str]],
    title: str,
    body: str
) -> bool:
    """
    Sends notification to one or more Apprise URIs.
    """
    if not uris:
        return False
        
    ap = apprise.Apprise()
    
    if isinstance(uris, str):
        ap.add(uris)
    else:
        for uri in uris:
            if uri:
                ap.add(uri)
                
    try:
        result = ap.notify(title=title, body=body)
        if result:
            logger.info("Notifications sent successfully via Apprise.")
        else:
            logger.warning("Apprise failed to send some/all notifications.")
        return result
    except Exception as e:
        logger.error(f"Failed to send Apprise notifications: {e}")
        return False
