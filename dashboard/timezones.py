"""Validate timezone configuration before time-dependent operations begin."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def validate_display_timezone(key):
    """Require a loadable IANA zone, including on hosts without system tzdata."""
    message = 'DISPLAY_TIMEZONE must name an available IANA time zone (install the pinned runtime requirements).'
    if not isinstance(key, str) or not 1 <= len(key) <= 128:
        raise ValueError(message)
    try:
        ZoneInfo(key)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError(message) from None
