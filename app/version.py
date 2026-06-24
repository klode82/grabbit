"""Single source of truth for the GRABBIT version.

Imported by the API (served at GET /api/version and shown in the header) and
available to any build tooling that wants to stamp the release.
"""

__version__ = "1.0.1"
