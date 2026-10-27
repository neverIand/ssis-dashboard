"""Serve the native browser shell and its packaged Vite entry without SQL."""

import json
import logging
from pathlib import Path, PurePosixPath

from flask import Blueprint, current_app, make_response, render_template, request, url_for

from dashboard.api_validation import identifier
from dashboard.observability import log_event, request_id
from dashboard.version import APP_VERSION


blueprint = Blueprint('frontend', __name__, url_prefix='/app')
NATIVE_CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; "
    "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


def _entry_assets():
    root = Path(current_app.static_folder) / 'app'
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if not isinstance(manifest, dict):
        raise ValueError('Invalid build manifest')
    styles, preloads, seen = [], [], set()

    def asset(filename):
        if not isinstance(filename, str) or not filename:
            raise ValueError('Invalid asset name')
        path = PurePosixPath(filename)
        if path.is_absolute() or '..' in path.parts or '\\' in filename or ':' in filename:
            raise ValueError('Invalid asset path')
        if not (root / filename).is_file():
            raise ValueError('Missing build asset')
        return url_for('static', filename=f'app/{filename}')

    def visit(key):
        if not isinstance(key, str):
            raise ValueError('Invalid chunk name')
        if key in seen:
            return
        seen.add(key)
        chunk = manifest[key]
        if not isinstance(chunk, dict):
            raise ValueError('Invalid build chunk')
        script = asset(chunk['file'])
        css, imports = chunk.get('css', []), chunk.get('imports', [])
        if not isinstance(css, list) or not isinstance(imports, list):
            raise ValueError('Invalid chunk dependencies')
        for filename in css:
            stylesheet = asset(filename)
            if stylesheet not in styles:
                styles.append(stylesheet)
        for dependency in imports:
            visit(dependency)
        if key != 'src/main.js':
            preloads.append(script)
        return script

    entry = manifest['src/main.js']
    if not isinstance(entry, dict) or entry.get('isEntry') is not True:
        raise ValueError('Missing build entry')
    return {'script': visit('src/main.js'), 'styles': styles, 'preloads': preloads, 'theme': asset('theme-init.js')}


def _shell(template, **config):
    try:
        assets = _entry_assets()
    except (OSError, ValueError, KeyError):
        log_event('frontend_assets_unavailable', level=logging.ERROR, request_id=request_id())
        response = make_response(render_template(
            'error.html', status=503, title='Application unavailable',
            detail='The dashboard could not load. Try again later or use the legacy dashboard.',
            request_id=request_id(),
        ), 503)
    else:
        response = make_response(render_template(template, assets=assets, app_version=APP_VERSION, app_config={
            'app_base': url_for('frontend.overview'),
            'api_base': url_for('api.metadata').rsplit('/', 1)[0] + '/',
            'execution_base': url_for('execution', execution_id=0).rsplit('/', 1)[0] + '/',
            **config,
        }))
        response.headers['Content-Security-Policy'] = NATIVE_CSP
    response.headers['Cache-Control'] = 'no-store'
    return response


@blueprint.get('/', merge_slashes=False)
def overview():
    return _shell('app/index.html')


@blueprint.get('/executions/<execution_id>', merge_slashes=False)
def execution(execution_id):
    identifier(execution_id)
    return _shell('app/execution.html', execution_id=execution_id)


@blueprint.get('/history', merge_slashes=False)
def history():
    return _shell('app/history.html')


def _asset_cache_headers(response):
    filename = (request.view_args or {}).get('filename', '')
    if (request.endpoint == 'static' and response.status_code in (200, 206, 304)
            and filename.startswith('app/assets/') and '..' not in PurePosixPath(filename).parts):
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return response


def register_frontend(app):
    app.register_blueprint(blueprint)
    app.after_request(_asset_cache_headers)
