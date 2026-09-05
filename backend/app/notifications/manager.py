import logging
import apprise
from typing import List, Union, Dict, Any

logger = logging.getLogger(__name__)

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
