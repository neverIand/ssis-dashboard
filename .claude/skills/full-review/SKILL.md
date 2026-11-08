---
name: full-review
description: Run the layered full-project review defined in docs/PROJECT_REVIEW.md. Only when the user asks for a full-project review.
disable-model-invocation: true
---

1. Read `docs/PROJECT_REVIEW.md` in full and follow it. It takes precedence over general review habits.
2. Check the prerequisites: a clean working tree and no task in progress. If either fails, ask the user whether to wait or to review `HEAD` without the uncommitted files.
3. Create `.local/reports/reviews/<YYYYMMDD>-full-review-<model-id>/` and the temporary run directory with an `.active` marker.
4. Keep one plan step and one chapter per stage: baseline, L1 to L5, synthesis.
5. Do not open earlier review reports until synthesis.
6. Change no tracked files and commit nothing. Finish by presenting `findings.md` and `decisions.md`, then wait for the user.
