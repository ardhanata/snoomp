# Snoomp Discord Server Provisioner

Applies [`docs/DISCORD-SERVER-BLUEPRINT.md`](../../docs/DISCORD-SERVER-BLUEPRINT.md) to a real
Discord guild. Declarative, idempotent, and safe to re-run.

```
scripts/discord/
├── discord-blueprint.yaml     # the structure: roles, categories, channels, permissions
├── setup_discord_server.py    # the provisioner
├── test_blueprint.py          # offline test — no token, no network
└── requirements.txt
```

---

## Install

```bash
pip install -r scripts/discord/requirements.txt
```

`httpx` is already a Snoomp backend dependency; `pyyaml` is the only addition.

---

## One-time Discord setup

### 1. Create the application and bot

1. Go to <https://discord.com/developers/applications> → **New Application**, name it `Snoomp Setup`
2. **Bot** tab → **Reset Token** → copy it. This is `DISCORD_BOT_TOKEN`.
3. Leave all Privileged Gateway Intents **off** — this script uses REST only.

### 2. Invite the bot with the right permissions

Build an invite URL with your application's Client ID:

```
https://discord.com/api/oauth2/authorize
  ?client_id=YOUR_CLIENT_ID
  &scope=bot
  &permissions=8
```

`permissions=8` is Administrator. The script needs `MANAGE_ROLES` + `MANAGE_CHANNELS` +
`MANAGE_GUILD` at minimum, but Discord will not let a bot grant a permission it doesn't
itself hold — and the blueprint grants `MANAGE_WEBHOOKS`, `BAN_MEMBERS`, and others to
`@Maintainer`. Administrator avoids a frustrating series of partial failures.

**Remove the bot from the server once provisioning is done.** A dormant admin bot is a
standing risk, and you only need it when the blueprint changes.

### 3. Move the bot's role to the top

Server Settings → Roles → drag `Snoomp Setup` above every other role.

Discord forbids a bot from creating, editing, or reordering any role positioned at or above
its own. If you skip this, role creation succeeds but ordering fails with a warning.

### 4. Get the guild ID

User Settings → Advanced → enable **Developer Mode**, then right-click the server icon →
**Copy Server ID**. This is `DISCORD_GUILD_ID`.

---

## Usage

```bash
export DISCORD_BOT_TOKEN="MTIz...."
export DISCORD_GUILD_ID="123456789012345678"

# Preview. Reads current state, writes nothing.
python scripts/discord/setup_discord_server.py --dry-run

# Apply.
python scripts/discord/setup_discord_server.py
```

PowerShell:

```powershell
$env:DISCORD_BOT_TOKEN = "MTIz...."
$env:DISCORD_GUILD_ID  = "123456789012345678"
python scripts\discord\setup_discord_server.py --dry-run
```

### Flags

| Flag | Effect |
|---|---|
| `--check` | Preflight only: verify token, guild membership, and role position. No writes. |
| `--dry-run` | Read current state and print the plan. No writes. |
| `--config PATH` | Use a different blueprint file |
| `--guild-id ID` | Override `DISCORD_GUILD_ID` |
| `--token TOKEN` | Override `DISCORD_BOT_TOKEN` (prefer the env var — argv is visible in `ps`) |
| `--skip-guild-settings` | Leave verification level, notifications, and content filter alone |
| `--skip-role-order` | Create roles but don't reposition them |
| `-v, --verbose` | Print request payloads in dry-run |

### Output

```
[roles]
  created    @Owner
  unchanged  @Maintainer
  updated    @Infra  (color, hoist)

[channels]
  created    OPERATIONS/#alerts-critical
  unchanged  DEV/#backend

[summary]
  created 3   updated 1   unchanged 38
```

---

## How idempotency works

| Object | Matched by | On match |
|---|---|---|
| Guild settings | — | PATCH only the fields that differ |
| Roles | name (exact) | PATCH if color/hoist/mentionable/permissions drift |
| Categories | name + type 4 | PATCH if permission overwrites differ |
| Channels | name + type | PATCH if overwrites, parent, topic, or user limit differ |

Nothing is ever deleted. Removing a channel from the YAML leaves the live channel in place —
delete it in Discord yourself. That's deliberate: an auto-deleting provisioner pointed at the
wrong guild ID is unrecoverable.

Renaming an entry in the YAML creates a new object rather than renaming the old one, because
matching is by name. Rename in Discord first, then in the YAML.

---

## Editing the blueprint

Permission names are the Discord API constants listed in `PERMISSIONS` at the top of
`setup_discord_server.py` (`VIEW_CHANNEL`, `SEND_MESSAGES`, `MANAGE_THREADS`, …).

**Channel overwrites layer on top of their category's.** A channel only declares what
differs; the script merges category overwrites first, then applies the channel's by role ID.
`OPERATIONS/#alerts-critical` is the example — it inherits the whole OPERATIONS block and
adds a single `Contributor: deny: [VIEW_CHANNEL]`.

