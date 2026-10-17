# Repository workflow

Use `dev-next` as the development base for the modernization described in `docs/roadmap.md`. The roadmap is the source of truth; keep `docs/MODERNIZATION_PLAN.md` aligned with it.

The original repository, `https://github.com/yorek/ssis-dashboard`, and the `upstream` remote are read-only. **Never push to the original repository**, including through an explicit URL, other remote names, tags, or mirror pushes. Publish authorized changes only to the user's personal GitHub repository, currently `https://github.com/neverIand/ssis-dashboard` through `origin`. Verify the resolved push destination before publishing.

Keep local environments, downloaded wheels, and reusable temporary scripts in ignored directories such as `.venv/`, `wheelhouse/`, and `.local/`. Prefer vanilla JavaScript and authored CSS, minimize dependencies, and apply the dependency choices permitted by the roadmap.

Keep frontend pages simple and functional. Do not add slogans, marketing taglines or decorative filler copy.

Follow `docs/installation.md#local-artifacts` for local artifacts. Put disposable outputs in `.local/tmp/<task>-<run>/`, reusable helpers in `.local/tools/` or the existing backend tool folder, and selected evidence in dated runs. Mark active temporary work with `.active`; remove the marker only after its processes exit. Create run directories when a probe executes, not when a shared module is imported. Clean from a reviewed inventory; preserve working environments/configuration and hash-check evidence archives before deleting originals. Reuse `requirements-dev.txt` for contract tooling instead of installing a second package tree.

Read and update the tracked `docs/PROGRESS.md` for each code task. Keep tasks focused on a coherent milestone with concrete validation. When a roadmap/plan item needs several tasks, record its submilestones and remaining integration checks before expanding the implementation scope.

For SQL changes, validate database work as well as response size and wall-clock time. Ordinary column sorts should seek and select the bounded page before materializing or enriching it; evaluate whole-cohort metrics only when global calculated sorting requires them. Isolate event aggregation from unrelated joins, and inspect actual scans, rows read, logical reads and compilation costs under representative catalog visibility. Retain a verified reduction in work even when small-catalog timings vary, unless it causes a material regression or disproportionate complexity. Use `RECOMPILE` only where measured plan behavior justifies its recurring cost; do not add it defensively to every query. Record actual evidence and remaining workload/reader checks with each milestone.
