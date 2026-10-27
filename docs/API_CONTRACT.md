# Read-only API contract

All 14 Stage C GET operations and the separate G02 operational server-label GET are implemented (15 operations in the current inventory). [OpenAPI](openapi.yaml) is the field/schema/example reference (`1.0.0-draft.1`); this document defines semantic rules and local access policy. [Acceptance](API_ACCEPTANCE.md) records evidence; [progress](PROGRESS.md) records unfinished gates. The production stream belongs to phase 5.

## Transport and local access

The initial mode is a loopback-bound process under one configured SQL identity. All catalog reads obey that identity's current visibility; browser names/headers, IDs and cursors confer no rights. No login/delegation system, trusted proxy or shared/public deployment is introduced. A Host header outside `TRUSTED_HOSTS` (default `localhost`, `127.0.0.1`; ports ignored) gets 400 before routing on every route, which blocks DNS rebinding against the unauthenticated loopback service. Browser requests with `Sec-Fetch-Site: cross-site` get 403 before any SQL on every route, unless they are GET/HEAD top-level document navigations; this stops other sites from triggering catalog work through images, scripts, fetches or frames. Same-origin, same-site, user-initiated (`none`) and header-less tool requests are unaffected. Every response, including errors, legacy pages and static files, has `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`; the policy restricts framing only. OpenAPI's `security: []` describes this local mode. Keep one origin/base path; clients must support a later deployment prefix.

Monitoring uses GET without a body. HEAD has the same policy/status/headers and no body; automatic OPTIONS may return method information but still checks capability. Other methods return 405 with `Allow`. Every API/health response has `Cache-Control: no-store` and a server-generated `X-Request-ID`. Successful resources have `data` and `meta` including that request ID and a UTC `generated_at`.

| Setting | Default | Effect |
| --- | --- | --- |
| `API_EVENTS_ENABLED` | `False` | Deny event text/search with 403 before any SQL |
| `API_VALUES_ENABLED` | `False` | Deny both value sections with 403 before any SQL; enabled mode permits nonsensitive parameters and override metadata |
| `API_OVERRIDE_VALUES_ENABLED` | `False` | With values enabled, permit nonsensitive override values; otherwise return policy-redacted NULL |

Require actual booleans; override display requires values enabled. These flags govern API routes; legacy pages retain their existing SQL-identity access. Basic metadata/counts/observations/history need no text/value capability. `/meta` exposes effective flags, versions, timezone, vocabularies, sorts and limits, without identities or connection details.

A denied capability gives the same 403 regardless of execution existence. Allowed execution-scoped requests first check visibility: hidden/absent IDs have the same safe 404 after one empty lookup, with no follow-up queries. Visible empty collections return 200; permission/driver failures remain errors. Recheck visibility on subsequent requests. No cross-user result cache or wildcard CORS is introduced.

Sensitive parameter/override values are always NULL, even if a faulty adapter supplies plaintext. SQL masks before display conversion; serializers independently enforce sensitivity and policy. `sensitive` takes precedence over `policy`. Unredacted SQL NULL differs from redacted NULL and empty text. Never decrypt or infer missing values. Permitted events and nonsensitive values can contain operational secrets: enabling them authorizes exposure for this scope, not a claim that the text is harmless.

Application logs exclude raw URLs/inputs, searches/cursors, SQL/parameters, values/messages, connection strings and diagnostic exception text. Host/proxy/access/startup logs remain a separate hosting gate.

## Inputs and resource selection

Decode URL encoding once. Reject unknown/duplicate keys, empty values, malformed UTF-8/percent escapes, NUL and unsupported tokens before SQL. Integers use ASCII decimal digits without signs, whitespace, exponent or fractions; IDs also reject leading zeroes. Invalid supplied values never become defaults. Names are not trimmed or case-folded in Python; exact equality follows catalog collation, including case/accent/trailing-space equivalence. Encode a literal plus as `%2B`.

Folder/project/environment names allow 128 UTF-16 units and packages 260. OpenAPI character limits do not replace the SQL-width check. Literal `all`, `*`, `%`, `_`, `[`, slash, backslash and quotes are names, not sentinels. Explicit `folder_pattern`/`project_pattern` allow 512 UTF-16 units: only `*` is a wildcard, `\*` escapes it and `\\` is a literal backslash. Reject other/dangling escapes. Translate and bind escaped SQL LIKE patterns with sufficient width. Exact and pattern selectors for the same field are mutually exclusive.

