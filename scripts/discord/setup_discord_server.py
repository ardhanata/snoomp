#!/usr/bin/env python3
"""
Snoomp Discord server provisioner.

Applies discord-blueprint.yaml to a Discord guild via the REST API v10.
Idempotent: existing roles/categories/channels are reconciled, not duplicated.

Usage:
    export DISCORD_BOT_TOKEN=...
    export DISCORD_GUILD_ID=...

    python setup_discord_server.py --dry-run     # preview, no writes
    python setup_discord_server.py               # apply

See README.md for bot setup and required permissions.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

try:
    import httpx
except ImportError:
    sys.exit("Missing dependency: pip install httpx pyyaml")

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency: pip install httpx pyyaml")


API_BASE = "https://discord.com/api/v10"
DEFAULT_CONFIG = Path(__file__).with_name("discord-blueprint.yaml")

# --------------------------------------------------------------------------
# Discord permission bit flags
# https://discord.com/developers/docs/topics/permissions
# --------------------------------------------------------------------------
PERMISSIONS: dict[str, int] = {
    "CREATE_INSTANT_INVITE": 1 << 0,
    "KICK_MEMBERS": 1 << 1,
    "BAN_MEMBERS": 1 << 2,
    "ADMINISTRATOR": 1 << 3,
    "MANAGE_CHANNELS": 1 << 4,
    "MANAGE_GUILD": 1 << 5,
    "ADD_REACTIONS": 1 << 6,
    "VIEW_AUDIT_LOG": 1 << 7,
    "PRIORITY_SPEAKER": 1 << 8,
    "STREAM": 1 << 9,
    "VIEW_CHANNEL": 1 << 10,
    "SEND_MESSAGES": 1 << 11,
    "SEND_TTS_MESSAGES": 1 << 12,
    "MANAGE_MESSAGES": 1 << 13,
    "EMBED_LINKS": 1 << 14,
    "ATTACH_FILES": 1 << 15,
    "READ_MESSAGE_HISTORY": 1 << 16,
    "MENTION_EVERYONE": 1 << 17,
    "USE_EXTERNAL_EMOJIS": 1 << 18,
    "VIEW_GUILD_INSIGHTS": 1 << 19,
    "CONNECT": 1 << 20,
    "SPEAK": 1 << 21,
    "MUTE_MEMBERS": 1 << 22,
    "DEAFEN_MEMBERS": 1 << 23,
    "MOVE_MEMBERS": 1 << 24,
    "USE_VAD": 1 << 25,
    "CHANGE_NICKNAME": 1 << 26,
    "MANAGE_NICKNAMES": 1 << 27,
    "MANAGE_ROLES": 1 << 28,
    "MANAGE_WEBHOOKS": 1 << 29,
    "MANAGE_GUILD_EXPRESSIONS": 1 << 30,
    "USE_APPLICATION_COMMANDS": 1 << 31,
    "REQUEST_TO_SPEAK": 1 << 32,
    "MANAGE_EVENTS": 1 << 33,
    "MANAGE_THREADS": 1 << 34,
    "CREATE_PUBLIC_THREADS": 1 << 35,
    "CREATE_PRIVATE_THREADS": 1 << 36,
    "USE_EXTERNAL_STICKERS": 1 << 37,
    "SEND_MESSAGES_IN_THREADS": 1 << 38,
    "USE_EMBEDDED_ACTIVITIES": 1 << 39,
    "MODERATE_MEMBERS": 1 << 40,
}

CHANNEL_TYPES = {"text": 0, "voice": 2, "category": 4, "announcement": 5, "forum": 15}

OVERWRITE_TYPE_ROLE = 0

# ANSI, disabled when not a tty
_TTY = sys.stdout.isatty()


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _TTY else text


GREEN = lambda s: _c("32", s)          # noqa: E731
YELLOW = lambda s: _c("33", s)         # noqa: E731
BLUE = lambda s: _c("34", s)           # noqa: E731
DIM = lambda s: _c("2", s)             # noqa: E731
RED = lambda s: _c("31", s)            # noqa: E731


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def perms_to_int(names: Iterable[str]) -> int:
    total = 0
    for name in names or []:
        key = name.strip().upper()
        if key not in PERMISSIONS:
            raise ValueError(f"Unknown permission: {name!r}")
        total |= PERMISSIONS[key]
    return total


def hex_to_int(color: str | int | None) -> int:
    if color is None:
        return 0
    if isinstance(color, int):
        return color
    return int(str(color).lstrip("#"), 16)


# --------------------------------------------------------------------------
# API client with rate-limit handling
# --------------------------------------------------------------------------
class DiscordClient:
    def __init__(self, token: str, dry_run: bool = False, verbose: bool = False):
        self.dry_run = dry_run
        self.verbose = verbose
        self._client = httpx.Client(
            base_url=API_BASE,
            headers={
                "Authorization": f"Bot {token}",
                "Content-Type": "application/json",
                "User-Agent": "SnoompServerSetup (https://github.com/snoomp, 1.0)",
            },
            timeout=30.0,
        )
        self._fake_id = 0

    def close(self) -> None:
        self._client.close()

    def next_fake_id(self) -> str:
        self._fake_id += 1
        return f"DRYRUN-{self._fake_id:04d}"

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Perform a request, retrying on 429 using Discord's retry_after."""
        for attempt in range(6):
            resp = self._client.request(method, path, **kwargs)

            if resp.status_code == 429:
                retry_after = float(resp.json().get("retry_after", 1.0))
                print(DIM(f"    rate limited, sleeping {retry_after:.2f}s"))
                time.sleep(retry_after + 0.1)
                continue

            if resp.status_code >= 400:
                raise RuntimeError(
                    f"{method} {path} -> {resp.status_code}\n{resp.text}"
                )

            if resp.status_code == 204 or not resp.content:
                return None
            return resp.json()

        raise RuntimeError(f"{method} {path} exhausted rate-limit retries")

    def get(self, path: str) -> Any:
        return self.request("GET", path)

    def write(self, method: str, path: str, payload: dict | list) -> Any:
        """A mutating call. Suppressed in dry-run mode."""
        if self.dry_run:
            if self.verbose:
                print(DIM(f"    [dry-run] {method} {path} {json.dumps(payload)[:400]}"))
            return {"id": self.next_fake_id(), **(payload if isinstance(payload, dict) else {})}
        return self.request(method, path, json=payload)


