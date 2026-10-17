"""Serve the native browser shell and its packaged Vite entry without SQL."""

import json
import logging
from pathlib import Path, PurePosixPath

from flask import Blueprint, current_app, make_response, render_template, url_for

from dashboard.observability import log_event, request_id


blueprint = Blueprint('frontend', __name__, url_prefix='/app')


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
    return {'script': visit('src/main.js'), 'styles': styles, 'preloads': preloads}


@blueprint.get('/', merge_slashes=False)
def overview():
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
        response = make_response(render_template('app/index.html', assets=assets, app_config={
            'app_base': url_for('frontend.overview'),
            'api_base': url_for('api.metadata').rsplit('/', 1)[0] + '/',
            'execution_base': url_for('execution', execution_id=0).rsplit('/', 1)[0] + '/',
        }))
    response.headers['Cache-Control'] = 'no-store'
    return response


def register_frontend(app):
    app.register_blueprint(blueprint)
