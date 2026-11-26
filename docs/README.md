# Documentation

Start with [current status and the next actions](PROGRESS.md#next-actions). Use [the roadmap](roadmap.md#next-priorities) for priority/scope and the owning document below for detail.

| Task | Canonical document |
| --- | --- |
| Install, configure, build, run, test and manage local artifacts | [Installation](installation.md) |
| Use the native screens | [Using the dashboard](usage.md) |
| Understand scope, delivery phases and budgets | [Roadmap](roadmap.md) |
| Understand ownership, lifecycle, hosting and rollback | [Modernization plan](MODERNIZATION_PLAN.md) |
| Find completion status, accepted reviews, evidence and open gates | [Progress](PROGRESS.md) |
| Compare legacy/native workflows and resolve replacement gaps | [Frontend parity inventory](FRONTEND_PARITY.md) |
| Find the remaining office checks and concrete steps | [Next office run](FRONTEND_ACCEPTANCE.md#next-office-run); [office receipt and remaining status](PROGRESS.md#remaining-browser-acceptance) |
| Run browser/lifecycle/keyboard/layout acceptance | [Frontend acceptance procedures](FRONTEND_ACCEPTANCE.md); [current gate status](PROGRESS.md#remaining-browser-acceptance) |
| Build an API client | [API semantics](API_CONTRACT.md), [OpenAPI](openapi.yaml) |
| Validate API correctness, query work and performance | [API validation](API_ACCEPTANCE.md) |
| Repeat legacy/backend manual checks | [Backend checklist](BACKEND_CHECKLIST.md) |
| Review the whole project with a newly released model | [Full-project review](PROJECT_REVIEW.md) |
| Build controlled SSIS packages and reader fixtures | [Fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md) |
| Consult old releases and the upstream container | [Legacy reference](legacy.md) |

The [opt-in native SQL suite](../tests/native/README.md) supplies query regressions, not independent-reader/production acceptance. Procedures define what to test; dated results establish only the conditions actually observed.

Update current status and pending work in Progress once. Link to contract, procedure and evidence owners instead of copying their contents or appending full implementation journals; a completed task keeps a short receipt ([the rule](PROGRESS.md#evidence-and-documentation-maintenance)). Full journals through 15 November 2026 remain in Git at `6180174`, through 25 October at `864ec53`, and from before the 17 October consolidation at `36b48f8`. Private evidence stays in the ignored locations indexed by Progress and the local-artifact guide.