# --------------------------------------------------------------------------
# Reconciler
# --------------------------------------------------------------------------
@dataclass
class Stats:
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    warnings: list[str] = field(default_factory=list)


class ServerBuilder:
    def __init__(self, client: DiscordClient, guild_id: str, config: dict, args):
        self.api = client
        self.guild_id = guild_id
        self.cfg = config
        self.args = args
        self.stats = Stats()
        self.role_ids: dict[str, str] = {}   # role name -> id
        self.everyone_id: str = guild_id     # @everyone role id == guild id

    # ---------------------------------------------------------------- guild
    def apply_guild_settings(self) -> None:
        if self.args.skip_guild_settings:
            print(DIM("\n[guild] skipped (--skip-guild-settings)"))
            return

        gcfg = self.cfg.get("guild", {})
        if not gcfg:
            return

        print(BLUE("\n[guild] settings"))
        current = self.api.get(f"/guilds/{self.guild_id}")

        payload = {}
        for key in ("name", "verification_level", "default_message_notifications",
                    "explicit_content_filter"):
            if key in gcfg and current.get(key) != gcfg[key]:
                payload[key] = gcfg[key]

        if not payload:
            print(f"  {DIM('unchanged')}  {current.get('name')}")
            self.stats.unchanged += 1
            return

        self.api.write("PATCH", f"/guilds/{self.guild_id}", payload)
        print(f"  {YELLOW('updated')}    {', '.join(payload)}")
        self.stats.updated += 1

    # ---------------------------------------------------------------- roles
    def apply_roles(self) -> None:
        print(BLUE("\n[roles]"))
        existing = {r["name"]: r for r in self.api.get(f"/guilds/{self.guild_id}/roles")}

        # @everyone baseline
        everyone = existing.get("@everyone")
        base = perms_to_int(self.cfg.get("everyone_permissions", []))
        if everyone:
            self.everyone_id = everyone["id"]
            if int(everyone["permissions"]) != base:
                self.api.write(
                    "PATCH",
                    f"/guilds/{self.guild_id}/roles/{self.everyone_id}",
                    {"permissions": str(base)},
                )
                print(f"  {YELLOW('updated')}    @everyone  (baseline -> {base})")
                self.stats.updated += 1
            else:
                print(f"  {DIM('unchanged')}  @everyone")
                self.stats.unchanged += 1

        for spec in self.cfg.get("roles", []):
            name = spec["name"]
            desired = {
                "name": name,
                "permissions": str(perms_to_int(spec.get("permissions", []))),
                "color": hex_to_int(spec.get("color")),
                "hoist": bool(spec.get("hoist", False)),
                "mentionable": bool(spec.get("mentionable", False)),
            }

            if name in existing:
                cur = existing[name]
                self.role_ids[name] = cur["id"]
                drift = {
                    k: v for k, v in desired.items()
                    if str(cur.get(k)) != str(v)
                }
                if drift:
                    self.api.write(
                        "PATCH", f"/guilds/{self.guild_id}/roles/{cur['id']}", desired
                    )
                    print(f"  {YELLOW('updated')}    @{name}  ({', '.join(drift)})")
                    self.stats.updated += 1
                else:
                    print(f"  {DIM('unchanged')}  @{name}")
                    self.stats.unchanged += 1
            else:
                created = self.api.write("POST", f"/guilds/{self.guild_id}/roles", desired)
                self.role_ids[name] = created["id"]
                print(f"  {GREEN('created')}    @{name}")
                self.stats.created += 1

    def apply_role_order(self) -> None:
        """Reorder roles to match blueprint order, directly under the bot's top role."""
        if self.args.skip_role_order:
            print(DIM("\n[role order] skipped (--skip-role-order)"))
            return

        print(BLUE("\n[role order]"))

        if self.api.dry_run:
            print(DIM("  [dry-run] cannot resolve bot position; order would be:"))
            for i, spec in enumerate(self.cfg.get("roles", []), 1):
                print(DIM(f"    {i}. @{spec['name']}"))
            return

        me = self.api.get("/users/@me")
        member = self.api.get(f"/guilds/{self.guild_id}/members/{me['id']}")
        all_roles = {r["id"]: r for r in self.api.get(f"/guilds/{self.guild_id}/roles")}

        bot_top = max(
            (all_roles[rid]["position"] for rid in member.get("roles", []) if rid in all_roles),
            default=0,
        )
        bot_role_name = next(
            (all_roles[rid]["name"] for rid in member.get("roles", [])
             if rid in all_roles and all_roles[rid]["position"] == bot_top),
            me.get("username", "the bot's role"),
        )
        managed = {self.role_ids[n] for n in self.role_ids}
        above_bot = [
            r["name"] for r in all_roles.values()
            if r["position"] > bot_top and r["id"] in managed
        ]

        if above_bot:
            msg = (
                f"These blueprint roles sit above the bot's role and cannot be repositioned: "
                f"{', '.join(above_bot)}. Drag the bot's role to the top of "
                f"Server Settings > Roles and re-run."
            )
            print(f"  {RED('warning')}    {msg}")
            self.stats.warnings.append(msg)
            return

        wanted = [s["name"] for s in self.cfg.get("roles", []) if s["name"] in self.role_ids]

        # Discord rejects any requested position >= the bot's own highest role
        # (400, code 50013). It does NOT renormalize to make room, and it does NOT
        # renumber existing roles when new ones are created — fresh roles all land at
        # position 1, tied. So on a guild whose highest position is small, there is
        # literally nowhere to write an ordered block until the bot's role moves up.
        if bot_top <= len(wanted):
            # Report the *effective* hierarchy rather than just failing. Discord sorts
            # equal positions by role ID ascending (lower ID ranks higher), so a fresh
            # apply usually already displays in blueprint order.
            mine = [
                all_roles[self.role_ids[n]] for n in wanted
                if self.role_ids[n] in all_roles
            ]
            effective = [
                r["name"] for r in
                sorted(mine, key=lambda r: (-r["position"], int(r["id"])))
            ]
            tied = len({r["position"] for r in mine}) < len(mine)

            if effective == wanted:
                print(f"  {GREEN('ok')}       display order already matches the blueprint")
            else:
                print(f"  {YELLOW('warn')}     display order differs from the blueprint:")
                for i, name in enumerate(effective, 1):
                    print(DIM(f"             {i}. @{name}"))

            if tied:
                msg = (
                    f"{len(mine)} roles share position 1, so Discord treats them as EQUAL "
                    f"rank. Moderation compares positions and a tie means neither side "
                    f"outranks the other -- @Maintainer cannot kick, ban, or manage the "
                    f"roles of anyone whose top role is @Contributor.\n"
                    f"        Ordering cannot be fixed via the API here: writing positions "
                    f"1-{len(wanted)} requires the bot above {len(wanted)}, but it sits at "
                    f"{bot_top}, and Discord refuses to renormalize.\n"
                    f"        FIX (5 seconds, one time): Server Settings > Roles, drag any "
                    f"role one slot and drop it back. The drag makes Discord renumber the "
                    f"whole list into distinct positions. Then re-run to lock in the order."
                )
                print(f"  {RED('warning')}  {msg}")
                self.stats.warnings.append(msg.replace("\n        ", " "))
            return

        payload = [
            {"id": self.role_ids[name], "position": bot_top - 1 - i}
            for i, name in enumerate(wanted)
        ]

        try:
            self.api.write("PATCH", f"/guilds/{self.guild_id}/roles", payload)
        except RuntimeError as exc:
            if "50013" not in str(exc):
                raise
            msg = (
                "Discord refused the role reordering (Missing Permissions). Drag the bot's "
                "role to the very top of Server Settings > Roles and re-run, or use "
                "--skip-role-order and drag the roles into order manually."
            )
            print(f"  {RED('warning')}    {msg}")
            self.stats.warnings.append(msg)
            return

        for i, name in enumerate(wanted, 1):
            print(f"  {GREEN('ordered')}    {i}. @{name}")

    # ----------------------------------------------------------- overwrites
    def build_overwrites(self, spec: dict | None) -> list[dict]:
        out = []
        for role_name, rules in (spec or {}).items():
            if role_name == "@everyone":
                rid = self.everyone_id
            elif role_name in self.role_ids:
                rid = self.role_ids[role_name]
            else:
                msg = f"Overwrite references unknown role {role_name!r}; skipped."
                self.stats.warnings.append(msg)
                print(f"  {RED('warning')}    {msg}")
                continue

            out.append({
                "id": rid,
                "type": OVERWRITE_TYPE_ROLE,
                "allow": str(perms_to_int(rules.get("allow", []))),
                "deny": str(perms_to_int(rules.get("deny", []))),
            })
        return out

    @staticmethod
    def overwrites_equal(current: list[dict], desired: list[dict]) -> bool:
        def norm(items):
            return sorted(
                (str(i["id"]), int(i.get("type", 0)), str(i.get("allow", "0")), str(i.get("deny", "0")))
                for i in items
            )
        return norm(current) == norm(desired)

    # ------------------------------------------------------------- channels
    def apply_channels(self) -> None:
        print(BLUE("\n[channels]"))
        existing = self.api.get(f"/guilds/{self.guild_id}/channels")
        by_key = {(c["name"].lower(), c["type"]): c for c in existing}

        for cat_index, cat in enumerate(self.cfg.get("categories", [])):
            cat_name = cat["name"]
            cat_overwrites = self.build_overwrites(cat.get("overwrites"))
            parent_id = self._upsert_channel(
                by_key,
                name=cat_name,
                ctype=CHANNEL_TYPES["category"],
                position=cat_index,
                overwrites=cat_overwrites,
                parent_id=None,
                label=f"{cat_name}/",
            )

            for ch_index, ch in enumerate(cat.get("channels", [])):
                ctype = CHANNEL_TYPES[ch.get("type", "text")]

                # Channel overwrites are layered ON TOP of the category's, so a
                # channel only needs to declare what differs. Merge by role id.
                merged = {o["id"]: o for o in cat_overwrites}
                for o in self.build_overwrites(ch.get("overwrites")):
                    merged[o["id"]] = o

                extra: dict[str, Any] = {}
                if "topic" in ch and ctype in (0, 5):
                    extra["topic"] = ch["topic"]
                if "user_limit" in ch and ctype == 2:
                    extra["user_limit"] = ch["user_limit"]
                if "default_auto_archive_duration" in ch and ctype in (0, 5):
                    extra["default_auto_archive_duration"] = ch["default_auto_archive_duration"]

                self._upsert_channel(
                    by_key,
                    name=ch["name"],
                    ctype=ctype,
                    position=ch_index,
                    overwrites=list(merged.values()),
                    parent_id=parent_id,
                    label=f"{cat_name}/#{ch['name']}",
                    extra=extra,
                )

    def _upsert_channel(
        self,
        by_key: dict,
        *,
        name: str,
        ctype: int,
        position: int,
        overwrites: list[dict],
        parent_id: str | None,
        label: str,
        extra: dict | None = None,
    ) -> str:
        extra = extra or {}
        key = (name.lower(), ctype)
        current = by_key.get(key)

        if current:
            payload: dict[str, Any] = {}

            if not self.overwrites_equal(current.get("permission_overwrites", []), overwrites):
                payload["permission_overwrites"] = overwrites
            if parent_id and current.get("parent_id") != parent_id:
                payload["parent_id"] = parent_id
            for k, v in extra.items():
                if current.get(k) != v:
                    payload[k] = v

            if payload:
                self.api.write("PATCH", f"/channels/{current['id']}", payload)
                print(f"  {YELLOW('updated')}    {label}  ({', '.join(payload)})")
                self.stats.updated += 1
            else:
                print(f"  {DIM('unchanged')}  {label}")
                self.stats.unchanged += 1
            return current["id"]

        payload = {
            "name": name,
            "type": ctype,
            "position": position,
            "permission_overwrites": overwrites,
            **extra,
        }
        if parent_id:
            payload["parent_id"] = parent_id

        created = self.api.write("POST", f"/guilds/{self.guild_id}/channels", payload)
        by_key[key] = {**payload, "id": created["id"], "permission_overwrites": overwrites}
        print(f"  {GREEN('created')}    {label}")
        self.stats.created += 1
        return created["id"]

    # ------------------------------------------------------------ preflight
    def preflight(self) -> bool:
        """Verify token, guild membership, and role position before touching anything."""
        print(BLUE("\n[preflight]"))

        try:
            me = self.api.get("/users/@me")
        except RuntimeError as exc:
            if "401" in str(exc):
                print(f"  {RED('FAIL')}  Token rejected (401).")
                print(DIM("        The token is wrong, or was reset in the Developer Portal."))
                print(DIM("        Developer Portal > your app > Bot > Reset Token."))
                print(DIM("        Note: this is the BOT token, not the Client Secret "
                          "and not the Application ID."))
                return False
            raise
        print(f"  {GREEN('ok')}    token valid -> bot user "
              f"{me.get('username')}#{me.get('discriminator', '0')} (id {me['id']})")

        guilds = self.api.get("/users/@me/guilds")
        match = next((g for g in guilds if str(g["id"]) == str(self.guild_id)), None)

        if not match:
            print(f"  {RED('FAIL')}  Bot is not a member of guild {self.guild_id}.")
            if guilds:
                print(DIM(f"        This bot is in {len(guilds)} guild(s):"))
                for g in guilds:
                    print(DIM(f"          {g['id']}  {g['name']}"))
                print(DIM("        If the server you want is listed, copy its ID from above."))
            else:
                print(DIM("        This bot is not in ANY guild — the invite never completed."))
            print(DIM("\n        Invite it (replace CLIENT_ID with your Application ID):"))
            print(DIM(f"          https://discord.com/api/oauth2/authorize"
                      f"?client_id=CLIENT_ID&scope=bot&permissions=8"))
            print(DIM("\n        Also confirm you copied the SERVER id, not a channel id:"))
            print(DIM("          right-click the server ICON in the left rail > Copy Server ID"))
            return False

        print(f"  {GREEN('ok')}    guild found -> {match['name']}")

        if not self.args.skip_role_order:
            member = self.api.get(f"/guilds/{self.guild_id}/members/{me['id']}")
            all_roles = {r["id"]: r for r in self.api.get(f"/guilds/{self.guild_id}/roles")}
            bot_top = max(
                (all_roles[r]["position"] for r in member.get("roles", []) if r in all_roles),
                default=0,
            )
            # Positions are relative, not fixed slots: creating a role shifts every
            # role above it up by one. So the only thing that matters is whether the
            # bot's role sits above the roles it will manage — not the raw number.
            above = [
                r["name"] for r in all_roles.values()
                if r["position"] > bot_top and r["name"] != "@everyone"
            ]
            blocking = [n for n in above if n in {s["name"] for s in self.cfg.get("roles", [])}]

            if blocking:
                print(f"  {YELLOW('warn')}  These blueprint roles sit ABOVE the bot's role "
                      f"and cannot be modified: {', '.join(blocking)}")
                print(DIM("        Server Settings > Roles > drag the bot's role to the top."))
            elif above:
                print(f"  {GREEN('ok')}    bot role at position {bot_top}; "
                      f"{len(above)} role(s) above it are not managed by this blueprint "
                      f"({', '.join(above)})")
            else:
                print(f"  {GREEN('ok')}    bot role is the highest in the guild "
                      f"(position {bot_top})")

        return True

    # ---------------------------------------------------------------- entry
    def run(self) -> None:
        if not self.preflight():
            raise SystemExit(1)
        self.apply_guild_settings()
        self.apply_roles()
        self.apply_role_order()
        self.apply_channels()


