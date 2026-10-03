# BrewSync — Tools & Technologies

## Frontend
- React
- TypeScript
- TSX
- Vite
- CSS

## Backend
- Python
- FastAPI
- Uvicorn

## OOP / Architecture
- Python Classes
- Domain Model
- Encapsulation
- Abstraction
- Composition
- Domain-driven business logic
- Services
- Repositories

## Database
- PostgreSQL — actual relational database
- Supabase — hosted/managed PostgreSQL platform
- SQLAlchemy — ORM
- psycopg — PostgreSQL database driver
- Alembic — database migration tool
- Pydantic — validation and API schemas

### PostgreSQL vs. Supabase

PostgreSQL is the actual database technology: it stores BrewSync's data, and the
backend talks to it through SQLAlchemy and psycopg, with the schema managed by
Alembic migrations. Supabase is the platform that hosts and manages that
PostgreSQL database (provisioning, connection pooling, backups, dashboard). It
is not a separate database engine.

## Testing
- Python unittest
- Backend unit tests
- Integration tests
- End-to-end (E2E) testing
- Browser/API workflow verification

## Development Tools
- Cursor IDE
- Claude Code
- ChatGPT
- PowerShell
- Google Chrome / Chrome DevTools

## UI / Design
- Stitch
- Behance — visual/UI inspiration
- React + TypeScript + CSS for implementation

## Deployment / Hosting
- Vercel — web application deployment
- Supabase — PostgreSQL database infrastructure

## Architecture Summary

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Python + FastAPI |
| OOP | Python Classes / Domain Model |
| ORM | SQLAlchemy |
| Validation | Pydantic |
| DB Driver | psycopg |
| Database | PostgreSQL |
| DB Platform | Supabase |
| Migrations | Alembic |
| Testing | unittest + Integration + E2E |
| IDE | Cursor |
| AI Coding | Claude Code |
| AI Assistant | ChatGPT |
| Design | Stitch |
| Deployment | Vercel |

## Python UI Framework

BrewSync does not use a Python UI framework such as Tkinter,
PySide6, Flet, Streamlit, or NiceGUI. The application UI is built
with React and TypeScript.