Shared overwrite blocks live under the `anchors:` key as YAML anchors and are pulled in with
merge keys:

```yaml
overwrites:
  <<: [*hidden_everyone, *dev_team]
  Contributor:
    allow: [VIEW_CHANNEL, SEND_MESSAGES]
```

The `anchors:` key is stripped before the config is used, so it never reaches the API.

After any edit:

```bash
python scripts/discord/test_blueprint.py
```

---

## Testing

`test_blueprint.py` runs the provisioner against an in-memory fake Discord API. No token,
no network, no side effects. It checks:

1. **Schema** — every permission name resolves, every channel type is valid, every overwrite
   references a role that actually exists in the blueprint
2. **Fresh apply** — an empty guild produces exactly `roles + categories + channels` creations
3. **Idempotency** — a second pass over the resulting state reports zero created, zero updated

```bash
$ python scripts/discord/test_blueprint.py
Schema OK: 8 roles, 6 categories, 26 channels
  pass 1: created 40  updated 2  unchanged 0
  pass 2: created 0  updated 0  unchanged 42
PASS: fresh apply creates everything, re-run changes nothing.
```

A typo in a permission name is caught here rather than halfway through a live apply.

---

## Not automated

Discord's API can't do these — they're manual, and they're in the blueprint doc:

- **Server icon** — upload in Server Settings
- **Webhooks** — the GitHub and Snoomp alert webhooks. Creatable via API, but the URLs are
  secrets and shouldn't live in a repo file. Create them in each channel's Integrations tab.
- **Bots** — Carl-bot, Wick, Sesh invites and their reaction-role config
- **Invites** — generate per-person single-use 24h invites yourself
- **`#start-here` content** — write and pin it
- **2FA requirement for moderation** — needs the owner account, not a bot

---

## Troubleshooting

Start with `--check`. It verifies the token, lists every guild the bot is actually in, and
reports the bot's role position — which covers most setup failures in one call.

| Error | Cause |
|---|---|
| `404 Unknown Guild` (code 10004) | The bot is not in that guild. Discord returns 404, not 403, for guilds a bot can't see — so this is *never* a permissions problem. Either the invite never completed, or the ID is a channel/user ID rather than a server ID. Run `--check` to list the guilds the bot is in. |
| `401 Unauthorized` | Wrong token. Make sure it's the **Bot token**, not the Application ID or Client Secret. Resetting the token in the portal invalidates the old one. |
| `403 Missing Permissions` on roles | Bot's role isn't above the roles it's managing. Drag it to the top. |
| `403 Missing Access` on channels | Bot lacks `MANAGE_CHANNELS`, or the channel denies it `VIEW_CHANNEL` |
| `400 Invalid Form Body: verification_level` | Guild has requirements that block the level — Community servers can't drop below Low |
| `Discord refused the role reordering (403)` | The bot's role must sit above every role it repositions. Step 3 above. Or pass `--skip-role-order` and drag the roles manually. |

### A note on role positions

Two behaviours here are counter-intuitive and were both confirmed against the live API:

1. **Creating a role does not renumber the others.** Every freshly created role lands at
   position `1`, tied, with ties broken by role ID. So on a new guild you end up with eight
   roles all at position 1 and the bot still at position 2.
2. **Discord rejects any requested position at or above the caller's highest role**, and
   does not renormalize to make room. It returns **400 with code 50013** — note that's a
   400, not the 403 you'd expect from a permissions error.

Together these mean a bot on a sparse guild has nowhere to write an ordered block: ordering
8 roles needs positions 1-8, but the bot sits at 2. The script detects this before calling
the API rather than eating a 400 mid-run.

**The tie is not cosmetic.** The roles will *display* in the right order — Discord sorts
equal positions by role ID ascending, which matches creation order — but hierarchy checks
compare raw positions, and a tie means neither role outranks the other. With all eight at
position 1, `@Maintainer` cannot kick, ban, or manage the roles of anyone whose top role is
`@Contributor`.

The fix is one manual drag: **Server Settings > Roles, drag any role one slot and drop it
back.** A drag makes Discord renumber the entire list into distinct positions, which both
separates the ranks and lifts the bot's role high enough for the API to write an ordered
block. Re-run afterwards to lock the order in. This is a one-time cost per guild.

`test_blueprint.py` models both behaviours. Don't "fix" the fake to shift positions on
create or to renormalize on reorder — it will pass and the live run will fail.
| `Unknown permission: 'X'` | Typo in the YAML. Valid names are in `PERMISSIONS`. |

Rate limits (HTTP 429) are handled automatically — the client sleeps for Discord's
`retry_after` and retries up to 6 times. A full fresh apply is ~40 writes and takes well
under a minute.