| Resource under `/api/v1` | Inputs and default selection |
| --- | --- |
| `/meta` | No query parameters |
| `/folders` | `limit,cursor,sort,direction`; visible folders with at least one visible project; default name/ascending |
| `/projects` | Required exact `folder`, plus navigation paging; default name/ascending |
| `/executions` | Optional `folder,project,folder_pattern,project_pattern,from,to,status`, plus paging; default execution ID/descending |
| `/metrics/summary` | Same cohort inputs; validates status but counts all statuses; no paging |
| `/metrics/timeline` | Same cohort inputs plus `bucket=day|hour` (default day); selected statuses apply |
| `/executions/{id}` | Positive BIGINT path ID; no query parameters or overview time filter |
| `/executions/{id}/executables` | `limit,cursor,sort,direction`; default started time/ascending |
| `/executions/{id}/children` | `limit,cursor,sort,direction`; default started time/ascending |
| `/executions/{id}/events` | `limit,cursor,sort,direction,kind,q`; default message time/ascending, kind all |
| `/executions/{id}/values` | `section=parameters|overrides` (default parameters), `limit,cursor`; fixed section-ID/ascending |
| `/history` | Required `folder,project,package`; optional `match,status,limit,cursor,sort,direction`; exact by default, explicit `match=like` accepts SQL LIKE patterns; default statuses 2/7 and execution ID/descending; no overview dates |
| `/server` | No query parameters; one read of the configured SQL server display name, driver login/query caps at five seconds. No login/service/connection/credential fields; metadata remains database-free. |

Navigation ignores overview scope and returns actual folder/project IDs with unique aliases. Missing/hidden/empty named navigation and history scopes give equivalent empty 200 collections. Descriptions preserve NULL/empty text and allow 1024 UTF-16 units.

`status` is a comma-separated set of known codes 1–9, without spaces, duplicates, empty elements, `0` or `all`. Omission on list/timeline means every status, including future unknown output codes. Canonicalize selections for cursor binding. Unknown output codes retain their numeric value and name `unknown`; execution status and executable result use separate vocabularies.

## Time, cohort and types

Accept offset-aware RFC 3339 inputs with uppercase T/Z, up to seven fractional digits and offsets within ±14 hours. Reject offset-free inputs, `-00:00` and leap seconds. Output canonical UTC strings with seven fractional digits. The connection-local native converter and explicit SQL timestamp casts retain 100-ns precision; do not round cursor/time-window values through Python datetime or browser Date.

The execution cohort is `created_time >= from AND created_time < to`, including not-yet-started rows. Resolve omitted `to` from one request clock or configured fixed `AS_OF_DATE`; default `from` is `to - HOUR_SPAN` elapsed hours (360 by default). Require a positive span at most `API_MAX_RANGE_HOURS` (744 by default). The configured default window must fit that cap. Fixed dates use local midnight; offset-free fixed times must resolve unambiguously in `DISPLAY_TIMEZONE`, otherwise startup fails. A historical upper bound limits creation time, not the observation time of status/counts.

Reuse exact returned `meta.from`/`to` across list/summary/timeline requests. Summary counts every status and reports `status_scope: all`; it includes zero entries for nine known codes plus observed unknown codes in numeric order. Total includes all groups. Its combined group cap is 65,536, detected with one extra SQL group; invalid/duplicate/overflow data fails rather than truncating totals.

Timeline uses `DISPLAY_TIMEZONE` (default Europe/London) and zero-filled UTC intervals intersecting `[from,to)`. Partial edge buckets may extend beyond the window but count only its cohort. Days start at the first real midnight or the transition when midnight is skipped; repeated midnight belongs to one long day and a skipped date creates no fictional day. Hours use valid local hour starts plus offset transitions, including partial-hour transitions and distinct repeated hours. Intervals are contiguous and ordered in UTC. Reject unsupported calendar edges or more than `API_MAX_TIMELINE_BUCKETS` (1–1000) before SQL; never silently widen the bucket.

Timeline's created/started/succeeded/failed counts describe executions **created in the bucket**: started means a non-NULL actual start, success/failure means current status 7/4. They are not separate start/end-time throughput series. Empty selected-status metadata means all statuses. Summary intentionally ignores selected statuses.

IDs are positive SQL BIGINT decimal strings (up to 9,223,372,036,854,775,807); nullable LSNs also allow zero. Counts are nonnegative JSON integers at most 2^53−1. Timestamps and actual durations remain NULL without the required observations; negative observed durations fail safely. Active elapsed time uses `max(0, as_of - start)`; completed elapsed time uses the actual end. Durations/counts are numeric, booleans explicit, and nonfinite values/unknown Python types never fall back to string conversion. See OpenAPI for each code's integer width and nullable fields.

## Paging and sorting

Default page size is 50, maximum 200, independent of legacy `EXECUTION_COUNT`. Fetch at most limit+1 candidates for `has_more`; no exact total is required. Terminal pages return `has_more: false, next_cursor: null`. Collections without a time filter have NULL `meta.from`/`to`. First-page `as_of` stays fixed across continuations, separately from response `generated_at` and a historical `to`.

