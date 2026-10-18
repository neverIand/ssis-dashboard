# Documentation

| Task | Canonical document |
| --- | --- |
| Install, configure, test and manage local files | [Local development](installation.md) |
| Understand scope, delivery phases and budgets | [Roadmap](roadmap.md) |
| Understand architecture, hosting and rollback | [Modernization plan](MODERNIZATION_PLAN.md) |
| Find current status, open gates and the next task | [Progress](PROGRESS.md) |
| Pick the next native detail/section task | [Phase 4 tasks](PROGRESS.md#phase-4--native-execution-workflows), [detail architecture](MODERNIZATION_PLAN.md#native-execution-detail-and-section-ownership) |
| Prepare and run real-browser acceptance | [Frontend acceptance procedures](FRONTEND_ACCEPTANCE.md); current [pending status](PROGRESS.md#remaining-browser-acceptance) |
| Build an API client | [API semantics](API_CONTRACT.md), [OpenAPI schemas/examples](openapi.yaml) |
| Validate API correctness and performance | [API validation](API_ACCEPTANCE.md) |
| Repeat legacy/backend manual checks | [Backend checklist](BACKEND_CHECKLIST.md) |
| Build controlled SSIS packages and reader fixtures | [Fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md) |
| Consult old releases and the upstream container | [Legacy reference](legacy.md) |

The [opt-in native SQL suite](../tests/native/README.md) covers execution-query regression. Follow links to the owning document instead of copying status, rules or measurements between guides.

Use Progress for the completed baseline and next task. Acceptance procedures describe what to test; only dated results in the owning acceptance/progress record establish a pass.

Dated private evidence remains indexed under `.local/backend-validation/`; detailed pre-consolidation logs remain in Git at `36b48f8`. Historical results keep their dates and limitations.
