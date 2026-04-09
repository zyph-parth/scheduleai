# ScheduleAI

ScheduleAI is a full-stack academic timetable generation platform built with a React frontend and a FastAPI backend. It helps an institution define its teaching structure, generate conflict-free schedules, inspect and edit slot-level outcomes, simulate faculty absences, analyze timetable quality, and expose read-only student and teacher timetable views.

The project is designed around a simple but practical workflow:

1. Create an institution calendar.
2. Add departments, rooms, faculty, courses, sections, and section-course mappings.
3. Generate a timetable with the OR-Tools solver.
4. Review the generated schedule, lock or substitute slots if needed.
5. Run what-if analysis for faculty absence scenarios.
6. Inspect analytics and export the timetable to Excel or PDF.
7. Share read-only student and teacher views based on the latest completed timetable.

## Contents

- [What The Project Does](#what-the-project-does)
- [Feature Inventory](#feature-inventory)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Core Data Model](#core-data-model)
- [Scheduling Logic And Solver Rules](#scheduling-logic-and-solver-rules)
- [Frontend Pages](#frontend-pages)
- [Backend API Overview](#backend-api-overview)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Seed Data](#seed-data)
- [Recommended End-To-End Workflow](#recommended-end-to-end-workflow)
- [Testing](#testing)
- [Exports](#exports)
- [NLP Constraint Parsing](#nlp-constraint-parsing)
- [Validation And Safety Rules](#validation-and-safety-rules)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

## What The Project Does

ScheduleAI is meant for institutional timetable planning. Instead of handcrafting weekly class grids, the application models:

- institutional working days and periods
- room inventory and room types
- faculty availability and subject eligibility
- course theory and practical hour requirements
- section size, semester, and department
- shared teaching arrangements through combined groups

From those inputs, the backend generates a timetable while trying to avoid overlaps and infeasible assignments. The UI then gives separate workflows for administrators, timetable reviewers, students, and teachers.

## Feature Inventory

### Institutional Setup

- Create and update institutions with:
  - working days
  - periods per day
  - break slots
  - period duration
  - day start time
- Create departments under an institution.
- Create rooms with capacity and room type:
  - `classroom`
  - `lab`
  - `lecture_hall`
- Create faculty with:
  - email
  - phone
  - subjects they can teach
  - unavailable slots
  - maximum consecutive periods
- Create courses with:
  - course name
  - course code
  - theory hours
  - practical hours
  - credit hours
  - core/elective flag
  - lab requirement flag
- Create sections with:
  - section name
  - student count
  - semester
- Map sections to courses and faculty.
- Create combined groups so multiple sections attend the same course together.

### Timetable Generation

- Generate a timetable for an institution.
- Optionally pass locked slots into generation requests.
- Persist generated timetables in the database.
- Track timetable status and solve time.
- Save constraint violations for infeasible results.
- List historical timetables for an institution.
- Open any stored timetable in the interactive timetable page.

### Timetable Operations

- Inspect slot details including course, faculty, room, duration, section, and flags.
- Toggle slot locking after generation.
- Find available substitute faculty for a slot.
- Replace the assigned faculty for a slot if a valid substitute is available.
- Highlight modified slots in the UI.
- Delete previously generated timetables.

### What-If Simulation

- Simulate faculty absence for:
  - all working days
  - selected days only
- Clone the original timetable into a new what-if timetable.
- Try to assign substitute faculty for affected slots.
- Convert uncovered lectures into breaks when no substitute is available.
- Return counts for:
  - total modified slots
  - substituted slots
  - break conversions

### Analytics

- Faculty weekly load analysis.
- Faculty wellbeing score estimation based on teaching-hour balance.
- Room utilization statistics.
- Section free-period gap analysis.
- Core subject morning-placement analysis.
- Summary counters for slots, rooms used, and core scheduling quality.

### Read-Only Views

- Student view:
  - select institution
  - select branch/department
  - select semester
  - select section
  - load the latest completed timetable for that section
- Teacher view:
  - select institution
  - select department
  - select a faculty member who actually teaches in that department
  - load the latest completed timetable for that faculty member

### Exports

- Excel export of timetable data.
- PDF export of timetable data.
- Multi-section formatting with section-specific sheets/pages.
- Room, faculty, and course labels included in exported cells.

### NLP Support

- Parse natural-language scheduling constraints.
- Use institution-aware parsing context:
  - faculty names
  - course names
  - start time
  - period duration
  - configured period indexes
- Support a local fallback parser when no Anthropic API key is configured.
- Detect patterns such as:
  - faculty unavailability
  - core-subject morning preference
  - day restrictions
  - max consecutive periods

### Developer Support

- Seed script for demo data.
- Backend test suite for core scheduling flows.
- SQLite default setup for quick local development.
- Vite proxy for frontend-to-backend local development.

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Axios
- React Router
- Recharts
- React Hot Toast
- Lucide React

### Backend

- FastAPI
- SQLAlchemy
- Pydantic v2
- SQLite by default
- Google OR-Tools CP-SAT solver
- OpenPyXL for Excel export
- ReportLab for PDF export
- Anthropic SDK for optional NLP parsing

## Architecture Overview

The application is split into two top-level apps:

- `frontend/`
  - a Vite React SPA
  - communicates with the backend through `/api`
  - contains admin setup pages, timetable operations pages, analytics, and read-only viewer pages
- `backend/`
  - a FastAPI application
  - contains inline routes in `main.py`
  - persists entities in SQLite through SQLAlchemy
  - uses OR-Tools to solve timetable placement
  - handles export generation and NLP parsing

At runtime:

1. The frontend sends CRUD and generation requests to FastAPI.
2. FastAPI validates payloads and loads related database objects.
3. The solver receives a normalized scheduling input model.
4. The solver returns either a feasible schedule or a set of conflicts.
5. The backend stores the timetable, slots, and violations.
6. The frontend loads the timetable, analytics, and exports from the backend.

## Project Structure

```text
.
|-- backend/
|   |-- config.py
|   |-- database.py
|   |-- main.py
|   |-- models.py
|   |-- requirements.txt
|   |-- schemas.py
|   |-- seed.py
|   |-- solver/
|   |   `-- engine.py
|   |-- services/
|   |   |-- export_service.py
|   |   `-- nlp_service.py
|   `-- tests/
|       `-- test_backend.py
|-- frontend/
|   |-- package.json
|   |-- vite.config.ts
|   `-- src/
|       |-- App.tsx
|       |-- api/
|       |   `-- client.ts
|       `-- pages/
|           |-- Analytics.tsx
|           |-- Dashboard.tsx
|           |-- Setup.tsx
|           |-- StudentView.tsx
|           |-- TeacherView.tsx
|           |-- Timetable.tsx
|           `-- WhatIf.tsx
|-- .gitignore
`-- README.md
```

## Core Data Model

The most important entities are:

### Institution

- name
- working days
- periods per day
- break slots
- period duration
- start time

This entity defines the academic calendar template used by generation, viewer pages, and exports.

### Department

- belongs to one institution
- owns courses and sections

### Room

- belongs to one institution
- has capacity
- has a room type

### Faculty

- belongs to one institution
- has contact details
- stores eligible subject labels
- stores unavailable day-period pairs
- stores a max consecutive teaching limit

### Course

- belongs to one department
- stores theory and practical hour requirements
- can be marked as core
- can require lab space

### Section

- belongs to one department
- stores section name, student count, and semester

### SectionCourse

- maps one section to one course and one faculty member
- represents regular teaching assignments

### CombinedGroup

- groups multiple sections for one shared course with one shared faculty member
- used for combined lectures

### Timetable

- belongs to one institution
- stores status and solve time
- contains many slots and violations

### Slot

- belongs to one timetable
- stores:
  - section
  - combined section list
  - course
  - faculty
  - room
  - day
  - period
  - duration
  - slot type
  - locked state
  - combined flag
  - modified flag

### ConstraintViolation

- belongs to one timetable
- stores type, description, and severity

## Scheduling Logic And Solver Rules

The solver lives in `backend/solver/engine.py` and uses Google OR-Tools CP-SAT.

### Session Model

The solver converts course demand into sessions:

- each theory hour becomes one 1-period session
- each 2 practical hours becomes one 2-period lab block
- combined-group sessions are built once and shared across all included sections

### Hard Constraints

The solver enforces:

- each session must be scheduled exactly once
- faculty cannot be double-booked
- sections cannot be double-booked
- break periods cannot host classes
- faculty unavailable slots are blocked
- labs must start where two consecutive valid non-break periods exist
- locked slots must remain at the requested positions
- combined sessions are treated as shared sessions
- room assignment must fit capacity and room type rules

### Soft Constraints

The objective currently favors:

- placing core subjects in earlier morning periods

### Room Assignment Strategy

Room assignment happens after the main CP-SAT solve:

- rooms are chosen greedily
- smallest fitting room is preferred
- labs require lab rooms
- non-lab teaching avoids lab rooms
- overlapping room usage is prevented

### Infeasible Timetable Diagnostics

When generation fails, the solver can surface likely causes such as:

- section overload
- faculty overload
- no valid slot available
- room capacity shortage
- lab room shortage
- locked slot conflicts

## Frontend Pages

### Dashboard

- institution selector
- timetable generation form
- timetable history list
- high-level counters such as solve time and conflict-free percentage

### Setup

- the main admin page
- manages all master data:
  - institutions
  - departments
  - rooms
  - faculty
  - courses
  - sections
  - section-course assignments
  - combined groups
- includes the NLP constraint parser UI

### Timetable

- interactive timetable grid
- per-section filtering
- slot detail side panel
- lock toggle
- substitute faculty assignment
- conflict display
- Excel/PDF export buttons

### What-If

- faculty absence simulation
- per-day impact selection
- rescheduled slot summary
- unchanged slot count

### Analytics

- bar charts
- utilization charts
- core-subject placement pie chart
- wellbeing and section-gap summaries

### Student View

- loads the latest completed timetable for one section
- grouped by day

### Teacher View

- loads the latest completed timetable for one teacher in one department
- grouped by day

## Backend API Overview

The backend is mounted directly at `http://localhost:8000`, and the frontend proxies `/api/*` to it in development.

### Health

- `GET /health`

### Institution Management

- `POST /institutions`
- `GET /institutions`
- `GET /institutions/{inst_id}`
- `PUT /institutions/{inst_id}`

### Department Management

- `POST /departments`
- `GET /departments?institution_id=...`
- `PUT /departments/{dept_id}`
- `DELETE /departments/{dept_id}`

### Room Management

- `POST /rooms`
- `GET /rooms?institution_id=...`
- `PUT /rooms/{room_id}`
- `DELETE /rooms/{room_id}`

### Faculty Management

- `POST /faculty`
- `GET /faculty?institution_id=...`
- `PUT /faculty/{fac_id}`
- `DELETE /faculty/{fac_id}`

### Course Management

- `POST /courses`
- `GET /courses?department_id=...`
- `PUT /courses/{course_id}`
- `DELETE /courses/{course_id}`

### Section Management

- `POST /sections`
- `GET /sections?department_id=...`
- `PUT /sections/{section_id}`
- `DELETE /sections/{section_id}`

### Section-Course Management

- `POST /section-courses`
- `GET /section-courses?section_id=...`
- `DELETE /section-courses/{sc_id}`

### Combined Groups

- `POST /combined-groups`
- `GET /combined-groups?institution_id=...`
- `DELETE /combined-groups/{cg_id}`

### Timetables

- `POST /timetables/generate`
- `GET /timetables?institution_id=...`
- `GET /timetables/{tt_id}`
- `DELETE /timetables/{tt_id}`

`POST /timetables/generate` accepts:

```json
{
  "institution_id": 1,
  "name": "Semester Timetable",
  "semester": "5",
  "locked_slots": [],
  "max_solve_seconds": 60
}
```

The response includes:

- `timetable_id`
- `status`
- `solve_time`
- `num_slots`
- `conflicts`
- `objective`

### Student And Teacher Views

- `GET /views/student?institution_id=...&department_id=...&semester=...&section_id=...`
- `GET /views/teacher/faculty?institution_id=...&department_id=...`
- `GET /views/teacher?institution_id=...&department_id=...&faculty_id=...`

Both viewer endpoints return:

- timetable metadata
- institution schedule metadata
- enriched slot list

### What-If And Slot Operations

- `POST /timetables/what-if`
- `PATCH /slots/{slot_id}/lock`
- `PATCH /slots/{slot_id}/substitute`
- `GET /timetables/{tt_id}/substitutes?slot_id=...`

### Analytics

- `GET /timetables/{tt_id}/analytics`

### NLP

- `POST /nlp/parse-constraint`

### Export

- `GET /timetables/{tt_id}/export/excel`
- `GET /timetables/{tt_id}/export/pdf`

### Interactive API Docs

FastAPI also exposes:

- `GET /docs`
- `GET /redoc`

## Local Development Setup

### Prerequisites

- Python 3.11+ recommended
- Node.js 18+ recommended
- npm

### 1. Clone And Enter The Repository

```bash
git clone <your-repo-url>
cd sau
```

### 2. Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend base URL:

```text
http://localhost:8000
```

### 3. Frontend Setup

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

### 4. Development Proxy

Vite is configured so that:

- frontend requests to `/api/*`
- are proxied to `http://localhost:8000/*`

That means the frontend can call `/api/institutions`, `/api/timetables/generate`, and so on during local development without extra CORS configuration beyond the backend settings.

## Environment Variables

The backend reads environment variables through `pydantic-settings` and loads them from `backend/.env` if present.

The repository currently does not include a checked-in `.env.example`, so create `backend/.env` manually if you want to override defaults.

Example:

```env
DATABASE_URL=sqlite:///./timetable.db
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
SECRET_KEY=dev_secret
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Variable Notes

- `DATABASE_URL`
  - defaults to local SQLite
  - example: `sqlite:///./timetable.db`
- `ANTHROPIC_API_KEY`
  - optional
  - enables Anthropic-backed NLP parsing
  - without it, the app falls back to the local regex parser
- `TWILIO_*`
  - present in config for messaging-related extension points
  - not used by the currently exposed API routes
- `CORS_ORIGINS`
  - comma-separated list of allowed frontend origins

## Seed Data

The project includes `backend/seed.py`, which creates a realistic demo dataset.

It seeds:

- 1 institution
- 1 department
- 4 sections
- 8 faculty members
- 10 rooms
- 8 courses
- section-course mappings
- 1 combined group

Run it with:

```bash
cd backend
python seed.py
```

The seeded sample currently models:

- `Delhi Technical College`
- `Computer Science`
- semester 5 sections
- theory and lab-heavy CS courses
- shared Engineering Maths for selected sections

This is the fastest way to get to a meaningful generation demo.

## Recommended End-To-End Workflow

### Option A: Quick Demo

1. Start the backend.
2. Run `python seed.py`.
3. Start the frontend.
4. Open the Dashboard.
5. Generate a timetable for the seeded institution.
6. Open the Timetable page.
7. Export the generated timetable.
8. Open Analytics, Student View, and Teacher View to inspect the result.

### Option B: Fresh Manual Setup

1. Create an institution calendar in Setup.
2. Add at least one department.
3. Add rooms.
4. Add faculty and configure unavailable slots.
5. Add courses.
6. Add sections.
7. Add section-course assignments or combined groups.
8. Go to Dashboard and generate a timetable.

### Minimum Data Needed Before Generation

Generation readiness checks require:

- at least one department
- at least one section
- at least one faculty member
- at least one room
- at least one section-course assignment or combined group
- every section to be covered by assignments or combined groups
- at least one lab room if practical courses exist

## Testing

The backend includes `backend/tests/test_backend.py`.

The tests are intended to cover:

- successful generation on seeded data
- overlap prevention
- locked slot preservation
- what-if generation flow
- analytics endpoints
- export endpoints
- infeasible room-capacity scenarios

Run the test suite with:

```bash
cd backend
python -m unittest tests.test_backend
```

## Exports

### Excel Export

The Excel export:

- creates one sheet per section
- writes one row per day
- writes one column per period
- styles theory, lab, break, and empty cells differently
- includes course, faculty, and room labels in populated cells

### PDF Export

The PDF export:

- creates a printable section timetable
- uses one page per section
- includes day/period headers
- colors cells based on slot type

## NLP Constraint Parsing

The NLP endpoint does not directly mutate timetable rules in the current exposed API. It parses text into structured constraint metadata so the frontend or future backend flows can act on it.

Examples of inputs the parser is designed to understand:

- `Dr. Sharma cannot teach before 10:30 on Mondays`
- `Operating Systems should be scheduled in the morning`
- `Machine Learning should avoid Friday`
- `Prof. Mehta should not have more than 3 consecutive periods`

The parser can return structured fields such as:

- type
- faculty_name
- course_name
- day
- period
- before_period
- after_period
- preferred_periods
- excluded_days
- max_periods
- confidence

## Validation And Safety Rules

The backend performs a lot of business validation before it accepts data. Important rules include:

- institution names must be unique
- departments must be unique within an institution
- room names must be unique within an institution
- faculty email must be unique within an institution if provided
- course names and course codes must be unique within a department
- section names must be unique within a department
- faculty unavailable slots must fit the institution calendar
- practical hours must be even because labs consume 2-period blocks
- section-course assignments require faculty subject eligibility
- combined groups require:
  - at least two sections
  - same institution
  - same department
  - same semester
  - eligible faculty
  - no conflicting individual assignments
- entities already used in timetable slots often cannot be deleted
- institution schedule updates are blocked if they would invalidate:
  - faculty unavailability
  - existing timetable slots

## Known Limitations

- Authentication and authorization are not implemented.
- The backend route file is largely monolithic in `backend/main.py`.
- The default database is SQLite, which is ideal for local use but not a production-scale deployment choice.
- NLP parsing is available, but the exposed API currently parses constraints rather than applying them as persistent solver rules.
- Twilio-related settings exist in config, but there are no currently exposed messaging routes in `main.py`.
- The frontend generation flow does not expose every advanced backend parameter through the UI even though the API supports them.
- Solver soft optimization is intentionally narrow at the moment; it mainly prioritizes morning placement for core subjects.

## Troubleshooting

### Backend Will Not Start

- Make sure you are inside `backend/`.
- Make sure the virtual environment is activated.
- Make sure dependencies from `requirements.txt` are installed.

### Frontend Cannot Reach The API

- Confirm the backend is running on `http://localhost:8000`.
- Confirm the frontend is running on `http://localhost:5173`.
- Confirm `frontend/vite.config.ts` still proxies `/api` to port `8000`.

### Generation Fails Immediately

Check that:

- every section has course coverage
- faculty subjects match assigned courses
- practical courses have lab rooms
- room capacities can fit section sizes
- faculty unavailability is not too restrictive

### Viewer Pages Show No Data

- Student and teacher views only use the latest completed timetable for the institution.
- Generate a timetable first and make sure its stored status is `done`.

### NLP Parsing Feels Too Basic

- Add `ANTHROPIC_API_KEY` in `backend/.env` for the Anthropic-backed parser.
- Without that key, the project uses the local lightweight parser.

## Summary

ScheduleAI is more than a basic timetable generator. It includes institutional setup, validation-heavy CRUD, a CP-SAT scheduling engine, slot-level operations, what-if rescheduling, analytics dashboards, exports, and separate student/teacher timetable views. For a quick demo, seed the backend, generate a timetable from the Dashboard, and then walk through the Timetable, What-If, Analytics, Student View, and Teacher View pages.
