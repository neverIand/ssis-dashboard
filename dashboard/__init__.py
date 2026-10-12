"""Application construction and configuration, without database access."""

from copy import deepcopy
import os
from pathlib import Path

from flask import Flask

from dashboard import config as defaults


_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def create_app(config_overrides=None, *, config_path=None):
    """Create an independent app with the existing HTML routes.

    An explicit file takes precedence over DASHBOARD_CONFIG. Relative explicit
    and environment paths retain Flask's package-relative convention. With
    neither, the optional config.cfg lives at the project root, regardless of
    the working directory. A supplied mapping skips automatic file loading;
    an explicitly supplied file still loads before the mapping overrides it.
    """
    app = Flask(__name__)
    app.config.from_mapping(deepcopy({
        name: value for name, value in vars(defaults).items()
        if name.isupper()
    }))

    if config_path is not None:
        app.config.from_pyfile(os.fspath(config_path))
    elif config_overrides is None:
        environment_path = os.environ.get('DASHBOARD_CONFIG')
        if environment_path is not None:
            if not environment_path:
                raise ValueError('DASHBOARD_CONFIG must name a configuration file.')
            app.config.from_pyfile(environment_path)
        else:
            app.config.from_pyfile(str(_PROJECT_ROOT / 'config.cfg'), silent=True)

    if config_overrides is not None:
        app.config.from_mapping(deepcopy(config_overrides))

    from dashboard.db import validate_timeouts

    validate_timeouts(app.config['DB_LOGIN_TIMEOUT_SECONDS'], app.config['DB_QUERY_TIMEOUT_SECONDS'])

    from dashboard import filters, processors
    from dashboard.views import register_views

    register_views(app)
    app.context_processor(processors.utility_processor)
    app.add_template_filter(filters.project, 'project')
    app.add_template_filter(filters.folder, 'folder')
    return app
