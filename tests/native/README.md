# Native SQL regression tests

These opt-in tests execute the checked-in execution-page SQL on SQL Server using
connection-local synthetic sources. They check complete typed rows against an
independent full-result query: all 12 sorts and both directions, cursor ties and
NULL tails, selective/empty cohorts, retention, 100-ns timings, long durations,
wide Unicode names and same-name user/system parameters.

Use an existing private dashboard configuration with a SQL Server connection.
No SSISDB objects, data or permissions are changed. The tests require only the
project's normal test dependencies and the configured ODBC driver.

```powershell
$env:SSIS_DASHBOARD_NATIVE_TEST_CONFIG = (Resolve-Path .local/backend-validation/dashboard.cfg).Path
python -m unittest tests.native.test_execution_queries
Remove-Item Env:SSIS_DASHBOARD_NATIVE_TEST_CONFIG
```

Without the environment variable these tests skip during normal discovery.
Temporary-source correctness does not validate public-view permissions, catalog
performance or independent reader sign-in. Those remain separate native catalog
checks in [API workloads](../../docs/API_ACCEPTANCE.md#workload-protocol).
