# Repository workflow

Use `dev-next` as the development base for the modernization described in `docs/roadmap.md`. The roadmap is the source of truth; keep `docs/MODERNIZATION_PLAN.md` aligned with it.

The original repository, `https://github.com/yorek/ssis-dashboard`, and the `upstream` remote are read-only. **Never push to the original repository**, including through an explicit URL, other remote names, tags, or mirror pushes. Publish authorized changes only to the user's personal GitHub repository, currently `https://github.com/neverIand/ssis-dashboard` through `origin`. Verify the resolved push destination before publishing.

Keep local environments, downloaded wheels, and reusable temporary scripts in ignored directories such as `.venv/`, `wheelhouse/`, and `.local/`. Prefer vanilla JavaScript and authored CSS, minimize dependencies, and apply the dependency choices permitted by the roadmap.
