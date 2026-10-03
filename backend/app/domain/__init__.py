"""BrewSync domain layer (Phase 4A).

Pure Python business objects and rules. This package must not import FastAPI,
SQLAlchemy, database, repository, HTTP or other infrastructure modules, must not
read the clock, environment or files, and must never use float for money.

Source of truth: docs/DECISIONS.md, docs/BUSINESS-RULES.md, docs/SYSTEM-LOGIC.md,
docs/DATABASE.md. Behaviour that depends on an OPEN decision raises
``UndecidedPolicy`` (see ``errors.py``) instead of guessing.
"""