All sorts are global, with unique ID tie-breakers in the selected direction. NULLs sort last in both directions. Names use catalog collation; dates compare instants and codes/counts/durations compare numbers. Environment sorts folder then name with per-component NULL-last behavior.

| Collection | Allowed sort keys |
| --- | --- |
| Executions | `execution_id,created_at,started_at,ended_at,project_name,package_name,environment,status,logging_level,duration_seconds,warning_count,error_count` |
| Folders / projects | `name` or `folder_id` / `project_id` respectively |
| Executables | `started_at,statistics_id` |
| Children | `started_at,observation_id` |
| Events | `message_time,event_id` |
| History | `execution_id` |
| Values | Fixed `execution_parameter_id` or `property_id`, ascending only |

Ordinary execution keys select the bounded page before counts/logging enrichment. The four calculated sorts require global keys before paging; duration sorts by actual end−start, never elapsed time. Exact raw keys retain 100-ns ordering and avoid whole-duration nanosecond overflow. Materialized/output limits do not imply bounded source reads.

Opaque cursor v2 tokens are HMAC-authenticated with a server key: random per process by default, or derived from `API_CURSOR_SECRET_KEY` so workers and restarts share it. Each app keeps the key it derived at startup. Bind resource/version, canonical selection, limit/order, SQL/policy scope, first-page `as_of`, upper ID, last exact key/NULL flags and ID tie-breaker. Use keyed digests for search/filter/identity bindings; tokens never contain credentials, values or event text. Public name sort keys may appear. Tokens are at most 8192 characters and expire 30 minutes after creation, without renewal. Multi-worker hosts must configure one shared secret; other shared-worker coordination remains deferred hosting design.

Continue by repeating the original selection and cursor; windowed collections must send the returned explicit `from`/`to`. Defaults are valid only when they equal the original effective selection. Changed selection/direction/policy/scope, altered/malformed tokens or old formats return 400 `invalid_cursor`; expiration returns `cursor_expired`. With the default random key, restart invalidates all cursors. Refresh from page one after these errors.

An initial visible maximum numeric ID fences later inserts; initially empty collections have NULL upper ID and no cursor. SQL visibility remains live. Retention/revocation, status changes or mutable sort keys can alter membership and cause duplicates/skips; no snapshot is promised. Consumers refresh/reset paging and deduplicate by identity when appropriate. A signature grants no access.

## Execution inspection and observations

Detail is independent of overview dates and returns five recorded event counts. It counts every visible recorded event, including NULL-ID rows. Duplicate warnings (`OnWarning` with `%duplicate%`) and memory warnings (`OnInformation` with `%memory allocation%`) are legacy full-text heuristics under catalog collation, not structured classifiers. Counts do not prove logging completeness or child success. Recheck visibility before event aggregation; missing/revoked execution visibility yields the common 404.

Executables use public `statistics_id`; repeated invocations sharing an executable stay separate. Preserve NULL/missing metadata and unfinished timings/results. Do not select the user-defined execution value as duration/result. Candidate rows are bounded before metadata lookup. Names retain 4000 UTF-16 units; paths allow 16,384 Unicode characters and fail safely if oversized, without partial identity strings.

Children are qualifying `OnPreExecute` observations at exact root `\Package` paths beneath a parent execution path. Use the numeric start event ID as observation identity. Pair only unambiguous adjacent pre/post events for the exact package/path/source/type, including trailing-space distinctions. Consecutive starts, missing identity/end, reversed timing or unidentified events in that key leave the observation incomplete. End events may arrive above the start-ID fence. `complete` means an observed pair, never a child result or separate execution.

Executables/events/children are `available` when identified rows are returned, unless unknown-ID coverage overrides that result. With no rows, only a recorded system logging level of zero establishes `not-recorded`; other/missing logging leaves `unknown`. Empty/exhausted paging alone does not prove logging completeness.

## Events and values

Event kinds are `all,errors,warnings,duplicate-warnings,memory-warnings`. Apply the full-source category filter and literal substring `q` before pagination; q is at most 512 Unicode characters / 1024 UTF-16 units. Case folding uses fixed Unicode `Latin1_General_100_CI_AS_SC`, followed by binary UTF-16 comparison. Search has no wildcard syntax, trimming or tokenization. This is independent of the catalog-collation legacy category heuristics.

Events and children cannot page records without public numeric IDs. Report `has_unidentified_events` or `has_unidentified_starts`, forcing `availability: unknown` even if the page is empty or logging is none. Event coverage uses the same category/search scope and is rechecked on continuations. `has_more` describes identified rows only. Do not fabricate IDs from GUIDs, hashes or row numbers; detail counts can exceed pageable events. Real Scale Out remains an integration gate.

