# Documentation

| Task | Canonical document |
| --- | --- |
| Install, configure, test and manage local files | [Local development](installation.md) |
| Understand scope, delivery phases and budgets | [Roadmap](roadmap.md) |
| Understand architecture, hosting and rollback | [Modernization plan](MODERNIZATION_PLAN.md) |
| Find current status, open gates and the next task | [Progress](PROGRESS.md) |
| Build an API client | [API semantics](API_CONTRACT.md), [OpenAPI schemas/examples](openapi.yaml) |
| Validate API correctness and performance | [API validation](API_ACCEPTANCE.md) |
| Repeat legacy/backend manual checks | [Backend checklist](BACKEND_CHECKLIST.md) |
| Build controlled SSIS packages and reader fixtures | [Fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md) |
| Consult old releases and the upstream container | [Legacy reference](legacy.md) |

The [opt-in native SQL suite](../tests/native/README.md) covers execution-query regression. Follow links to the owning document instead of copying status, rules or measurements between guides.

Dated private evidence remains indexed under `.local/backend-validation/`; detailed pre-consolidation logs remain in Git at `36b48f8`. Historical results keep their dates and limitations.
