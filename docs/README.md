# Documentation

Start with [current status and the three next actions](PROGRESS.md#next-actions). Use [the roadmap](roadmap.md#next-priorities) for priority/scope and the owning document below for detail.

| Task | Canonical document |
| --- | --- |
| Install, configure, build, run and manage local artifacts | [Local development](installation.md) |
| Understand scope, delivery phases and budgets | [Roadmap](roadmap.md) |
| Understand ownership, lifecycle, hosting and rollback | [Modernization plan](MODERNIZATION_PLAN.md) |
| Find completion status, accepted reviews, evidence and open gates | [Progress](PROGRESS.md) |
| Compare legacy/native workflows and resolve replacement gaps | [Frontend parity inventory](FRONTEND_PARITY.md) |
| Run browser/lifecycle/keyboard/layout acceptance | [Frontend acceptance procedures](FRONTEND_ACCEPTANCE.md); [current gate status](PROGRESS.md#remaining-browser-acceptance) |
| Build an API client | [API semantics](API_CONTRACT.md), [OpenAPI](openapi.yaml) |
| Validate API correctness, query work and performance | [API validation](API_ACCEPTANCE.md) |
| Repeat legacy/backend manual checks | [Backend checklist](BACKEND_CHECKLIST.md) |
| Build controlled SSIS packages and reader fixtures | [Fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md) |
| Consult old releases and the upstream container | [Legacy reference](legacy.md) |

The [opt-in native SQL suite](../tests/native/README.md) supplies query regressions, not independent-reader/production acceptance. Procedures define what to test; dated results establish only the conditions actually observed.

Update current status and pending work in Progress once. Link to contract, procedure and evidence owners instead of copying their contents or appending full implementation journals. Historical detail through 25 October remains in Git at `864ec53`; pre-17-October-consolidation logs remain at `36b48f8`. Private evidence stays in the ignored locations indexed by Progress and the local-artifact guide.
