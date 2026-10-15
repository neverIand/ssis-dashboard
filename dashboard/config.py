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

# Positive driver-level timeouts in seconds; tune against the real test catalog.
DB_LOGIN_TIMEOUT_SECONDS = 10
DB_QUERY_TIMEOUT_SECONDS = 30

# Set to 'NOW' to show current data or any valid date to show data for a fixed date only
AS_OF_DATE = 'NOW'

# IANA timezone for the forthcoming API's display buckets and legacy date input.
# Validated at startup; legacy SQL display formatting is unchanged.
DISPLAY_TIMEZONE = 'Europe/London'

# Local API policy; these flags do not introduce browser/SQL identity delegation.
API_EVENTS_ENABLED = False
API_VALUES_ENABLED = False
API_OVERRIDE_VALUES_ENABLED = False
API_MAX_RANGE_HOURS = 744
API_MAX_TIMELINE_BUCKETS = 1000
API_READINESS_TIMEOUT_SECONDS = 2

# Time range to display. Data will be shown from AS_OF_DATE - HOUR_SPAN value to AS_OF_DATE.
HOUR_SPAN = 360

# How many of the past executions should we show on the dashboard?
EXECUTION_COUNT=1000