# --------------------------------------------------------------------------
def main() -> int:
    p = argparse.ArgumentParser(description="Provision the Snoomp Discord server.")
    p.add_argument("--config", type=Path, default=DEFAULT_CONFIG,
                   help="Blueprint YAML (default: discord-blueprint.yaml)")
    p.add_argument("--guild-id", default=os.getenv("DISCORD_GUILD_ID"),
                   help="Target guild ID (or set DISCORD_GUILD_ID)")
    p.add_argument("--token", default=os.getenv("DISCORD_BOT_TOKEN"),
                   help="Bot token (or set DISCORD_BOT_TOKEN)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print the plan without writing anything")
    p.add_argument("--check", action="store_true",
                   help="Run preflight diagnostics only (token, guild membership, role position)")
    p.add_argument("--skip-guild-settings", action="store_true")
    p.add_argument("--skip-role-order", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    if not args.config.exists():
        print(RED(f"Config not found: {args.config}"), file=sys.stderr)
        return 1
    if not args.token:
        print(RED("Missing bot token. Set DISCORD_BOT_TOKEN or pass --token."), file=sys.stderr)
        return 1
    if not args.guild_id:
        print(RED("Missing guild ID. Set DISCORD_GUILD_ID or pass --guild-id."), file=sys.stderr)
        return 1

    config = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    config.pop("anchors", None)  # YAML anchor holder, not real config

    if args.check:
        mode = BLUE("PREFLIGHT ONLY")
    elif args.dry_run:
        mode = YELLOW("DRY RUN — no changes will be written")
    else:
        mode = GREEN("APPLY")
    print(f"Snoomp Discord provisioner  |  guild {args.guild_id}  |  {mode}")

    client = DiscordClient(args.token, dry_run=args.dry_run or args.check, verbose=args.verbose)
    try:
        builder = ServerBuilder(client, str(args.guild_id), config, args)
        if args.check:
            return 0 if builder.preflight() else 1
        builder.run()
    except SystemExit:
        return 1
    except RuntimeError as exc:
        print(RED(f"\nAPI error: {exc}"), file=sys.stderr)
        return 1
    finally:
        client.close()

    s = builder.stats
    print(BLUE("\n[summary]"))
    print(f"  created {s.created}   updated {s.updated}   unchanged {s.unchanged}")
    if s.warnings:
        print(RED(f"  {len(s.warnings)} warning(s):"))
        for w in s.warnings:
            print(RED(f"    - {w}"))
    if args.dry_run:
        print(DIM("\n  Nothing was written. Re-run without --dry-run to apply."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
