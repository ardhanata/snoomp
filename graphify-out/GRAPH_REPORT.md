# Graph Report - snoomp  (2026-09-05)

## Corpus Check
- 113 files · ~135,692 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1471 nodes · 1968 edges · 109 communities (106 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `903c5d60`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- database.py
- App.tsx
- User
- CheckerResult
- package.json
- targets.py
- Session
- compilerOptions
- test_discord_notifications.py
- receive_push_heartbeat
- ConnectionManager
- conftest.py
- settings_store.py
- main.py
- Snoomp Discord Server Blueprint
- brandkit/SKILL.md
- Live verification — 2026-08-03, running instance (v0.3.0)
- discord.py
- ServerBuilder
- CORE DIRECTIVE: IMAGE-FIRST WEBSITE DESIGN TO CODE
- CORE DIRECTIVE: PREMIUM MOBILE APP IMAGE DIRECTION
- High-Agency Frontend Skill
- UserPreferencesModal.tsx
- runner.py
- Appendix B - Canonical Sources (read these before reinventing)
- Snoomp — security review
- Design Audit
- Analysis & Synthesis Instructions
- Agent Skill: Principal UI/UX Architect & Motion Choreographer (Awwwards-Tier)
- Target
- CORE DIRECTIVE: AWWWARDS-LEVEL IMAGE ART DIRECTION
- SKILL: Industrial Brutalism & Tactical Telemetry UI
- Changelog
- Accessibility & UX audit — snoomp frontend
- Design System: Taste Standard
- Part 2 — React & performance (Vercel rules)
- 2. THE COMBINATORIAL VARIATION ENGINE
- BatchEditModal.tsx
- PrintableReport.tsx
- 2026-07-23 Database Monitoring Design Spec
- Snoomp Executive Presentation & High-Performance Architecture Design Spec
- 4. DESIGN ENGINEERING DIRECTIVES (Bias Correction)
- thresholds.py
- Verification of "Snoomp Enterprise — Audit Findings Report"
- Snoomp — vulnerability assessment (VA)
- Snoomp Clean Enterprise SaaS Branding Specification
- Snoomp E2E Testing Framework Design
- 10. REFERENCE VOCABULARY (Pattern Names the Agent Should Know)
- tasteskill: Anti-Slop Frontend Skill
- CORE DIRECTIVE: AWWWARDS-LEVEL DESIGN ENGINEERING
- 22. STYLE VARIATION ENGINE
- Protocol: Premium Utilitarian Minimalism UI Architect
- Snoomp — Enterprise Infrastructure Health & Status Platform
- Architecture Refactor: Decoupling main.py
- Part 3 — Accessibility audit (WCAG 2.2 AA)
- 11. COMPONENT EXECUTION GUIDELINES
- 18. EXTRA CREATIVITY & IMPLEMENTATION EDGE
- UI-REVIEW-2026-07-30.md
- Part 1 — Web Interface Guidelines
- DatabaseMetricsChart.tsx
- 9. AI TELLS (Forbidden Patterns)
- 12. THE COMBINATORIAL VARIATION ENGINE
- 8. ANTI-AI-SLOP RULES
- Global Constraints
- 11. REDESIGN PROTOCOL
- 3. DEFAULT ARCHITECTURE & CONVENTIONS
- 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS
- Full-Output Enforcement
- 33. CATEGORY-SPECIFIC BIAS
- 13. COLOR & MATERIAL RULES
- 4. HERO MINIMALISM RULES
- Global Constraints
- Global Constraints
- Serious
- ExecutiveDashboard.tsx
- 29. ANTI-AI-SLOP RULES
- 5. IMAGE COUNT & PAGE SLICING
- init_db
- Global Constraints
- Global Constraints
- Part 4 — Design system: type and colour
- PublicStatusPage.tsx
- 0. BRIEF INFERENCE (Read the Room Before Anything Else)
- 12. THE BLOCK LIBRARY (Contract - Implementations Land Here Iteratively)
- 5. CONTEXT-AWARE PROACTIVITY
- 8. DARK MODE PROTOCOL
- 21. MOBILE ANTI-AI-TELLS RULE
- Part 5 — Menu and navigation reachability
- Part 6 — Aesthetic assessment
- Workspace Rules & Conventions
- 7. DIAL DEFINITIONS (Technical Reference)
- 33. DEFAULT SECTION PACKS
- 14. HERO MINIMALISM RULES
- 37. EXAMPLE INTERPRETATIONS
- 2. PLATFORM MODE RULE
- 37. EXAMPLE INTERPRETATIONS
- 15. DEFAULT SITE PACKS
- 20. EXAMPLE INTERPRETATIONS
- Q: Why does Target connect Database Models to Target Routes, Backend Init & Websockets, Status Page Routes?
- rules/graphify.md
- workflows/graphify.md
- task-1-brief.md

## God Nodes (most connected - your core abstractions)
1. `CORE DIRECTIVE: IMAGE-FIRST WEBSITE DESIGN TO CODE` - 39 edges
2. `CORE DIRECTIVE: PREMIUM MOBILE APP IMAGE DIRECTION` - 39 edges
3. `Target` - 25 edges
4. `User` - 23 edges
5. `CORE DIRECTIVE: AWWWARDS-LEVEL IMAGE ART DIRECTION` - 22 edges
6. `CheckerResult` - 21 edges
7. `make_alert()` - 18 edges
8. `execute_checker()` - 16 edges
9. `compilerOptions` - 16 edges
10. `tasteskill: Anti-Slop Frontend Skill` - 16 edges

## Surprising Connections (you probably didn't know these)
- `StatusPageCreate` --uses--> `Target`  [INFERRED]
  backend/app/routes/status_pages.py → backend/app/models/target.py
- `StatusPageUpdate` --uses--> `Target`  [INFERRED]
  backend/app/routes/status_pages.py → backend/app/models/target.py
- `TargetCreateUpdate` --uses--> `Target`  [INFERRED]
  backend/app/routes/targets.py → backend/app/models/target.py
- `Config` --uses--> `User`  [INFERRED]
  backend/app/routes/auth.py → backend/app/models/user.py
- `discord_config()` --calls--> `_env_flag()`  [INFERRED]
  backend/app/services/settings_store.py → backend/app/notifications/discord.py

## Import Cycles
- None detected.

## Communities (109 total, 3 thin omitted)

### Community 0 - "database.py"
Cohesion: 0.17
Nodes (13): Incident, Base, Base, SystemMetrics, Sends notification to one or more Apprise URIs., send_notification(), Time-series retention. Heartbeats accumulate at one row per monitor per check…, # NOTE: on TimescaleDB, system_metrics is a hypertable and (+5 more)

### Community 1 - "App.tsx"
Cohesion: 0.15
Nodes (18): App(), applyAccent(), copyToClipboard(), DEFAULT_SP_FORM, monitorShareUrl(), numberFmt, parseStatusFilter(), PSEUDO_FS_PREFIXES (+10 more)

### Community 2 - "User"
Cohesion: 0.12
Nodes (27): create_access_token(), get_current_user(), get_password_hash(), Session, RoleChecker, verify_password(), Base, User (+19 more)

### Community 3 - "CheckerResult"
Cohesion: 0.06
Nodes (41): CheckerResult, evaluate_resource_status(), Classify a set of resource readings. `thresholds` overrides the module defaults…, check_postgres(), Reject anything that isn't a single read-only SELECT., Verifies connection to a PostgreSQL database and runs a verification query., _validate_query(), check_dns() (+33 more)

### Community 4 - "package.json"
Cohesion: 0.06
Nodes (30): framer-motion, dependencies, framer-motion, lucide-react, react-dom, recharts, devDependencies, @types/react (+22 more)

### Community 5 - "targets.py"
Cohesion: 0.18
Nodes (20): create_target(), delete_target(), get_target(), list_targets(), BaseModel, delete, get, put (+12 more)

### Community 6 - "Session"
Cohesion: 0.18
Nodes (12): delete_status_page(), get_public_status_page(), list_status_pages(), delete, get, put, Session, Public status page data — no authentication required. Returns page info plus… (+4 more)

### Community 7 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+13 more)

### Community 8 - "test_discord_notifications.py"
Cohesion: 0.05
Nodes (35): DummyClient, enabled(), fake_redis(), FakePipeline, FakeRedis, make_alert(), no_network(), fixture (+27 more)

### Community 9 - "receive_push_heartbeat"
Cohesion: 0.10
Nodes (28): api_route, _fleet_mttr(), get_db_engine_status(), get_recent_incidents(), get_sla_trend(), get_stats(), get_target_heartbeats(), get_target_metrics() (+20 more)

### Community 10 - "ConnectionManager"
Cohesion: 0.43
Nodes (3): ConnectionManager, websocket_endpoint(), WebSocket

### Community 11 - "conftest.py"
Cohesion: 0.43
Nodes (7): db_engine(), db_session(), postgres_container(), fixture, redis_client(), redis_container(), test_client()

### Community 12 - "settings_store.py"
Cohesion: 0.07
Nodes (38): Base, Instance-wide configuration, one row per key. Deliberately key/value rather…, Setting, AppearanceSettings, DefaultsSettings, DiscordSettings, BaseModel, get (+30 more)

### Community 13 - "main.py"
Cohesion: 0.15
Nodes (15): get_db(), get_app_version(), get_version(), get, read_root(), Heartbeat, Base, Base (+7 more)

### Community 15 - "Snoomp Discord Server Blueprint"
Cohesion: 0.04
Nodes (44): 1. Routing, 2. Create the webhooks, 3. Configure, 4. Verify, 5. Rate limiting, 6. Security, 7. Relationship to Apprise, 8. Troubleshooting (+36 more)

### Community 20 - "brandkit/SKILL.md"
Cohesion: 0.05
Nodes (43): 1. Logo Cover, 1. Monogram + Meaning, 2 × 3 REFERENCE-STYLE LAYOUT, 2. Logo Construction, 2. Product Action, 3. Digital Application, 3. Metaphor Fusion, 4. Brand Essence (+35 more)

### Community 21 - "Live verification — 2026-08-03, running instance (v0.3.0)"
Cohesion: 0.05
Nodes (39): Confirmed fixed ✓, Landed and verified ✓, Live verification — 2026-08-03, running instance (v0.3.0), Method note, Note on the pattern, On the "YAGNI, use the OS screenshot tool" advice, Open — critical, Open — data integrity and visual design (monitor detail, database type) (+31 more)

### Community 22 - "discord.py"
Cohesion: 0.10
Nodes (34): alerts_enabled(), build_message(), channel_for(), _clip(), DiscordAlert, enqueue(), _env_flag(), flush() (+26 more)

### Community 23 - "ServerBuilder"
Cohesion: 0.12
Nodes (15): DiscordClient, hex_to_int(), main(), perms_to_int(), Any, Perform a request, retrying on 429 using Discord's retry_after., A mutating call. Suppressed in dry-run mode., Reorder roles to match blueprint order, directly under the bot's top role. (+7 more)

### Community 24 - "CORE DIRECTIVE: IMAGE-FIRST WEBSITE DESIGN TO CODE"
Cohesion: 0.06
Nodes (34): 10. IMAGE-FIRST CODEX WEBSITE WORKFLOW, 11. WHEN TO TRIGGER IMAGE GENERATION FIRST, 13. WEBSITE REFERENCE RULE, 15. RESPONSIVE FIRST-VIEW RULE, 16. ANTI-NESTED-BOX RULE, 17. REDUCE MICRO-UI CLUTTER RULE, 18. SECTION IMAGE GENERATION RULE, 19. WEBSITE IMAGE SYSTEM RULE (+26 more)

### Community 25 - "CORE DIRECTIVE: PREMIUM MOBILE APP IMAGE DIRECTION"
Cohesion: 0.06
Nodes (34): 10. DEVICE MOCKUP FRAME RULE, 11. ONBOARDING FLOW RULE, 12. FIRST SCREEN CLEANLINESS RULE, 13. SAFE AREA AND SYSTEM REGION RULE, 14. NAVIGATION RULE, 15. CLEAN LAYOUT RULE, 16. CREATIVE IMAGE DIRECTION RULE, 17. BACKGROUND TEXTURE AND SURFACE RULE (+26 more)

### Community 26 - "High-Agency Frontend Skill"
Cohesion: 0.06
Nodes (30): 10. FINAL PRE-FLIGHT CHECK, 1. ACTIVE BASELINE CONFIGURATION, 2. DEFAULT ARCHITECTURE & CONVENTIONS, 3. DESIGN ENGINEERING DIRECTIVES (Bias Correction), 4. CREATIVE PROACTIVITY (Anti-Slop Implementation), 5. PERFORMANCE GUARDRAILS, 6. TECHNICAL REFERENCE (Dial Definitions), 7. AI TELLS (Forbidden Patterns) (+22 more)

### Community 27 - "UserPreferencesModal.tsx"
Cohesion: 0.11
Nodes (26): PreferencesTagsTab(), PreferencesTagsTabProps, pct, SlaConfig, SlaDraft, TabId, TABS, ThresholdDraft (+18 more)

### Community 28 - "runner.py"
Cohesion: 0.13
Nodes (21): lifespan(), add_target_job(), _flush_discord_alerts(), _make_job(), _purge_old_data(), Job function that pushes check request to Celery queue, falling back to direct…, Shuts down the scheduler gracefully., Dynamically schedules a job for a new/updated target. (+13 more)

### Community 29 - "Appendix B - Canonical Sources (read these before reinventing)"
Cohesion: 0.09
Nodes (21): APPENDICES - Real Source-Backed Reference Material, Appendix A - Install Commands per Design System, Appendix B - Canonical Sources (read these before reinventing), Appendix C - Apple Liquid Glass: Honest Web Approximation, Apple Liquid Glass (Apple platforms only), Atlassian, Bootstrap, Carbon (+13 more)

### Community 30 - "Snoomp — security review"
Cohesion: 0.10
Nodes (20): Critical, F1 — JWT signing secret is committed to the repository, F2 — WebSocket endpoint requires no authentication, F3 — Stored infrastructure credentials are returned to viewer-role users, F4 — Editor role can execute arbitrary SQL on monitored databases, F5 — Vulnerable Vite and esbuild, and the dev server is the production server, F6 — CORS allows any origin with credentials, F7 — No rate limiting on authentication (+12 more)

### Community 31 - "Design Audit"
Cohesion: 0.10
Nodes (19): Code Quality, Color and Surfaces, Component Patterns, Content, Design Audit, Fix Priority, How This Works, Iconography (+11 more)

### Community 32 - "Analysis & Synthesis Instructions"
Cohesion: 0.11
Nodes (18): 1. Define the Atmosphere, 2. Map the Color Palette, 3. Establish Typography Rules, 4. Define the Hero Section, 5. Describe Component Stylings, 6. Define Layout Principles, 7. Define Responsive Rules, 8. Encode Motion Philosophy (+10 more)

### Community 33 - "Agent Skill: Principal UI/UX Architect & Motion Choreographer (Awwwards-Tier)"
Cohesion: 0.11
Nodes (17): 1. Meta Information & Core Directive, 2. THE "ABSOLUTE ZERO" DIRECTIVE (STRICT ANTI-PATTERNS), 3. THE CREATIVE VARIANCE ENGINE, 4. HAPTIC MICRO-AESTHETICS (COMPONENT MASTERY), 5. MOTION CHOREOGRAPHY (FLUID DYNAMICS), 6. PERFORMANCE GUARDRAILS, 7. EXECUTION PROTOCOL, 8. PRE-OUTPUT CHECKLIST (+9 more)

### Community 34 - "Target"
Cohesion: 0.16
Nodes (10): asyncio, Base, Return the unredacted config_json — only for checker internals, never for API., Target, compile_initial_data(), Session, redis_listener(), test_target_creation_and_redaction() (+2 more)

### Community 35 - "CORE DIRECTIVE: AWWWARDS-LEVEL IMAGE ART DIRECTION"
Cohesion: 0.12
Nodes (16): 10. SECTION RHYTHM RULE, 12. DENSITY & SPACING DISCIPLINE, 14. IMAGE / MEDIA DIRECTION, 16. MULTI-IMAGE CONSISTENCY RULE, 17. CLARITY CHECK, 19. RESPONSE BEHAVIOR, 1. ACTIVE BASELINE CONFIGURATION, 21. FINAL GOAL (+8 more)

### Community 36 - "SKILL: Industrial Brutalism & Tactical Telemetry UI"
Cohesion: 0.12
Nodes (16): 1. Skill Meta, 2.1 Swiss Industrial Print, 2.2 Tactical Telemetry & CRT Terminal, 2. Visual Archetypes, 3.1 Macro-Typography (Structural Headers), 3.2 Micro-Typography (Data & Telemetry), 3.3 Textural Contrast (Artistic Disruption), 3. Typographic Architecture (+8 more)

### Community 37 - "Changelog"
Cohesion: 0.12
Nodes (16): [0.1.0] - 2026-07-25, [0.1.0-patch1] - 2026-07-26, [0.1.1] - 2026-07-26, [0.2.0] - 2026-07-27, [0.2.1] - 2026-07-30, [0.3.0] - 2026-08-07, Added, Added (+8 more)

### Community 38 - "Accessibility & UX audit — snoomp frontend"
Cohesion: 0.12
Nodes (15): Accessibility & UX audit — snoomp frontend, C1 — WebSocket status pill fails contrast in light mode, C2 — Primary navigation is not keyboard-operable, Critical, Moderate / Minor, Positive findings, React & performance (Vercel rules), Recommendations (+7 more)

### Community 39 - "Design System: Taste Standard"
Cohesion: 0.13
Nodes (14): 1. Visual Theme & Atmosphere, 2. Color Palette & Roles, 3. Typography Rules, 4. Component Stylings, 5. Hero Section, 6. Layout Principles, 7. Responsive Rules, 8. Motion & Interaction (Code-Phase Intent) (+6 more)

### Community 40 - "Part 2 — React & performance (Vercel rules)"
Cohesion: 0.13
Nodes (15): CRITICAL — `bundle-barrel-imports`, CRITICAL — `bundle-dynamic-imports`, CRITICAL — WebSocket has no reconnect and no error handling, HIGH — `async-parallel` waterfall, HIGH — request amplification, HIGH — `rerender-memo`, LOW — `MonitorModal.tsx:20–55`, MEDIUM — `advanced-init-once` (+7 more)

### Community 41 - "2. THE COMBINATORIAL VARIATION ENGINE"
Cohesion: 0.14
Nodes (14): 2. THE COMBINATORIAL VARIATION ENGINE, Background Character, Background Mode (per-section), Composition Anchor (per-section), CTA Variation, Hero Architecture, Hero Scale (per-page), Motion-Implied Language (+6 more)

### Community 42 - "BatchEditModal.tsx"
Cohesion: 0.21
Nodes (11): react, BatchEditModal(), BatchEditModalProps, ENV_KEYWORDS, isEnvTag(), normalizeTags(), Dialog(), DialogProps (+3 more)

### Community 43 - "PrintableReport.tsx"
Cohesion: 0.18
Nodes (8): formatDuration(), numberFmt, PrintableReport(), PrintableReportProps, rangeLabel(), ReportData, statusFor(), TimelineBucket

### Community 44 - "2026-07-23 Database Monitoring Design Spec"
Cohesion: 0.15
Nodes (12): 1. Goal, 2026-07-23 Database Monitoring Design Spec, 2. Technical Architecture (Hybrid Model), 3. Database Schema Changes, 4. UI / UX Design, 5. Verification Plan, A. Background Checkers, A. Monitor Details Page (+4 more)

### Community 45 - "Snoomp Executive Presentation & High-Performance Architecture Design Spec"
Cohesion: 0.15
Nodes (12): 1. Executive Summary & Value Proposition (Ringkasan Eksekutif), 2.1 Backend Engine (FastAPI), 2.2 Worker & Distributed Scheduler (Celery + Redis), 2.3 Storage Layer (TimescaleDB / PostgreSQL), 2. Technical Architecture & Component Breakdown, 3.1 TCO Savings Index Card (Indikator Penghematan Biaya), 3.2 Global SLA Scoreboard (Ketersediaan Layanan), 3.3 Financial Downtime Risk Meter (+4 more)

### Community 46 - "4. DESIGN ENGINEERING DIRECTIVES (Bias Correction)"
Cohesion: 0.17
Nodes (12): 4.10 Quotes & Testimonials, 4.11 Page Theme Lock (Light / Dark Mode Consistency), 4.1 Typography, 4.2 Color Calibration, 4.3 Layout Diversification, 4.4 Materiality, Shadows, Cards, 4.5 Interactive UI States, 4.6 Data & Form Patterns (+4 more)

### Community 47 - "thresholds.py"
Cohesion: 0.23
Nodes (11): apply(), evaluate(), _num(), Any, Effective alarm thresholds for a monitor, and the status they imply. Resolution…, Convenience wrapper: resolve this target's thresholds, then evaluate., Coerce to float, treating blanks and junk as 'not configured'., Merge a monitor's overrides onto the fleet-wide values. (+3 more)

### Community 48 - "Verification of "Snoomp Enterprise — Audit Findings Report""
Cohesion: 0.18
Nodes (11): 1. React Hook Exception — CONFIRMED ✅, 2. Duplicated CSV templates — OVERSTATED ⚠️, 3. TimescaleDB extension on SQLite — CONFIRMED ✅, fix is wrong ⚠️, 4. `passlib[bcrypt]` dependency — CONFIRMED ✅ and understated, fix is wrong ⚠️, 5. Speculative passive push monitor UI — FALSE ❌, 6. End-to-end browser section — methodology does not hold up ⚠️, 7. Corrected impact scoreboard, 8. Recommended action order (+3 more)

### Community 49 - "Snoomp — vulnerability assessment (VA)"
Cohesion: 0.18
Nodes (10): Low, Medium, N1 — Public status pages hand out the push endpoint's only credential, N2 — Unauthenticated 500 on the push endpoint via partial metrics, N3 — WebSocket accepts tokens for deactivated users, Priority, Regression check against 2026-08-03, Snoomp — vulnerability assessment (VA) (+2 more)

### Community 50 - "Snoomp Clean Enterprise SaaS Branding Specification"
Cohesion: 0.18
Nodes (10): 1. Executive Summary & Brand Purpose, 2.1 Logo Concept (`sn[oo]mp`), 2. Core Symbolism & Logo Architecture, 3.1 Light Mode Tokens (Default), 3.2 Dark Mode Tokens (Night Ops), 3. Color Token System, 4. Typography Hierarchy, 5. UI Component Architecture & Double-Bezel (+2 more)

### Community 51 - "Snoomp E2E Testing Framework Design"
Cohesion: 0.18
Nodes (10): 1. `conftest.py`, 2. `tests/models/`, 3. `tests/routes/`, 4. `tests/checkers/`, Architecture & Infrastructure, Execution Flow, Open Questions / Scope Limits, Overview (+2 more)

### Community 52 - "10. REFERENCE VOCABULARY (Pattern Names the Agent Should Know)"
Cohesion: 0.20
Nodes (10): 10. REFERENCE VOCABULARY (Pattern Names the Agent Should Know), Animation Library Choice, Cards & Containers, Galleries & Media, Hero Paradigms, Layout & Grids, Micro-Interactions & Effects, Navigation & Menus (+2 more)

### Community 53 - "tasteskill: Anti-Slop Frontend Skill"
Cohesion: 0.20
Nodes (10): 13. OUT OF SCOPE, 14. FINAL PRE-FLIGHT CHECK, 1.A Dial Inference (design read → dial values), 1.B Use-Case Presets, 1.C How the Dials Drive Output, 1. THE THREE DIALS (Core Configuration), 2.A When to reach for a real design system (use official packages), 2.B When the brief is an aesthetic, not a system (+2 more)

### Community 54 - "CORE DIRECTIVE: AWWWARDS-LEVEL DESIGN ENGINEERING"
Cohesion: 0.20
Nodes (9): 1. PYTHON-DRIVEN TRUE RANDOMIZATION (BREAKING THE LOOP), 2. AIDA STRUCTURE & SPACING, 3. HERO ARCHITECTURE & THE 2-LINE IRON RULE, 4. THE GAPLESS BENTO GRID, 5. ADVANCED GSAP MOTION & HOVER PHYSICS, 6. COMPONENT ARSENAL & CREATIVITY, 7. CONTENT, ASSETS & STRICT BANS, 8. MANDATORY PRE-FLIGHT <design_plan> (+1 more)

### Community 55 - "22. STYLE VARIATION ENGINE"
Cohesion: 0.20
Nodes (10): 22. STYLE VARIATION ENGINE, Decorative Asset Set, Image Art Direction Bias, Motion-Implied Language, Palette Logic, Signature Component Set, Structure Bias, Texture / Surface Treatment (+2 more)

### Community 56 - "Protocol: Premium Utilitarian Minimalism UI Architect"
Cohesion: 0.20
Nodes (9): 1. Protocol Overview, 2. Absolute Negative Constraints (Banned Elements), 3. Typographic Architecture, 4. Color Palette (Warm Monochrome + Spot Pastels), 5. Component Specifications, 6. Iconography & Imagery Directives, 7. Subtle Motion & Micro-Animations, 8. Execution Protocol (+1 more)

### Community 57 - "Snoomp — Enterprise Infrastructure Health & Status Platform"
Cohesion: 0.20
Nodes (9): 🎯 1. Executive Summary & Core Mission, 🏗️ 2. Architectural Overview & Domain Components, 🔌 3. Supported Checker Protocols (`backend/app/checkers/`), ⚙️ 4. Deployment Modes, 📏 5. Metric Accuracy & Code Conventions, 📝 6. Changelog & Versioning Rules (For Agents), Mode A: Production Docker Containerized, Mode B: Standalone Native Windows (No Docker Required) (+1 more)

### Community 58 - "Architecture Refactor: Decoupling main.py"
Cohesion: 0.20
Nodes (9): 1. `app/services/dashboard.py` (Data Aggregation), 2. `app/websockets.py` (Realtime Infrastructure), 3. `app/main.py` (Slimmed Entrypoint), Architecture Refactor: Decoupling main.py, Goals, Overview, Proposed Architecture, Testing Strategy (+1 more)

### Community 59 - "Part 3 — Accessibility audit (WCAG 2.2 AA)"
Cohesion: 0.20
Nodes (10): C1 — Custom controls are non-semantic and keyboard-inaccessible, C2 — `--text-muted` fails AA in dark mode, C3 — Modals have no dialog semantics or focus management, C4 — Form labels are not programmatically associated, Critical, Moderate / Minor, Part 3 — Accessibility audit (WCAG 2.2 AA), Positive findings (+2 more)

### Community 60 - "11. COMPONENT EXECUTION GUIDELINES"
Cohesion: 0.22
Nodes (9): 11. COMPONENT EXECUTION GUIDELINES, 3D Cascading Card Deck, Diagonal Staggered Square Masonry, Hover-Accordion Slice Layout, Off-Grid Editorial Layout, Pristine Gapless Bento Grid, Product UI Panel Stack, Turning Polaroid Arc (+1 more)

### Community 61 - "18. EXTRA CREATIVITY & IMPLEMENTATION EDGE"
Cohesion: 0.22
Nodes (9): 18. EXTRA CREATIVITY & IMPLEMENTATION EDGE, Composition variety check, Conversion focus, Cross-section contrast, CTA specificity, Cultural / tonal alignment, Data-viz restraint, Image variety inside one comp (+1 more)

### Community 62 - "UI-REVIEW-2026-07-30.md"
Cohesion: 0.22
Nodes (7): Claimed but not in the code ✗, Headline, Landed and verified ✓, New issue introduced by the chart-token fix, Snoomp frontend review — UI, React, accessibility, Still open from Rev 1 / Rev 2, v0.2.1 verification pass

### Community 63 - "Part 1 — Web Interface Guidelines"
Cohesion: 0.22
Nodes (9): frontend/index.html, Part 1 — Web Interface Guidelines, src/App.tsx, src/components/ExecutiveDashboard.tsx, src/components/MonitorModal.tsx, src/components/PublicStatusPage.tsx, src/components/RadialGauge.tsx, src/components/UserPreferencesModal.tsx (+1 more)

### Community 64 - "DatabaseMetricsChart.tsx"
Cohesion: 0.22
Nodes (8): compact, DatabaseMetricsChart(), DatabaseMetricsChartProps, DbEngine, Panel, PANELS, plain, Series

### Community 65 - "9. AI TELLS (Forbidden Patterns)"
Cohesion: 0.25
Nodes (8): 9.A Visual & CSS, 9. AI TELLS (Forbidden Patterns), 9.B Typography, 9.C Layout & Spacing, 9.D Content & Data ("Jane Doe" Effect), 9.E External Resources & Components, 9.F Production-Test Tells (banned outright), 9.G EM-DASH BAN (the single most-violated Tell)

### Community 66 - "12. THE COMBINATORIAL VARIATION ENGINE"
Cohesion: 0.25
Nodes (8): 12. THE COMBINATORIAL VARIATION ENGINE, Background Character, Hero Architecture, Motion-Implied Language, Section System, Signature Component Set, Theme Paradigm, Typography Character

### Community 67 - "8. ANTI-AI-SLOP RULES"
Cohesion: 0.25
Nodes (8): 8. ANTI-AI-SLOP RULES, Carousel / marquee slop (layout), Content slop, Data / KPI slop, Density slop, Layout slop, Typography slop, Visual slop

### Community 68 - "Global Constraints"
Cohesion: 0.25
Nodes (7): E2E Testing Framework Implementation Plan, Global Constraints, Task 1: Setup Dependencies, Task 2: Setup conftest.py, Task 3: Test Target Model, Task 4: Test User Model, Task 5: Test API Routes (Auth & Targets)

### Community 69 - "11. REDESIGN PROTOCOL"
Cohesion: 0.29
Nodes (7): 11.A Detect the Mode (first action), 11.B Audit Before Touching, 11.C Preservation Rules, 11.D Modernisation Levers (priority order), 11.E Decision Tree: Targeted Evolution vs Full Redesign, 11.F What Never Changes Silently, 11. REDESIGN PROTOCOL

### Community 70 - "3. DEFAULT ARCHITECTURE & CONVENTIONS"
Cohesion: 0.29
Nodes (7): 3.A Stack, 3.B State, 3.C Icons, 3.D Emoji Policy, 3. DEFAULT ARCHITECTURE & CONVENTIONS, 3.E Responsiveness & Layout Mechanics, 3.F Dependency Verification (mandatory)

### Community 71 - "6. PERFORMANCE & ACCESSIBILITY GUARDRAILS"
Cohesion: 0.29
Nodes (7): 6.A Hardware Acceleration, 6.B Reduced Motion (mandatory), 6.C Dark Mode (mandatory for any consumer-facing page), 6.D Core Web Vitals Targets, 6.E DOM Cost, 6.F Z-Index Restraint, 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS

### Community 72 - "Full-Output Enforcement"
Cohesion: 0.29
Nodes (6): Banned Output Patterns, Baseline, Execution Process, Full-Output Enforcement, Handling Long Outputs, Quick Check

### Community 73 - "33. CATEGORY-SPECIFIC BIAS"
Cohesion: 0.29
Nodes (7): 33. CATEGORY-SPECIFIC BIAS, Commerce, Fintech, Health / Fitness, Productivity, Social, Wellness / Lifestyle

### Community 74 - "13. COLOR & MATERIAL RULES"
Cohesion: 0.29
Nodes (7): 13. COLOR & MATERIAL RULES, Background Confidence Rule, Background-image harmony, Gradient Discipline, Materiality, Palette Discipline, Strong guidance

### Community 75 - "4. HERO MINIMALISM RULES"
Cohesion: 0.29
Nodes (7): 4. HERO MINIMALISM RULES, Absolute Hero Rules, Graphic Restraint, Headline Rule, Hero Composition Bias, Pre-output check, Typography Execution

### Community 76 - "Global Constraints"
Cohesion: 0.29
Nodes (6): Database Monitoring Implementation Plan, Global Constraints, Task 1: Backend Drivers & Requirements, Task 2: Background Checker Scripts for MongoDB and Redis, Task 3: API Route for Live Engine Diagnostics, Task 4: Frontend UI Extensions (Modal & Form Details)

### Community 77 - "Global Constraints"
Cohesion: 0.29
Nodes (6): Global Constraints, Snoomp Clean Enterprise SaaS Branding Implementation Plan, Task 1: Update Brand Favicon and Logo Icon Component, Task 2: Align Color Tokens & Double-Bezel CSS Utilities, Task 3: Integrate `SnoompLogo` and Double-Bezel Layout in Public Status Page and App Header, Task 4: Deploy & Verify Visual Identity

### Community 78 - "Serious"
Cohesion: 0.29
Nodes (7): S1 — Icon-only buttons have no accessible name, S2 — Async state changes are never announced, S3 — Information conveyed by color alone, S4 — Critical data is only available via `title`, S5 — No `prefers-reduced-motion` support, S6 — Heading hierarchy is inconsistent, and there's no skip link, Serious

### Community 79 - "ExecutiveDashboard.tsx"
Cohesion: 0.33
Nodes (6): domainIcon(), ExecutiveDashboard(), ExecutiveDashboardProps, numberFmt, SlaTrend, SlaTrendBucket

### Community 80 - "29. ANTI-AI-SLOP RULES"
Cohesion: 0.33
Nodes (6): 29. ANTI-AI-SLOP RULES, Content slop, Density slop, Layout slop, Typography slop, Visual slop

### Community 81 - "5. IMAGE COUNT & PAGE SLICING"
Cohesion: 0.33
Nodes (6): 5. IMAGE COUNT & PAGE SLICING, Continuity Rule, Counting rule, Format, Section size variety, THIS IS THE PRIMARY OUTPUT RULE

### Community 82 - "init_db"
Cohesion: 0.33
Nodes (6): _ensure_indexes(), init_db(), Create missing indexes on an existing schema. Never fatal., Rebuild time-series tables whose primary key was created as BIGINT. SQLite only…, _repair_sqlite_autoincrement(), _init_db_with_retry()

### Community 83 - "Global Constraints"
Cohesion: 0.33
Nodes (5): Global Constraints, Snoomp Executive Presentation & Command Center Implementation Plan, Task 1: Build `ExecutiveDashboard.tsx` Component, Task 2: Integrate Executive Dashboard Toggle in `App.tsx`, Task 3: Deploy & Verify Executive View

### Community 84 - "Global Constraints"
Cohesion: 0.33
Nodes (5): Architecture Refactor Implementation Plan, Global Constraints, Task 1: Extract Dashboard Service, Task 2: Extract WebSocket Infrastructure, Task 3: Rewire main.py

### Community 85 - "Part 4 — Design system: type and colour"
Cohesion: 0.33
Nodes (6): 4.1 Fonts — five families loaded, three used, two indistinguishable, 4.2 Type scale — 20 sizes, 189 of 258 declarations inside a 4px band, 4.3 Accent picker collides with the status palette, 4.4 Chart series are hardcoded and semantically confusing, 4.5 Surfaces and borders are too weak to build hierarchy, Part 4 — Design system: type and colour

### Community 86 - "PublicStatusPage.tsx"
Cohesion: 0.40
Nodes (4): PublicStatusPage(), PublicStatusPageProps, SnoompLogo(), SnoompLogoProps

### Community 87 - "0. BRIEF INFERENCE (Read the Room Before Anything Else)"
Cohesion: 0.40
Nodes (5): 0.A Read these signals first, 0.B Output a one-line "Design Read" before generating, 0. BRIEF INFERENCE (Read the Room Before Anything Else), 0.C If the brief is ambiguous, ask one question, do not guess, 0.D Anti-Default Discipline

### Community 88 - "12. THE BLOCK LIBRARY (Contract - Implementations Land Here Iteratively)"
Cohesion: 0.40
Nodes (5): 12.A File Location, 12.B Required Frontmatter, 12.C Required Body Sections, 12.D Block-Library Discipline, 12. THE BLOCK LIBRARY (Contract - Implementations Land Here Iteratively)

### Community 89 - "5. CONTEXT-AWARE PROACTIVITY"
Cohesion: 0.40
Nodes (5): 5.A Sticky-Stack - Canonical Skeleton, 5.B Horizontal-Pan - Canonical Skeleton, 5.C Scroll-Reveal Stagger - Canonical Skeleton (lighter alternative), 5. CONTEXT-AWARE PROACTIVITY, 5.D Forbidden Animation Patterns

### Community 90 - "8. DARK MODE PROTOCOL"
Cohesion: 0.40
Nodes (5): 8.A Token Strategy (pick one, stick to it), 8.B Do Not Prescribe Specific Colors Here, 8.C Default Mode, 8.D Test in Both Modes Before Finishing, 8. DARK MODE PROTOCOL

### Community 91 - "21. MOBILE ANTI-AI-TELLS RULE"
Cohesion: 0.40
Nodes (5): 21. MOBILE ANTI-AI-TELLS RULE, Copy AI tells, Layout AI tells, UI clutter tells, Visual AI tells

### Community 92 - "Part 5 — Menu and navigation reachability"
Cohesion: 0.40
Nodes (5): 5.1 Keyboard reachability, 5.2 Dead states and dead ends, 5.3 No URL state — the structural reachability failure, 5.4 React notes specific to the menus, Part 5 — Menu and navigation reachability

### Community 93 - "Part 6 — Aesthetic assessment"
Cohesion: 0.40
Nodes (5): 6.1 Dark mode — competent, generic, and compensating, 6.2 Light mode — this one has real problems, 6.3 What I would actually do, Part 6 — Aesthetic assessment, Suggested sequencing

### Community 94 - "Workspace Rules & Conventions"
Cohesion: 0.50
Nodes (3): Metric Accuracy & Checker Performance, Repository Context & Architecture, Workspace Rules & Conventions

### Community 95 - "7. DIAL DEFINITIONS (Technical Reference)"
Cohesion: 0.50
Nodes (4): 7. DIAL DEFINITIONS (Technical Reference), DESIGN_VARIANCE (Level 1-10), MOTION_INTENSITY (Level 1-10), VISUAL_DENSITY (Level 1-10)

### Community 96 - "33. DEFAULT SECTION PACKS"
Cohesion: 0.50
Nodes (4): 12-section pack, 33. DEFAULT SECTION PACKS, 4-section pack, 8-section pack

### Community 97 - "14. HERO MINIMALISM RULES"
Cohesion: 0.50
Nodes (4): 14. HERO MINIMALISM RULES, Absolute Hero Rules, Headline Rule, Hero Cleanliness Rule

### Community 98 - "37. EXAMPLE INTERPRETATIONS"
Cohesion: 0.50
Nodes (4): 37. EXAMPLE INTERPRETATIONS, Example 1, Example 2, Example 3

### Community 99 - "2. PLATFORM MODE RULE"
Cohesion: 0.50
Nodes (4): 2. PLATFORM MODE RULE, Android-native premium, Cross-platform premium neutral, iOS-native premium

### Community 100 - "37. EXAMPLE INTERPRETATIONS"
Cohesion: 0.50
Nodes (4): 37. EXAMPLE INTERPRETATIONS, Example 1, Example 2, Example 3

### Community 101 - "15. DEFAULT SITE PACKS"
Cohesion: 0.50
Nodes (4): 12-section pack, 15. DEFAULT SITE PACKS, 4-section pack, 8-section pack

### Community 102 - "20. EXAMPLE INTERPRETATIONS"
Cohesion: 0.50
Nodes (4): 20. EXAMPLE INTERPRETATIONS, Example 1, Example 2, Example 3

### Community 103 - "Q: Why does Target connect Database Models to Target Routes, Backend Init & Websockets, Status Page Routes?"
Cohesion: 0.50
Nodes (3): Answer, Q: Why does Target connect Database Models to Target Routes, Backend Init & Websockets, Status Page Routes?, Source Nodes

## Knowledge Gaps
- **745 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+740 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `check_icmp()` connect `CheckerResult` to `database.py`, `targets.py`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `FakeRedis` connect `test_discord_notifications.py` to `CheckerResult`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `check_ssh()` connect `CheckerResult` to `database.py`, `targets.py`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `Target` (e.g. with `StatusPageCreate` and `StatusPageUpdate`) actually correct?**
  _`Target` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `User` (e.g. with `RoleChecker` and `Config`) actually correct?**
  _`User` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _745 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `User` be split into smaller, more focused modules?**
  _Cohesion score 0.11932773109243698 - nodes in this community are weakly interconnected._