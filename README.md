# ScheduleAI

ScheduleAI is a full-stack timetable generation platform with a React frontend and a FastAPI backend. It helps create conflict-free academic schedules, explore what-if changes, review analytics, and export timetables.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: FastAPI, SQLAlchemy, OR-Tools, SQLite
- Extras: Anthropic-powered NLP constraint parsing, Twilio integration, PDF and Excel export

## Project Structure

```text
.
|-- backend/
|   |-- main.py
|   |-- requirements.txt
|   |-- .env.example
|   |-- services/
|   `-- solver/
`-- frontend/
    |-- src/
    |-- package.json
    `-- vite.config.ts
```

## Features

- Institution, department, room, faculty, course, section, and section-course management
- Automated timetable generation with solver-based scheduling
- What-if timetable regeneration for faculty absence scenarios
- Slot locking and faculty substitution flows
- Timetable analytics for faculty load, room utilization, and section gaps
- Timetable export to Excel and PDF
- NLP-based constraint parsing
- Student-facing timetable view

## Prerequisites

- Node.js 18+
- Python 3.11+ recommended

## Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload --port 8000
```

The backend runs at `http://localhost:8000`.

Useful endpoints:

- `GET /health`
- `GET /docs`

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`.

Vite is configured to proxy `/api` requests to `http://localhost:8000`.

## Environment Variables

Create `backend/.env` from `backend/.env.example` and set values as needed:

```env
DATABASE_URL=sqlite:///./timetable.db
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
SECRET_KEY=change-me
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

Notes:

- `DATABASE_URL` defaults to a local SQLite database.
- `ANTHROPIC_API_KEY` is needed for NLP constraint parsing.
- Twilio values are only needed if WhatsApp or messaging features are used.

## Development Workflow

1. Start the backend on port `8000`.
2. Start the frontend on port `5173`.
3. Open the frontend in your browser.
4. Use the setup flow to add institution data before generating timetables.

## Git Notes

The root `.gitignore` excludes local-only artifacts such as:

- Python cache folders and virtual environments
- `frontend/node_modules`
- frontend build output
- backend local database files
- local `.env` files and editor junk
