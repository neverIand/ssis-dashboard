"""Browser isolation for the unauthenticated loopback service; no SQL."""

from flask import request
from werkzeug.exceptions import Forbidden


# Fetch Metadata: other sites may link to a page, but may not embed, script or
# fetch it. Clients without these headers (tools, health checks) are unaffected.
def _reject_cross_site():
    if request.routing_exception is not None:
        return
    if request.headers.get('Sec-Fetch-Site') != 'cross-site':
        return
    if (request.method in ('GET', 'HEAD') and request.headers.get('Sec-Fetch-Mode') == 'navigate'
            and request.headers.get('Sec-Fetch-Dest') == 'document'):
        return
    raise Forbidden()


def _isolation_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # Native shells supply their strict policy; legacy pages keep framing only.
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers.setdefault('Content-Security-Policy', "frame-ancestors 'none'")
    return response


def register_browser_policy(app):
    app.before_request(_reject_cross_site)
    app.after_request(_isolation_headers)
