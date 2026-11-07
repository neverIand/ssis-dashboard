"""
This script runs the ssis-dashboard-next application using a development server.
"""

import atexit
from os import environ

from flask.helpers import get_debug_flag

from dashboard import create_app
from dashboard.detector import start_for_process

app = create_app()


def serve(app, env=environ, run=None, register_exit=atexit.register):
    """Start the optional change detector and the development server with one debug decision.

    Resolve debug once, as app.run would (FLASK_DEBUG overrides the config), and pass it explicitly so
    the detector guard and the reloader agree: the reloader's watcher process never starts a detector.
    """
    host = env.get('SERVER_HOST', '127.0.0.1')
    try:
        port = int(env.get('SERVER_PORT', '5555'))
    except ValueError:
        port = 5555
    debug = get_debug_flag() if 'FLASK_DEBUG' in env else app.debug
    detector = start_for_process(app, reloader=debug, environ=env)
    if detector is not None:
        register_exit(detector.stop)
    (run or app.run)(host, port, threaded=True, debug=debug, use_reloader=debug)
    return detector


if __name__ == '__main__':
    serve(app)
