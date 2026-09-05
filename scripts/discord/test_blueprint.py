#!/usr/bin/env python3
"""
Offline test for setup_discord_server.py.

Runs the provisioner against an in-memory fake Discord API — no token, no
network. Asserts that a first pass creates the full structure and a second
pass against the resulting state is a no-op (idempotency).

    python test_blueprint.py
"""

from __future__ import annotations

import re
import sys
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import yaml  # noqa: E402

import setup_discord_server as sds  # noqa: E402


GUILD_ID = "999000111222333444"
BOT_USER_ID = "111111111111111111"


class FakeDiscord:
    """Minimal in-memory stand-in for the Discord REST API."""

    def __init__(self, guild_id: str = GUILD_ID):
        self.guild_id = guild_id
        self._seq = 1000
        self.guild = {
            "id": guild_id,
            "name": "new server",
            "verification_level": 0,
            "default_message_notifications": 0,
            "explicit_content_filter": 0,
        }
        # @everyone always exists, id == guild id, position 0
        self.roles = {
            guild_id: {
                "id": guild_id, "name": "@everyone", "permissions": "0",
                "color": 0, "hoist": False, "mentionable": False, "position": 0,
            }
        }
        # The bot's own managed role, parked at the top
        self.bot_role_id = self._new_id()
        self.roles[self.bot_role_id] = {
            "id": self.bot_role_id, "name": "SnoompSetup", "permissions": "8",
            "color": 0, "hoist": False, "mentionable": False, "position": 50,
        }
        self.channels: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []

    def _new_id(self) -> str:
        self._seq += 1
        return str(self._seq)

    # -- dispatcher ------------------------------------------------------
    def request(self, method: str, path: str, **kwargs):
        self.calls.append((method, path))
        body = kwargs.get("json")

        if method == "GET":
            if path == "/users/@me":
                return {"id": BOT_USER_ID, "username": "SnoompSetup", "discriminator": "0"}
            if path == "/users/@me/guilds":
                return [{"id": self.guild_id, "name": self.guild["name"]}]
            if path == f"/guilds/{self.guild_id}":
                return dict(self.guild)
            if path == f"/guilds/{self.guild_id}/roles":
                return [dict(r) for r in self.roles.values()]
            if path == f"/guilds/{self.guild_id}/members/{BOT_USER_ID}":
                return {"roles": [self.bot_role_id]}
            if path == f"/guilds/{self.guild_id}/channels":
                return [dict(c) for c in self.channels.values()]

        if method == "POST":
            if path == f"/guilds/{self.guild_id}/roles":
                # Verified against the live API: new roles are created at position 1
                # and existing roles are NOT renumbered, so positions end up tied.
                # Ties resolve by role ID. Do not "fix" this to shift positions.
                rid = self._new_id()
                self.roles[rid] = {"id": rid, "position": 1, **body}
                return dict(self.roles[rid])
            if path == f"/guilds/{self.guild_id}/channels":
                cid = self._new_id()
                self.channels[cid] = {
                    "id": cid, "parent_id": None, "topic": None,
                    "user_limit": 0, "permission_overwrites": [], **body,
                }
                return dict(self.channels[cid])

        if method == "PATCH":
            if path == f"/guilds/{self.guild_id}":
                self.guild.update(body)
                return dict(self.guild)
            if path == f"/guilds/{self.guild_id}/roles":       # bulk reorder
                # Verified against the live API: Discord rejects ANY requested position
                # at or above the caller's highest role, and does not renormalize to
                # make room. Observed as 400 with code 50013 (not 403).
                bot_pos = self.roles[self.bot_role_id]["position"]
                if max(i["position"] for i in body) >= bot_pos:
                    raise RuntimeError(
                        'PATCH roles -> 400\n{"message": "Missing Permissions", '
                        '"code": 50013}'
                    )
                for item in body:
                    self.roles[item["id"]]["position"] = item["position"]
                return [dict(r) for r in self.roles.values()]
            m = re.fullmatch(rf"/guilds/{self.guild_id}/roles/(\d+)", path)
            if m:
                self.roles[m.group(1)].update(body)
                return dict(self.roles[m.group(1)])
            m = re.fullmatch(r"/channels/(\d+)", path)
            if m:
                self.channels[m.group(1)].update(body)
                return dict(self.channels[m.group(1)])

        raise AssertionError(f"unhandled fake request: {method} {path}")


