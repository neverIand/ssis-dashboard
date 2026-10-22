# Running on Azure? If True will display the "Fork Me On GitHub" banner
AZURE = False

# Enable or disable Flask debug mode
DEBUG = False

# Application timing/error events; Python logger levels apply process-wide.
LOG_LEVEL = 'INFO'

# Google Analytics Code to monitor dashboard usage
GOOGLE_ANALYTICS = None

# Connection string to SSISDB
CONNECTION_STRING = {
                    "main": "DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=SSISDB;UID=;PWD=",
                    }

# Accepted Host header names; ports are ignored. Any other name gets a 400, which
# blocks DNS rebinding against this unauthenticated loopback service. Must be a
# non-empty list: Flask treats None or [] as "allow every host". Add a name only
# for a reviewed proxy/hosting setup that actually serves it.
TRUSTED_HOSTS = ['localhost', '127.0.0.1']

# Positive driver-level timeouts in seconds; tune against the real test catalog.
DB_LOGIN_TIMEOUT_SECONDS = 10
DB_QUERY_TIMEOUT_SECONDS = 30

# NOW uses the request clock. Fixed dates accept an offset, or one unambiguous
# local time in DISPLAY_TIMEZONE. The API filters creation time, not historical status.
AS_OF_DATE = 'NOW'

# IANA timezone for API display buckets and legacy fixed-date input.
# Validated at startup; legacy SQL display formatting is unchanged.
DISPLAY_TIMEZONE = 'Europe/London'

# Local API policy; these flags do not introduce browser/SQL identity delegation.
API_EVENTS_ENABLED = False
API_VALUES_ENABLED = False
API_OVERRIDE_VALUES_ENABLED = False
API_MAX_RANGE_HOURS = 744
API_MAX_TIMELINE_BUCKETS = 1000
API_READINESS_TIMEOUT_SECONDS = 2

# Paging-cursor signing secret: None or at least 32 bytes (str or bytes), kept out
# of Git like CONNECTION_STRING. None uses a random key per process, so cursors
# fail across workers and after a restart. Set one shared value for multi-worker
# hosts, e.g. python -c "import secrets; print(secrets.token_hex(32))".
API_CURSOR_SECRET_KEY = None

# Time range to display. Data will be shown from AS_OF_DATE - HOUR_SPAN value to AS_OF_DATE.
HOUR_SPAN = 360

# How many of the past executions should we show on the dashboard?
EXECUTION_COUNT=1000
