# Graph Report - .  (2026-08-07)

## Corpus Check
- 84 files · ~106,811 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 311 nodes · 584 edges · 16 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Database Models
- Frontend App Components
- Backend Init & Websockets
- Authentication Security
- Frontend Dependencies
- DB & DNS Checkers
- SSH & SNMP Checkers
- Status Page Routes
- TypeScript Configuration
- Target Routes
- Dashboard API

## God Nodes (most connected - your core abstractions)
1. `Target` - 23 edges
2. `CheckerResult` - 21 edges
3. `User` - 20 edges
4. `compilerOptions` - 16 edges
5. `execute_checker()` - 15 edges
6. `Heartbeat` - 14 edges
7. `SystemMetrics` - 11 edges
8. `receive_push_heartbeat()` - 11 edges
9. `check_ssh()` - 10 edges
10. `ConnectionManager` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Config` --uses--> `Target`  [INFERRED]
  backend/app/routes/targets.py → backend/app/models/target.py
- `ConnectionManager` --uses--> `Heartbeat`  [INFERRED]
  backend/app/main.py → backend/app/models/heartbeat.py
- `ConnectionManager` --uses--> `SystemMetrics`  [INFERRED]
  backend/app/main.py → backend/app/models/metrics.py
- `ConnectionManager` --uses--> `StatusPage`  [INFERRED]
  backend/app/main.py → backend/app/models/status_page.py
- `ConnectionManager` --uses--> `Target`  [INFERRED]
  backend/app/main.py → backend/app/models/target.py

## Import Cycles
- None detected.

## Communities (16 total, 0 thin omitted)

### Community 0 - "Database Models"
Cohesion: 0.12
Nodes (22): get_db(), Heartbeat, Base, Incident, Base, Base, SystemMetrics, Base (+14 more)

### Community 1 - "Frontend App Components"
Cohesion: 0.09
Nodes (28): react, ACCENT_COLORS, App(), applyAccent(), DEFAULT_SP_FORM, StatusPageData, StatusPageForm, uptimeBadgeClass() (+20 more)

### Community 2 - "Backend Init & Websockets"
Cohesion: 0.11
Nodes (27): init_db(), compile_initial_data(), ConnectionManager, get_app_version(), get_version(), _init_db_with_retry(), lifespan(), get (+19 more)

### Community 3 - "Authentication Security"
Cohesion: 0.12
Nodes (27): create_access_token(), get_current_user(), get_password_hash(), Session, RoleChecker, verify_password(), Base, User (+19 more)

### Community 4 - "Frontend Dependencies"
Cohesion: 0.06
Nodes (30): framer-motion, dependencies, framer-motion, lucide-react, react-dom, recharts, devDependencies, @types/react (+22 more)

### Community 5 - "DB & DNS Checkers"
Cohesion: 0.11
Nodes (19): CheckerResult, check_postgres(), Reject anything that isn't a single read-only SELECT., Verifies connection to a PostgreSQL database and runs a verification query., _validate_query(), check_dns(), Performs a DNS query for hostname using a specific record type (A, AAAA, MX,…, check_http() (+11 more)

### Community 6 - "SSH & SNMP Checkers"
Cohesion: 0.13
Nodes (20): evaluate_resource_status(), check_snmp(), _get_mock_metrics(), Check server metrics via SNMP (CPU, Memory, Disk, Uptime), calculate_proc_stat_cpu_percent(), check_ssh(), _get_mock_metrics(), parse_metrics_output() (+12 more)

### Community 7 - "Status Page Routes"
Cohesion: 0.13
Nodes (20): Base, StatusPage, create_status_page(), delete_status_page(), get_public_status_page(), list_status_pages(), BaseModel, delete (+12 more)

### Community 8 - "TypeScript Configuration"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+13 more)

### Community 9 - "Target Routes"
Cohesion: 0.13
Nodes (18): Config, create_target(), delete_target(), get_target(), Any, BaseModel, delete, get (+10 more)

### Community 10 - "Dashboard API"
Cohesion: 0.15
Nodes (17): api_route, get_db_engine_status(), get_recent_incidents(), get_stats(), get_target_heartbeats(), get_target_metrics(), Any, get (+9 more)

## Knowledge Gaps
- **47 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+42 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Target` connect `Database Models` to `Target Routes`, `Backend Init & Websockets`, `Status Page Routes`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `check_ssh()` connect `SSH & SNMP Checkers` to `Database Models`, `DB & DNS Checkers`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `User` connect `Authentication Security` to `Database Models`, `Backend Init & Websockets`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `Target` (e.g. with `ConnectionManager` and `StatusPageCreate`) actually correct?**
  _`Target` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `User` (e.g. with `RoleChecker` and `ConnectionManager`) actually correct?**
  _`User` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _47 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Database Models` be split into smaller, more focused modules?**
  _Cohesion score 0.12012012012012012 - nodes in this community are weakly interconnected._