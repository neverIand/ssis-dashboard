"""Explicit WSGI entry point for hosts requiring an application object."""

from dashboard import create_app

app = create_app()