Event messages preserve NULL, empty and HTML-like text. SQL projects a bounded 32,770 UTF-16-unit prefix with a safe surrogate edge; serialization emits at most 16,384 Unicode characters and marks `truncated` from actual character count. Full-message search/heuristics include suffixes beyond this display cap. Oversized metadata fails safely; no partial path identity is returned. Unknown SMALLINT message/source codes and nullable source types are retained.

Value sections have separate ascending-ID fences, queries and cursors. Parameters retain `execution_parameter_id`, the catalog `parameter_data_type` label and explicit flags; overrides retain `property_id`, property path and sensitivity. Missing required ID/sensitivity columns are unsupported compatibility, not permission to invent identities. Cursor state contains numeric IDs, never names/paths/values. Policy changes invalidate old cursors.

Return a display-safe string/NULL rather than arbitrary sql_variant JSON. Parameters use precision-preserving float/real conversion, hexadecimal binary, style 126 date/time/decimal conversion, and decimal integer/bit strings. Preserve unknown type labels and decimal scale. Override text uses the same bounded Unicode prefix/wire cap as events. Metadata widths remain 128 UTF-16 units for names/types and 4000 for property paths. Sensitive/policy masking precedes conversion and is independently enforced by the serializer; invalid flags/required metadata fail closed.

## History and estimates

History requires folder/project/package, has no implicit time window, and defaults to the latest 50 running/succeeded executions (statuses 2/7). Omitted `match` or `match=exact` retains exact identity and the original 128/128/260 UTF-16 name limits. Explicit `match=like` accepts three bound SQL LIKE selectors up to 512 UTF-16 units each: `%` and `*` match any text, `_` matches one character, and SQL bracket sets/ranges retain their catalog-collation semantics. The API treats `all` as ordinary text; only legacy bookmark conversion translates that path sentinel to `%`. Mode and normalized selectors bind cursors, preventing reuse across exact/pattern or changed scope. Explicit known-status selection and both ID directions are allowed. It preserves real execution IDs and actual timings. Missing/hidden named scopes are empty 200 collections. Candidate IDs are bounded before event/logging/metadata enrichment; duplicate system logging rows fail safely, and integer conversion guards the system parameter identity. Broad history estimates still sample only each row's own exact folder/project/package, never neighboring packages in the matched result.

An estimate uses at most five visible successful runs of the same exact identity, excluding the target, with non-NULL start/end, nonnegative duration and end at or before the target start. Choose by end time descending, then ID descending; sample eligibility is independent of page status/ID fences. Include zero-duration samples. Return NULL if there is no sample/start, the mean is zero or the estimated end exceeds the supported UTC range.

Otherwise return `mean_last_5_successful`, sample count, arithmetic mean duration and target start+mean as a separate estimated end. Keep exact integer 100-ns totals until division; round only the end to nearest tick, half up. A positive mean below half a tick can share the start timestamp. Never replace NULL actual end/duration or imply prediction accuracy. Current visibility/retention/status can change estimates; there is no historical visibility snapshot. The indexed prior-success timestamp source may grow with history and must be measured separately from page/sample bounds.

## Errors and health

Errors use RFC 9457 `application/problem+json`: `type: about:blank`, standard title, matching status, fixed safe detail, stable code and request ID. Omit rejected values, URL/instance and diagnostics. Unmatched API paths/methods are JSON; legacy errors remain HTML. Other HTTP errors keep their class within the fixed set: an unlisted 4xx returns 400 `invalid_input` and an unlisted 5xx returns 500 `internal_error`.

| Status | Code / behavior |
| --- | --- |
| 400 | `invalid_input`, `invalid_cursor`, `cursor_expired` |
| 401 | `unauthenticated`, reserved for a future real authentication boundary and challenge |
| 403 | `forbidden`, including denied capabilities |
| 404 | `not_found`, including hidden/absent executions |
| 405 | `method_not_allowed`, preserving `Allow` |
| 500 | `internal_error`, including unexpected types, unsupported data shapes and SQL permission/conversion failures |
| 503 | `database_unavailable`, connection/login/driver unavailable |
| 504 | `database_timeout`, native HYT00/HYT01 |

`/healthz` uses no database. `/readyz` performs a zero-row read in SSISDB, with login/query limits individually capped at 1–2 seconds; this is not a total HTTP deadline. Empty visibility may be ready. Successful cleanup or readiness does not establish workload, reader-login, host or stream acceptance.

Contract/schema tests run with `python -m unittest discover -s tests -v` after installing development requirements. Native comparisons and open gates are maintained in [acceptance](API_ACCEPTANCE.md) and [progress](PROGRESS.md), without repeating their status here.
