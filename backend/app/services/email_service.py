import os
import smtplib
from email.message import EmailMessage
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def send_password_reset_email(to_email: str, reset_url: str) -> bool:
    """Send a password reset link to user's registered email using standard library smtplib."""
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    if not smtp_host:
        logger.warning(
            "SMTP_HOST is not configured; password reset email skipped. Reset URL for %s: %s",
            to_email,
            reset_url,
        )
        return False

    smtp_port_raw = os.environ.get("SMTP_PORT", "587").strip()
    try:
        smtp_port = int(smtp_port_raw)
    except ValueError:
        smtp_port = 587

    smtp_user = os.environ.get("SMTP_USER", "").strip() or None
    smtp_password = os.environ.get("SMTP_PASSWORD", "").strip() or None
    smtp_from = os.environ.get("SMTP_FROM", "").strip()
    if not smtp_from:
        smtp_from = smtp_user if (smtp_user and "@" in smtp_user) else "noreply@snoomp.local"

    smtp_tls = os.environ.get("SMTP_TLS", "true").strip().lower() in ("true", "1", "yes")

    msg = EmailMessage()
    msg["Subject"] = "Snoomp: Reset Password Akun Anda"
    msg["From"] = smtp_from
    msg["To"] = to_email

    text_body = (
        "Halo,\n\n"
        "Kami menerima permintaan untuk mereset password akun Snoomp Anda.\n\n"
        f"Silakan buka tautan berikut untuk membuat password baru:\n{reset_url}\n\n"
        "Tautan ini berlaku selama 1 jam.\n"
        "Jika Anda tidak merasa meminta reset password, abaikan pesan ini.\n"
    )

    html_body = f"""<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Reset Password Snoomp</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #0c0d12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e2e8f0;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 500px; background: #161822; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 32px;" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #ffffff;">Snoomp Monitoring</h2>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                Halo, kami menerima permintaan reset password untuk akun Anda. Klik tombol di bawah untuk membuat password baru:
              </p>
              <div style="margin: 24px 0;">
                <a href="{reset_url}" target="_blank" rel="noopener noreferrer" style="background-color: #3b82f6; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">
                  Reset Password
                </a>
              </div>
              <p style="margin: 0 0 16px 0; font-size: 12px; line-height: 1.5; color: #64748b;">
                Atau salin tautan berikut ke browser Anda:<br>
                <a href="{reset_url}" style="color: #60a5fa; word-break: break-all;">{reset_url}</a>
              </p>
              <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 20px 0;">
              <p style="margin: 0; font-size: 11px; line-height: 1.4; color: #475569;">
                Tautan ini kedaluwarsa dalam 1 jam. Jika Anda tidak melakukan permintaan ini, tidak ada tindakan yang diperlukan.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10) as server:
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                if smtp_tls:
                    server.starttls()
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.send_message(msg)

        logger.info("Password reset email successfully sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send password reset email to %s: %s", to_email, e)
        return False
