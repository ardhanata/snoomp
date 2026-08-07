# Workspace Rules & Conventions

## Repository Context & Architecture
- Refer to [`CONTEXT.md`](file:///d:/Project/snoomp/CONTEXT.md) for Snoomp's full mission, multi-protocol checker domain architecture, deployment modes (Docker vs Standalone Native Windows), and UI/UX design invariants.

## Metric Accuracy & Checker Performance
- **CPU Percentage Calculation:** Always calculate CPU utilization from actual `%idle` sampling (`100 - %idle` via `top` / `vmstat` / `/proc/stat`) to match `nmon` and `top` exactly. If load average is used as fallback, normalize it by `cpu_cores` (`(load_1min / cpu_cores) * 100`). Never use unnormalized 1-minute load average directly as CPU percentage.
- **Checker Timeout Caps:** Keep default connection timeouts on external database and SSH checkers capped at 3–4 seconds to maintain sub-second UI responsiveness and prevent worker pool starvation.