def run_pass(fake: FakeDiscord, config: dict, label: str) -> sds.Stats:
    # Bypass __init__ so no httpx.Client (and no network stack) is constructed.
    client = object.__new__(sds.DiscordClient)
    client.dry_run = False
    client.verbose = False
    client._fake_id = 0
    client.request = fake.request                      # type: ignore[method-assign]
    client.get = lambda p: fake.request("GET", p)      # type: ignore[method-assign]
    client.write = lambda m, p, payload: fake.request(m, p, json=payload)  # type: ignore

    args = Namespace(
        skip_guild_settings=False, skip_role_order=False, verbose=False, dry_run=False
    )
    print(f"\n{'=' * 68}\n  PASS: {label}\n{'=' * 68}")
    builder = sds.ServerBuilder(client, fake.guild_id, config, args)
    builder.run()
    return builder.stats


def main() -> int:
    cfg_path = Path(__file__).with_name("discord-blueprint.yaml")
    config = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    config.pop("anchors", None)

    failures: list[str] = []

    # ---- schema sanity -------------------------------------------------
    for role in config["roles"]:
        try:
            sds.perms_to_int(role.get("permissions", []))
            sds.hex_to_int(role.get("color"))
        except ValueError as exc:
            failures.append(f"role {role['name']}: {exc}")

    role_names = {r["name"] for r in config["roles"]} | {"@everyone"}
    n_channels = 0
    for cat in config["categories"]:
        targets = [(cat["name"], cat.get("overwrites"))]
        for ch in cat.get("channels", []):
            n_channels += 1
            if ch.get("type", "text") not in sds.CHANNEL_TYPES:
                failures.append(f"{cat['name']}/{ch['name']}: bad type {ch.get('type')}")
            targets.append((f"{cat['name']}/{ch['name']}", ch.get("overwrites")))
        for where, ow in targets:
            for rname, rules in (ow or {}).items():
                if rname not in role_names:
                    failures.append(f"{where}: overwrite for undefined role {rname!r}")
                for bucket in ("allow", "deny"):
                    try:
                        sds.perms_to_int(rules.get(bucket, []))
                    except ValueError as exc:
                        failures.append(f"{where}/{rname}.{bucket}: {exc}")

    if failures:
        print(sds.RED("Schema errors:"))
        for f in failures:
            print(sds.RED(f"  - {f}"))
        return 1
    print(sds.GREEN(
        f"Schema OK: {len(config['roles'])} roles, "
        f"{len(config['categories'])} categories, {n_channels} channels"
    ))

    # ---- pass 1: empty guild ------------------------------------------
    fake = FakeDiscord()
    s1 = run_pass(fake, config, "fresh guild")

    expected_created = len(config["roles"]) + len(config["categories"]) + n_channels
    if s1.created != expected_created:
        print(sds.RED(f"\nFAIL: expected {expected_created} creations, got {s1.created}"))
        return 1

    # ---- pass 2: idempotency ------------------------------------------
    s2 = run_pass(fake, config, "re-run (idempotency check)")

    print(sds.BLUE("\n[result]"))
    print(f"  pass 1: created {s1.created}  updated {s1.updated}  unchanged {s1.unchanged}")
    print(f"  pass 2: created {s2.created}  updated {s2.updated}  unchanged {s2.unchanged}")

    if s2.created or s2.updated:
        print(sds.RED(
            f"\nFAIL: re-run was not a no-op "
            f"({s2.created} created, {s2.updated} updated)"
        ))
        return 1
    if s1.warnings or s2.warnings:
        print(sds.RED(f"\nFAIL: {len(s1.warnings + s2.warnings)} warning(s)"))
        for w in s1.warnings + s2.warnings:
            print(sds.RED(f"  - {w}"))
        return 1

    print(sds.GREEN("\nPASS: fresh apply creates everything, re-run changes nothing."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
