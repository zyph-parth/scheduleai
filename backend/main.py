"""
FastAPI application — Intelligent Timetable Generator
All routes are defined inline for hackathon simplicity.
"""

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session
import io

from config import settings
from database import get_db, init_db
from models import (
    Institution, Department, Room, Faculty, Course,
    Section, SectionCourse, CombinedGroup, Timetable, Slot,
    ConstraintViolation,
)
from schemas import (
    InstitutionCreate, InstitutionOut,
    DepartmentCreate, DepartmentOut,
    RoomCreate, RoomOut,
    FacultyCreate, FacultyOut,
    CourseCreate, CourseOut,
    SectionCreate, SectionOut,
    SectionCourseCreate, SectionCourseOut,
    CombinedGroupCreate, CombinedGroupOut,
    GenerateRequest, WhatIfRequest, SubstituteRequest,
    NLPConstraintRequest, NLPConstraintResponse,
    SlotOut, TimetableOut, AnalyticsOut,
)
from solver.engine import solve_timetable
from services.nlp_service import parse_nlp_constraint
from services.export_service import export_excel, export_pdf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_UNSET = object()
VALID_ROOM_TYPES = {"classroom", "lab", "lecture_hall"}

app = FastAPI(
    title="Intelligent Timetable Generator",
    description="Schedule Intelligence Platform — conflict-free timetables in seconds",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Database initialized")


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def _normalize_name(value: str) -> str:
    return " ".join((value or "").strip().split())


def _parse_time_string(value: str) -> tuple[int, int]:
    text = (value or "").strip()
    if not re.fullmatch(r"\d{2}:\d{2}", text):
        raise _bad_request("start_time must be in HH:MM format")
    hour, minute = [int(part) for part in text.split(":")]
    if hour not in range(24) or minute not in range(60):
        raise _bad_request("start_time must be a valid 24-hour time")
    return hour, minute


def _normalize_period_map(raw_map: Dict[Any, List[int]], label: str) -> Dict[str, List[int]]:
    normalized: Dict[str, List[int]] = {}
    for raw_day, periods in (raw_map or {}).items():
        try:
            day = int(raw_day)
        except (TypeError, ValueError):
            raise _bad_request(f"{label} keys must be numeric day indexes")

        if day < 0 or day > 6:
            raise _bad_request(f"{label} day indexes must be between 0 and 6")

        cleaned = sorted({int(period) for period in (periods or [])})
        if any(period < 0 for period in cleaned):
            raise _bad_request(f"{label} periods must be non-negative")
        normalized[str(day)] = cleaned
    return normalized


def _validate_institution_payload(body: InstitutionCreate) -> Dict[str, Any]:
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Institution name is required")

    working_days = sorted({int(day) for day in body.working_days})
    if not working_days:
        raise _bad_request("Select at least one working day")
    if any(day < 0 or day > 6 for day in working_days):
        raise _bad_request("working_days must be between 0 and 6")

    _parse_time_string(body.start_time)
    if body.period_duration_minutes <= 0:
        raise _bad_request("period_duration_minutes must be greater than 0")

    periods_per_day = _normalize_period_map(body.periods_per_day, "periods_per_day")
    break_slots = _normalize_period_map(body.break_slots, "break_slots")

    for day in working_days:
        key = str(day)
        if key not in periods_per_day or not periods_per_day[key]:
            raise _bad_request(f"Provide at least one period for working day {day}")

        invalid_breaks = set(break_slots.get(key, [])) - set(periods_per_day[key])
        if invalid_breaks:
            raise _bad_request(f"break_slots for day {day} must exist in periods_per_day")

    return {
        "name": name,
        "working_days": working_days,
        "periods_per_day": {str(day): periods_per_day[str(day)] for day in working_days},
        "break_slots": {str(day): break_slots.get(str(day), []) for day in working_days},
        "period_duration_minutes": body.period_duration_minutes,
        "start_time": body.start_time.strip(),
    }


def _get_institution(db: Session, institution_id: int) -> Institution:
    inst = db.query(Institution).filter(Institution.id == institution_id).first()
    if not inst:
        raise HTTPException(404, "Institution not found")
    return inst


def _get_department(db: Session, department_id: int) -> Department:
    dept = db.query(Department).filter(Department.id == department_id).first()
    if not dept:
        raise HTTPException(404, "Department not found")
    return dept


def _get_section(db: Session, section_id: int) -> Section:
    section = db.query(Section).filter(Section.id == section_id).first()
    if not section:
        raise HTTPException(404, "Section not found")
    return section


def _get_course(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(404, "Course not found")
    return course


def _get_faculty(db: Session, faculty_id: int) -> Faculty:
    faculty = db.query(Faculty).filter(Faculty.id == faculty_id).first()
    if not faculty:
        raise HTTPException(404, "Faculty not found")
    return faculty


def _validate_unavailable_slots(inst: Institution, slots: List[Dict[str, Any]]) -> List[Dict[str, int]]:
    normalized: List[Dict[str, int]] = []
    seen = set()
    for item in slots:
        day = int(item["day"])
        period = int(item["period"])
        valid_periods = set(inst.periods_per_day.get(str(day), []))
        if day not in inst.working_days:
            raise _bad_request(f"Unavailable slot day {day} is not a working day")
        if period not in valid_periods:
            raise _bad_request(f"Unavailable period {period} is not valid for day {day}")
        key = (day, period)
        if key not in seen:
            normalized.append({"day": day, "period": period})
            seen.add(key)
    return normalized


def _ensure_no_slot_usage(db: Session, entity_name: str, **filters: Any) -> None:
    if db.query(Slot).filter_by(**filters).first():
        raise _bad_request(f"Cannot delete {entity_name} because it is already used in a timetable")


def _validate_generation_readiness(institution_id: int, db: Session) -> None:
    inst = _get_institution(db, institution_id)
    departments = db.query(Department).filter(Department.institution_id == institution_id).all()
    sections = db.query(Section).join(Department).filter(Department.institution_id == institution_id).all()
    faculty = db.query(Faculty).filter(Faculty.institution_id == institution_id).all()
    rooms = db.query(Room).filter(Room.institution_id == institution_id).all()

    issues: List[str] = []
    if not departments:
        issues.append("Add at least one department")
    if not sections:
        issues.append("Add at least one section")
    if not faculty:
        issues.append("Add at least one faculty member")
    if not rooms:
        issues.append("Add at least one room")

    section_ids = [section.id for section in sections]
    assignments = db.query(SectionCourse).filter(SectionCourse.section_id.in_(section_ids)).all() if section_ids else []
    combined_groups = db.query(CombinedGroup).filter(CombinedGroup.institution_id == institution_id).all()
    if not assignments and not combined_groups:
        issues.append("Add at least one section-course assignment or combined group")

    assigned_section_ids = {assignment.section_id for assignment in assignments}
    for group in combined_groups:
        assigned_section_ids.update(group.section_ids or [])
    missing_sections = [section.name for section in sections if section.id not in assigned_section_ids]
    if missing_sections:
        issues.append(f"Assign courses to every section. Missing: {', '.join(missing_sections[:5])}")

    if not any(room.room_type == "lab" for room in rooms):
        practical_courses = db.query(Course).join(Department).filter(
            Department.institution_id == institution_id,
            Course.practical_hours > 0,
        ).all()
        if practical_courses:
            issues.append("Add at least one lab room for courses with practical hours")

    if issues:
        raise _bad_request("; ".join(issues))


def _slot_fits_schedule(
    day: int,
    period: int,
    duration: int,
    working_days: List[int],
    periods_per_day: Dict[str, List[int]],
) -> bool:
    if day not in working_days:
        return False

    valid_periods = sorted(int(item) for item in (periods_per_day.get(str(day), []) or []))
    if period not in valid_periods:
        return False

    length = max(int(duration or 1), 1)
    start_index = valid_periods.index(period)
    return len(valid_periods[start_index:start_index + length]) == length


def _validate_institution_update_dependencies(
    inst: Institution,
    payload: Dict[str, Any],
    db: Session,
) -> None:
    faculty_conflicts = []
    for fac in db.query(Faculty).filter(Faculty.institution_id == inst.id).all():
        for slot in fac.unavailable_slots or []:
            if not _slot_fits_schedule(
                int(slot["day"]),
                int(slot["period"]),
                1,
                payload["working_days"],
                payload["periods_per_day"],
            ):
                faculty_conflicts.append(fac.name)
                break

    if faculty_conflicts:
        names = ", ".join(sorted(set(faculty_conflicts))[:5])
        raise _bad_request(
            f"Update would invalidate faculty unavailability for: {names}. "
            "Adjust those faculty records first."
        )

    timetable_conflicts = []
    slots = (
        db.query(Slot, Timetable.name)
        .join(Timetable, Timetable.id == Slot.timetable_id)
        .filter(Timetable.institution_id == inst.id)
        .all()
    )
    for slot, timetable_name in slots:
        if not _slot_fits_schedule(
            slot.day,
            slot.period,
            slot.duration,
            payload["working_days"],
            payload["periods_per_day"],
        ):
            timetable_conflicts.append(timetable_name)

    if timetable_conflicts:
        names = ", ".join(sorted(set(timetable_conflicts))[:5])
        raise _bad_request(
            f"Update would invalidate existing timetable slots in: {names}. "
            "Delete or regenerate those timetables first."
        )


def _build_nlp_context(institution_id: int, db: Session) -> Dict[str, Any]:
    inst = _get_institution(db, institution_id)
    faculty_names = [
        faculty.name
        for faculty in db.query(Faculty).filter(Faculty.institution_id == institution_id).all()
    ]
    course_names = [
        course.name
        for course in db.query(Course).join(Department).filter(Department.institution_id == institution_id).all()
    ]
    return {
        "start_time": inst.start_time,
        "period_duration_minutes": inst.period_duration_minutes,
        "periods_per_day": inst.periods_per_day or {},
        "faculty_names": faculty_names,
        "course_names": course_names,
    }


def _get_latest_done_timetable(institution_id: int, db: Session) -> Timetable:
    timetable = (
        db.query(Timetable)
        .filter(
            Timetable.institution_id == institution_id,
            Timetable.status == "done",
        )
        .order_by(Timetable.created_at.desc(), Timetable.id.desc())
        .first()
    )
    if not timetable:
        raise HTTPException(404, "No completed timetable found for this institution")
    return timetable


def _serialize_view_payload(tt: Timetable, slots: List[Slot], db: Session, **extra: Any) -> Dict[str, Any]:
    inst = tt.institution
    return {
        "timetable_id": tt.id,
        "timetable_name": tt.name,
        "institution_id": inst.id,
        "institution_name": inst.name,
        "start_time": inst.start_time,
        "period_duration_minutes": inst.period_duration_minutes,
        "working_days": inst.working_days or [],
        "periods_per_day": inst.periods_per_day or {},
        "break_slots": inst.break_slots or {},
        "slots": _enrich_slots(slots, db),
        **extra,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Institutions
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/institutions", response_model=InstitutionOut)
def create_institution(body: InstitutionCreate, db: Session = Depends(get_db)):
    payload = _validate_institution_payload(body)
    existing = db.query(Institution).filter(Institution.name == payload["name"]).first()
    if existing:
        raise _bad_request("An institution with this name already exists")
    inst = Institution(**payload)
    db.add(inst); db.commit(); db.refresh(inst)
    return inst


@app.get("/institutions", response_model=List[InstitutionOut])
def list_institutions(db: Session = Depends(get_db)):
    return db.query(Institution).all()


@app.get("/institutions/{inst_id}", response_model=InstitutionOut)
def get_institution(inst_id: int, db: Session = Depends(get_db)):
    inst = db.query(Institution).filter(Institution.id == inst_id).first()
    if not inst:
        raise HTTPException(404, "Institution not found")
    return inst


@app.put("/institutions/{inst_id}", response_model=InstitutionOut)
def update_institution(inst_id: int, body: InstitutionCreate, db: Session = Depends(get_db)):
    inst = _get_institution(db, inst_id)
    payload = _validate_institution_payload(body)
    _validate_institution_update_dependencies(inst, payload, db)
    duplicate = db.query(Institution).filter(
        Institution.name == payload["name"],
        Institution.id != inst_id,
    ).first()
    if duplicate:
        raise _bad_request("An institution with this name already exists")
    for k, v in payload.items():
        setattr(inst, k, v)
    db.commit(); db.refresh(inst)
    return inst


# ─────────────────────────────────────────────────────────────────────────────
# Departments
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/departments", response_model=DepartmentOut)
def create_department(body: DepartmentCreate, db: Session = Depends(get_db)):
    _get_institution(db, body.institution_id)
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Department name is required")
    duplicate = db.query(Department).filter(
        Department.institution_id == body.institution_id,
        Department.name == name,
    ).first()
    if duplicate:
        raise _bad_request("A department with this name already exists in the institution")
    dept = Department(institution_id=body.institution_id, name=name)
    db.add(dept); db.commit(); db.refresh(dept)
    return dept


@app.get("/departments", response_model=List[DepartmentOut])
def list_departments(institution_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Department).filter(Department.institution_id == institution_id).all()


@app.put("/departments/{dept_id}", response_model=DepartmentOut)
def update_department(dept_id: int, body: DepartmentCreate, db: Session = Depends(get_db)):
    dept = _get_department(db, dept_id)
    if body.institution_id != dept.institution_id:
        raise _bad_request("Changing a department's institution is not supported")
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Department name is required")
    duplicate = db.query(Department).filter(
        Department.institution_id == dept.institution_id,
        Department.name == name,
        Department.id != dept_id,
    ).first()
    if duplicate:
        raise _bad_request("A department with this name already exists in the institution")
    dept.name = name
    db.commit(); db.refresh(dept)
    return dept


@app.delete("/departments/{dept_id}")
def delete_department(dept_id: int, db: Session = Depends(get_db)):
    dept = _get_department(db, dept_id)
    section_ids = [section.id for section in dept.sections]
    course_ids = [course.id for course in dept.courses]
    if db.query(Slot).filter(Slot.section_id.in_(section_ids)).first() or db.query(Slot).filter(Slot.course_id.in_(course_ids)).first():
        raise _bad_request("Cannot delete a department that is already used in a timetable")
    if section_ids:
        db.query(SectionCourse).filter(SectionCourse.section_id.in_(section_ids)).delete(synchronize_session=False)
    if course_ids:
        db.query(SectionCourse).filter(SectionCourse.course_id.in_(course_ids)).delete(synchronize_session=False)
        db.query(CombinedGroup).filter(CombinedGroup.course_id.in_(course_ids)).delete(synchronize_session=False)
    db.delete(dept); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Rooms
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/rooms", response_model=RoomOut)
def create_room(body: RoomCreate, db: Session = Depends(get_db)):
    _get_institution(db, body.institution_id)
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Room name is required")
    if body.room_type not in VALID_ROOM_TYPES:
        raise _bad_request(f"room_type must be one of: {', '.join(sorted(VALID_ROOM_TYPES))}")
    duplicate = db.query(Room).filter(
        Room.institution_id == body.institution_id,
        Room.name == name,
    ).first()
    if duplicate:
        raise _bad_request("A room with this name already exists in the institution")
    room = Room(
        institution_id=body.institution_id,
        name=name,
        capacity=body.capacity,
        room_type=body.room_type,
    )
    db.add(room); db.commit(); db.refresh(room)
    return room


@app.get("/rooms", response_model=List[RoomOut])
def list_rooms(institution_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Room).filter(Room.institution_id == institution_id).all()


@app.put("/rooms/{room_id}", response_model=RoomOut)
def update_room(room_id: int, body: RoomCreate, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    if body.institution_id != room.institution_id:
        raise _bad_request("Changing a room's institution is not supported")
    _get_institution(db, body.institution_id)
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Room name is required")
    if body.room_type not in VALID_ROOM_TYPES:
        raise _bad_request(f"room_type must be one of: {', '.join(sorted(VALID_ROOM_TYPES))}")
    duplicate = db.query(Room).filter(
        Room.institution_id == body.institution_id,
        Room.name == name,
        Room.id != room_id,
    ).first()
    if duplicate:
        raise _bad_request("A room with this name already exists in the institution")
    for k, v in {
        "institution_id": body.institution_id,
        "name": name,
        "capacity": body.capacity,
        "room_type": body.room_type,
    }.items():
        setattr(room, k, v)
    db.commit(); db.refresh(room)
    return room


@app.delete("/rooms/{room_id}")
def delete_room(room_id: int, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404)
    _ensure_no_slot_usage(db, "room", room_id=room_id)
    db.delete(room); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Faculty
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/faculty", response_model=FacultyOut)
def create_faculty(body: FacultyCreate, db: Session = Depends(get_db)):
    inst = _get_institution(db, body.institution_id)
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Faculty name is required")
    email = body.email.strip()
    if email:
        duplicate_email = db.query(Faculty).filter(
            Faculty.institution_id == inst.id,
            Faculty.email == email,
        ).first()
        if duplicate_email:
            raise _bad_request("A faculty member with this email already exists in the institution")
    subjects = sorted({_normalize_name(subject) for subject in body.subjects if _normalize_name(subject)})
    data = body.model_dump()
    data["name"] = name
    data["email"] = email
    data["subjects"] = subjects
    data["unavailable_slots"] = _validate_unavailable_slots(inst, [s.model_dump() for s in body.unavailable_slots])
    fac = Faculty(**data)
    db.add(fac); db.commit(); db.refresh(fac)
    return fac


@app.get("/faculty", response_model=List[FacultyOut])
def list_faculty(institution_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Faculty).filter(Faculty.institution_id == institution_id).all()


@app.put("/faculty/{fac_id}", response_model=FacultyOut)
def update_faculty(fac_id: int, body: FacultyCreate, db: Session = Depends(get_db)):
    fac = db.query(Faculty).filter(Faculty.id == fac_id).first()
    if not fac:
        raise HTTPException(404)
    if body.institution_id != fac.institution_id:
        raise _bad_request("Changing a faculty member's institution is not supported")
    inst = _get_institution(db, body.institution_id)
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Faculty name is required")
    email = body.email.strip()
    if email:
        duplicate_email = db.query(Faculty).filter(
            Faculty.institution_id == inst.id,
            Faculty.email == email,
            Faculty.id != fac_id,
        ).first()
        if duplicate_email:
            raise _bad_request("A faculty member with this email already exists in the institution")
    data = body.model_dump()
    data["name"] = name
    data["email"] = email
    data["subjects"] = sorted({_normalize_name(subject) for subject in body.subjects if _normalize_name(subject)})
    data["unavailable_slots"] = _validate_unavailable_slots(inst, [s.model_dump() for s in body.unavailable_slots])
    for k, v in data.items():
        setattr(fac, k, v)
    db.commit(); db.refresh(fac)
    return fac


@app.delete("/faculty/{fac_id}")
def delete_faculty(fac_id: int, db: Session = Depends(get_db)):
    fac = db.query(Faculty).filter(Faculty.id == fac_id).first()
    if not fac:
        raise HTTPException(404)
    _ensure_no_slot_usage(db, "faculty", faculty_id=fac_id)
    db.query(SectionCourse).filter(SectionCourse.faculty_id == fac_id).delete(synchronize_session=False)
    db.query(CombinedGroup).filter(CombinedGroup.faculty_id == fac_id).delete(synchronize_session=False)
    db.delete(fac); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Courses
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/courses", response_model=CourseOut)
def create_course(body: CourseCreate, db: Session = Depends(get_db)):
    dept = _get_department(db, body.department_id)
    name = _normalize_name(body.name)
    code = _normalize_name(body.code)
    if not name:
        raise _bad_request("Course name is required")
    if body.practical_hours % 2 != 0:
        raise _bad_request("practical_hours must be an even number because labs use 2-period blocks")
    duplicate = db.query(Course).filter(
        Course.department_id == dept.id,
        Course.name == name,
    ).first()
    if duplicate:
        raise _bad_request("A course with this name already exists in the department")
    if code:
        duplicate_code = db.query(Course).filter(
            Course.department_id == dept.id,
            Course.code == code,
        ).first()
        if duplicate_code:
            raise _bad_request("A course with this code already exists in the department")
    course = Course(
        department_id=dept.id,
        name=name,
        code=code,
        theory_hours=body.theory_hours,
        practical_hours=body.practical_hours,
        credit_hours=body.credit_hours,
        is_core=body.is_core,
        requires_lab=body.requires_lab or body.practical_hours > 0,
    )
    db.add(course); db.commit(); db.refresh(course)
    return course


@app.get("/courses", response_model=List[CourseOut])
def list_courses(department_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Course).filter(Course.department_id == department_id).all()


@app.put("/courses/{course_id}", response_model=CourseOut)
def update_course(course_id: int, body: CourseCreate, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(404)
    if body.department_id != course.department_id:
        raise _bad_request("Changing a course's department is not supported")
    dept = _get_department(db, body.department_id)
    name = _normalize_name(body.name)
    code = _normalize_name(body.code)
    if not name:
        raise _bad_request("Course name is required")
    if body.practical_hours % 2 != 0:
        raise _bad_request("practical_hours must be an even number because labs use 2-period blocks")
    duplicate = db.query(Course).filter(
        Course.department_id == dept.id,
        Course.name == name,
        Course.id != course_id,
    ).first()
    if duplicate:
        raise _bad_request("A course with this name already exists in the department")
    if code:
        duplicate_code = db.query(Course).filter(
            Course.department_id == dept.id,
            Course.code == code,
            Course.id != course_id,
        ).first()
        if duplicate_code:
            raise _bad_request("A course with this code already exists in the department")
    for k, v in {
        "department_id": dept.id,
        "name": name,
        "code": code,
        "theory_hours": body.theory_hours,
        "practical_hours": body.practical_hours,
        "credit_hours": body.credit_hours,
        "is_core": body.is_core,
        "requires_lab": body.requires_lab or body.practical_hours > 0,
    }.items():
        setattr(course, k, v)
    db.commit(); db.refresh(course)
    return course


@app.delete("/courses/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)):
    c = db.query(Course).filter(Course.id == course_id).first()
    if not c:
        raise HTTPException(404)
    _ensure_no_slot_usage(db, "course", course_id=course_id)
    db.query(SectionCourse).filter(SectionCourse.course_id == course_id).delete(synchronize_session=False)
    db.query(CombinedGroup).filter(CombinedGroup.course_id == course_id).delete(synchronize_session=False)
    db.delete(c); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Sections
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/sections", response_model=SectionOut)
def create_section(body: SectionCreate, db: Session = Depends(get_db)):
    dept = _get_department(db, body.department_id)
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Section name is required")
    duplicate = db.query(Section).filter(
        Section.department_id == dept.id,
        Section.name == name,
    ).first()
    if duplicate:
        raise _bad_request("A section with this name already exists in the department")
    sec = Section(
        department_id=dept.id,
        name=name,
        student_count=body.student_count,
        semester=body.semester,
    )
    db.add(sec); db.commit(); db.refresh(sec)
    return sec


@app.get("/sections", response_model=List[SectionOut])
def list_sections(department_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Section).filter(Section.department_id == department_id).all()


@app.put("/sections/{section_id}", response_model=SectionOut)
def update_section(section_id: int, body: SectionCreate, db: Session = Depends(get_db)):
    section = _get_section(db, section_id)
    if body.department_id != section.department_id:
        raise _bad_request("Changing a section's department is not supported")
    name = _normalize_name(body.name)
    if not name:
        raise _bad_request("Section name is required")
    duplicate = db.query(Section).filter(
        Section.department_id == section.department_id,
        Section.name == name,
        Section.id != section_id,
    ).first()
    if duplicate:
        raise _bad_request("A section with this name already exists in the department")
    section.name = name
    section.student_count = body.student_count
    section.semester = body.semester
    db.commit(); db.refresh(section)
    return section


@app.delete("/sections/{section_id}")
def delete_section(section_id: int, db: Session = Depends(get_db)):
    s = db.query(Section).filter(Section.id == section_id).first()
    if not s:
        raise HTTPException(404)
    _ensure_no_slot_usage(db, "section", section_id=section_id)
    db.query(SectionCourse).filter(SectionCourse.section_id == section_id).delete(synchronize_session=False)
    groups = db.query(CombinedGroup).filter(CombinedGroup.institution_id == s.department.institution_id).all()
    for group in groups:
        if section_id not in (group.section_ids or []):
            continue
        remaining = [sid for sid in (group.section_ids or []) if sid != section_id]
        if len(remaining) < 2:
            db.delete(group)
        else:
            group.section_ids = remaining
    db.delete(s); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Section-Course assignments
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/section-courses", response_model=SectionCourseOut)
def create_section_course(body: SectionCourseCreate, db: Session = Depends(get_db)):
    section = _get_section(db, body.section_id)
    course = _get_course(db, body.course_id)
    faculty = _get_faculty(db, body.faculty_id)
    if course.department_id != section.department_id:
        raise _bad_request("Course and section must belong to the same department")
    if faculty.institution_id != section.department.institution_id:
        raise _bad_request("Faculty must belong to the same institution as the section")
    duplicate = db.query(SectionCourse).filter(
        SectionCourse.section_id == body.section_id,
        SectionCourse.course_id == body.course_id,
    ).first()
    if duplicate:
        raise _bad_request("This section already has an assignment for the selected course")
    combined_conflict = db.query(CombinedGroup).filter(
        CombinedGroup.course_id == body.course_id,
    ).all()
    if any(body.section_id in (group.section_ids or []) for group in combined_conflict):
        raise _bad_request("This section/course is already covered by a combined group")
    sc = SectionCourse(**body.model_dump())
    db.add(sc); db.commit(); db.refresh(sc)
    return sc


@app.get("/section-courses", response_model=List[SectionCourseOut])
def list_section_courses(section_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(SectionCourse).filter(SectionCourse.section_id == section_id).all()


@app.delete("/section-courses/{sc_id}")
def delete_section_course(sc_id: int, db: Session = Depends(get_db)):
    sc = db.query(SectionCourse).filter(SectionCourse.id == sc_id).first()
    if not sc:
        raise HTTPException(404)
    if db.query(Slot).filter(
        Slot.section_id == sc.section_id,
        Slot.course_id == sc.course_id,
    ).first():
        raise _bad_request("Cannot delete an assignment that is already used in a timetable")
    db.delete(sc); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Combined groups
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/combined-groups", response_model=CombinedGroupOut)
def create_combined_group(body: CombinedGroupCreate, db: Session = Depends(get_db)):
    inst = _get_institution(db, body.institution_id)
    faculty = _get_faculty(db, body.faculty_id)
    course = _get_course(db, body.course_id)
    section_ids = sorted({int(section_id) for section_id in body.section_ids})
    if len(section_ids) < 2:
        raise _bad_request("Select at least two sections for a combined group")
    sections = db.query(Section).filter(Section.id.in_(section_ids)).all()
    if len(sections) != len(section_ids):
        raise _bad_request("One or more selected sections do not exist")
    if faculty.institution_id != inst.id:
        raise _bad_request("Faculty must belong to the same institution")
    if any(section.department.institution_id != inst.id for section in sections):
        raise _bad_request("All sections must belong to the selected institution")
    department_ids = {section.department_id for section in sections}
    semester_ids = {section.semester for section in sections}
    if len(department_ids) != 1:
        raise _bad_request("Combined groups must use sections from the same department")
    if len(semester_ids) != 1:
        raise _bad_request("Combined groups must use sections from the same semester")
    if course.department_id not in department_ids:
        raise _bad_request("Combined group course must belong to the same department as the sections")
    existing = db.query(CombinedGroup).filter(
        CombinedGroup.institution_id == inst.id,
        CombinedGroup.course_id == course.id,
    ).all()
    if any(sorted(group.section_ids or []) == section_ids for group in existing):
        raise _bad_request("An identical combined group already exists")
    if db.query(SectionCourse).filter(
        SectionCourse.section_id.in_(section_ids),
        SectionCourse.course_id == course.id,
    ).first():
        raise _bad_request("Remove individual section-course assignments before creating a combined group")
    cg = CombinedGroup(
        institution_id=inst.id,
        section_ids=section_ids,
        course_id=course.id,
        faculty_id=faculty.id,
    )
    db.add(cg); db.commit(); db.refresh(cg)
    return cg


@app.get("/combined-groups", response_model=List[CombinedGroupOut])
def list_combined_groups(institution_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(CombinedGroup).filter(
        CombinedGroup.institution_id == institution_id
    ).all()


@app.delete("/combined-groups/{cg_id}")
def delete_combined_group(cg_id: int, db: Session = Depends(get_db)):
    cg = db.query(CombinedGroup).filter(CombinedGroup.id == cg_id).first()
    if not cg:
        raise HTTPException(404)
    combined_slots = db.query(Slot).join(Timetable).filter(
        Timetable.institution_id == cg.institution_id,
        Slot.course_id == cg.course_id,
        Slot.is_combined == True,
    ).all()
    for slot in combined_slots:
        if sorted(slot.section_ids or []) == sorted(cg.section_ids or []):
            raise _bad_request("Cannot delete a combined group that is already used in a timetable")
    db.delete(cg); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Timetable generation
# ─────────────────────────────────────────────────────────────────────────────

def _build_solver_input(institution_id: int, db: Session, locked_slots=None, max_seconds=60):
    """Assemble the full solver input dict from DB records."""
    inst = db.query(Institution).filter(Institution.id == institution_id).first()
    if not inst:
        raise HTTPException(404, "Institution not found")

    sections = db.query(Section).join(Department).filter(
        Department.institution_id == institution_id
    ).all()
    section_ids = [s.id for s in sections]

    courses_raw = db.query(Course).join(Department).filter(
        Department.institution_id == institution_id
    ).all()
    faculty_raw = db.query(Faculty).filter(Faculty.institution_id == institution_id).all()
    rooms_raw   = db.query(Room).filter(Room.institution_id == institution_id).all()
    sc_raw      = db.query(SectionCourse).filter(
        SectionCourse.section_id.in_(section_ids)
    ).all()
    cg_raw      = db.query(CombinedGroup).filter(
        CombinedGroup.institution_id == institution_id
    ).all()

    return {
        "institution": {
            "working_days":            inst.working_days,
            "periods_per_day":         inst.periods_per_day,
            "break_slots":             inst.break_slots,
            "period_duration_minutes": inst.period_duration_minutes,
            "start_time":              inst.start_time,
        },
        "sections": [
            {"id": s.id, "name": s.name, "student_count": s.student_count}
            for s in sections
        ],
        "courses": [
            {
                "id": c.id, "name": c.name,
                "theory_hours": c.theory_hours,
                "practical_hours": c.practical_hours,
                "is_core": c.is_core,
                "requires_lab": c.requires_lab,
            }
            for c in courses_raw
        ],
        "faculty": [
            {
                "id": f.id, "name": f.name,
                "unavailable_slots": f.unavailable_slots or [],
                "max_consecutive_periods": f.max_consecutive_periods,
            }
            for f in faculty_raw
        ],
        "rooms": [
            {"id": r.id, "name": r.name, "capacity": r.capacity, "room_type": r.room_type}
            for r in rooms_raw
        ],
        "section_courses": [
            {"section_id": sc.section_id, "course_id": sc.course_id, "faculty_id": sc.faculty_id}
            for sc in sc_raw
        ],
        "combined_groups": [
            {"id": cg.id, "section_ids": cg.section_ids, "course_id": cg.course_id, "faculty_id": cg.faculty_id}
            for cg in cg_raw
        ],
        "locked_slots": locked_slots or [],
        "max_solve_seconds": max_seconds,
    }


def _save_schedule(timetable_id: int, result: dict, db: Session, mark_modified_sessions=None):
    """Persist solver output into Slot rows."""
    mark_modified_sessions = mark_modified_sessions or set()
    for entry in result.get("schedule", []):
        slot = Slot(
            timetable_id = timetable_id,
            section_id   = entry.get("section_id"),
            section_ids  = entry.get("section_ids", []),
            course_id    = entry["course_id"],
            faculty_id   = entry["faculty_id"],
            room_id      = entry.get("room_id"),
            day          = entry["day"],
            period       = entry["period"],
            duration     = entry.get("duration", 1),
            slot_type    = entry.get("slot_type", "theory"),
            is_combined  = entry.get("is_combined", False),
            is_modified  = entry.get("session_id") in mark_modified_sessions,
        )
        db.add(slot)

    for conflict in result.get("conflicts", []):
        v = ConstraintViolation(
            timetable_id   = timetable_id,
            constraint_type= conflict.get("type", "unknown"),
            description    = conflict.get("description", ""),
            severity       = conflict.get("severity", "hard"),
        )
        db.add(v)

    db.commit()


def _enrich_slots(slots, db: Session) -> List[dict]:
    """Add human-readable names to slot dicts for the frontend."""
    result = []
    for sl in slots:
        d = {c.name: getattr(sl, c.name) for c in sl.__table__.columns}
        if sl.slot_type == "break":
            d["course_name"] = "Break Lecture"
            d["faculty_name"] = "No substitute available"
            d["room_name"] = "Free period"
        else:
            d["course_name"]  = sl.course.name  if sl.course  else ""
            d["faculty_name"] = sl.faculty.name if sl.faculty else ""
            d["room_name"]    = sl.room.name    if sl.room     else "TBD"
        if sl.is_combined and sl.section_ids:
            names = [
                name for (name,) in db.query(Section.name).filter(Section.id.in_(sl.section_ids)).all()
            ]
            d["section_name"] = " + ".join(names)
        else:
            d["section_name"] = sl.section.name if sl.section else ""
        result.append(d)
    return result


def _slot_occupied_periods(slot: Slot, periods_per_day: Dict[Any, List[int]]) -> List[int]:
    """Return all period indexes occupied by a slot, including multi-period labs."""
    day_periods = periods_per_day.get(str(slot.day), periods_per_day.get(slot.day, [])) or []
    ordered_periods = sorted(int(p) for p in day_periods)
    duration = max(int(slot.duration or 1), 1)

    if slot.period not in ordered_periods:
        return [slot.period]

    start_idx = ordered_periods.index(slot.period)
    return ordered_periods[start_idx:start_idx + duration]


def _faculty_subject_match(course: Optional[Course], faculty: Faculty) -> bool:
    if not course:
        return False

    course_name = (course.name or "").strip().lower()
    if not course_name:
        return False

    for subject in faculty.subjects or []:
        normalized = (subject or "").strip().lower()
        if normalized and (course_name in normalized or normalized in course_name):
            return True
    return False


def _find_available_substitutes(
    slot: Slot,
    timetable: Timetable,
    db: Session,
    exclude_faculty_ids: Optional[set[int]] = None,
) -> List[Dict[str, Any]]:
    """
    Find substitute faculty ordered by suitability.
    Preference order:
    1. Subject match
    2. Lower existing weekly teaching load
    3. Faculty name
    """
    exclude_faculty_ids = exclude_faculty_ids or set()
    occupied_periods = set(_slot_occupied_periods(slot, timetable.institution.periods_per_day or {}))
    course = db.query(Course).filter(Course.id == slot.course_id).first() if slot.course_id else None

    timetable_slots = db.query(Slot).filter(
        Slot.timetable_id == timetable.id,
        Slot.id != slot.id,
    ).all()

    all_faculty = db.query(Faculty).filter(
        Faculty.institution_id == timetable.institution_id
    ).all()

    candidates: List[Dict[str, Any]] = []
    for fac in all_faculty:
        if fac.id in exclude_faculty_ids or fac.id == slot.faculty_id:
            continue

        unavailable = {
            (int(u["day"]), int(u["period"]))
            for u in (fac.unavailable_slots or [])
        }
        if any((slot.day, period) in unavailable for period in occupied_periods):
            continue

        busy = False
        weekly_load = 0
        for existing in timetable_slots:
            if existing.faculty_id != fac.id or existing.slot_type == "break":
                continue

            weekly_load += existing.duration or 1
            if existing.day != slot.day:
                continue

            existing_periods = set(
                _slot_occupied_periods(existing, timetable.institution.periods_per_day or {})
            )
            if occupied_periods & existing_periods:
                busy = True
                break

        if busy:
            continue

        subject_match = _faculty_subject_match(course, fac)
        candidates.append({
            "faculty_id": fac.id,
            "faculty_name": fac.name,
            "subject_match": subject_match,
            "hours_per_week": weekly_load,
            "score": 100 if subject_match else 50,
        })

    candidates.sort(
        key=lambda item: (
            -item["score"],
            item["hours_per_week"],
            item["faculty_name"].lower(),
        )
    )
    return candidates


def _copy_slot_to_timetable(
    source: Slot,
    timetable_id: int,
    *,
    faculty_id: Any = _UNSET,
    room_id: Any = _UNSET,
    slot_type: Optional[str] = None,
    is_modified: Optional[bool] = None,
) -> Slot:
    return Slot(
        timetable_id=timetable_id,
        section_id=source.section_id,
        section_ids=source.section_ids,
        course_id=source.course_id,
        faculty_id=source.faculty_id if faculty_id is _UNSET else faculty_id,
        room_id=source.room_id if room_id is _UNSET else room_id,
        day=source.day,
        period=source.period,
        duration=source.duration,
        slot_type=source.slot_type if slot_type is None else slot_type,
        is_locked=source.is_locked,
        is_combined=source.is_combined,
        is_modified=source.is_modified if is_modified is None else is_modified,
    )


@app.post("/timetables/generate")
def generate_timetable(body: GenerateRequest, db: Session = Depends(get_db)):
    _validate_generation_readiness(body.institution_id, db)
    solver_input = _build_solver_input(
        body.institution_id, db,
        locked_slots=body.locked_slots,
        max_seconds=body.max_solve_seconds,
    )

    result = solve_timetable(solver_input)

    status = result.get("status", "error")
    tt = Timetable(
        institution_id = body.institution_id,
        name           = _normalize_name(body.name) or "Semester Timetable",
        semester       = body.semester,
        status         = "done" if status in ("optimal", "feasible") else status,
        solve_time     = result.get("solve_time", 0),
    )
    db.add(tt); db.commit(); db.refresh(tt)

    _save_schedule(tt.id, result, db)

    return {
        "timetable_id":  tt.id,
        "status":        tt.status,
        "solve_time":    tt.solve_time,
        "num_slots":     len(result.get("schedule", [])),
        "conflicts":     result.get("conflicts", []),
        "objective":     result.get("objective", 0),
    }


@app.get("/timetables", response_model=List[Dict[str, Any]])
def list_timetables(institution_id: int = Query(...), db: Session = Depends(get_db)):
    tts = db.query(Timetable).filter(
        Timetable.institution_id == institution_id
    ).order_by(Timetable.created_at.desc()).all()
    return [
        {
            "id": t.id, "name": t.name, "semester": t.semester,
            "status": t.status, "solve_time": t.solve_time,
            "created_at": str(t.created_at),
            "slot_count": len(t.slots),
        }
        for t in tts
    ]


@app.get("/timetables/{tt_id}")
def get_timetable(tt_id: int, db: Session = Depends(get_db)):
    tt = db.query(Timetable).filter(Timetable.id == tt_id).first()
    if not tt:
        raise HTTPException(404, "Timetable not found")
    slots = _enrich_slots(tt.slots, db)
    return {
        "id":         tt.id,
        "name":       tt.name,
        "semester":   tt.semester,
        "status":     tt.status,
        "solve_time": tt.solve_time,
        "slots":      slots,
        "violations": [
            {"type": v.constraint_type, "description": v.description, "severity": v.severity}
            for v in tt.violations
        ],
    }


@app.get("/views/student")
def get_student_view(
    institution_id: int = Query(...),
    department_id: int = Query(...),
    semester: int = Query(...),
    section_id: int = Query(...),
    db: Session = Depends(get_db),
):
    inst = _get_institution(db, institution_id)
    dept = _get_department(db, department_id)
    section = _get_section(db, section_id)

    if dept.institution_id != inst.id:
        raise _bad_request("Department must belong to the selected institution")
    if section.department_id != dept.id:
        raise _bad_request("Section must belong to the selected department")
    if section.semester != semester:
        raise _bad_request("Section does not belong to the selected semester")

    tt = _get_latest_done_timetable(inst.id, db)
    slots = [
        slot
        for slot in tt.slots
        if slot.section_id == section.id
    ]

    return _serialize_view_payload(
        tt,
        slots,
        db,
        department_id=dept.id,
        department_name=dept.name,
        semester=section.semester,
        section_id=section.id,
        section_name=section.name,
    )


@app.get("/views/teacher/faculty")
def list_teacher_view_faculty(
    institution_id: int = Query(...),
    department_id: int = Query(...),
    db: Session = Depends(get_db),
):
    inst = _get_institution(db, institution_id)
    dept = _get_department(db, department_id)
    if dept.institution_id != inst.id:
        raise _bad_request("Department must belong to the selected institution")

    faculty_ids = {
        faculty_id
        for (faculty_id,) in db.query(SectionCourse.faculty_id)
        .join(Section, Section.id == SectionCourse.section_id)
        .filter(Section.department_id == dept.id)
        .distinct()
        .all()
    }
    faculty_ids.update(
        faculty_id
        for (faculty_id,) in db.query(CombinedGroup.faculty_id)
        .join(Course, Course.id == CombinedGroup.course_id)
        .filter(
            CombinedGroup.institution_id == inst.id,
            Course.department_id == dept.id,
        )
        .distinct()
        .all()
    )

    faculty = db.query(Faculty).filter(Faculty.id.in_(faculty_ids)).order_by(Faculty.name.asc()).all() if faculty_ids else []
    return [
        {"id": member.id, "name": member.name}
        for member in faculty
    ]


@app.get("/views/teacher")
def get_teacher_view(
    institution_id: int = Query(...),
    department_id: int = Query(...),
    faculty_id: int = Query(...),
    db: Session = Depends(get_db),
):
    inst = _get_institution(db, institution_id)
    dept = _get_department(db, department_id)
    faculty = _get_faculty(db, faculty_id)

    if dept.institution_id != inst.id:
        raise _bad_request("Department must belong to the selected institution")
    if faculty.institution_id != inst.id:
        raise _bad_request("Faculty must belong to the selected institution")

    valid_faculty_ids = {
        item["id"]
        for item in list_teacher_view_faculty(institution_id=inst.id, department_id=dept.id, db=db)
    }
    if faculty.id not in valid_faculty_ids:
        raise _bad_request("Selected faculty does not teach in the selected department")

    tt = _get_latest_done_timetable(inst.id, db)
    slots = [
        slot
        for slot in tt.slots
        if slot.faculty_id == faculty.id and slot.course and slot.course.department_id == dept.id
    ]

    return _serialize_view_payload(
        tt,
        slots,
        db,
        department_id=dept.id,
        department_name=dept.name,
        faculty_id=faculty.id,
        faculty_name=faculty.name,
    )


@app.delete("/timetables/{tt_id}")
def delete_timetable(tt_id: int, db: Session = Depends(get_db)):
    tt = db.query(Timetable).filter(Timetable.id == tt_id).first()
    if not tt:
        raise HTTPException(404)
    db.delete(tt); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# What-if / partial regeneration
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/timetables/what-if")
def what_if(body: WhatIfRequest, db: Session = Depends(get_db)):
    """
    Mark a faculty as absent for given days.
    Prefer an available substitute for each affected slot.
    If nobody is free, convert that lecture into a student break.
    """
    t0 = time.time()
    tt = db.query(Timetable).filter(Timetable.id == body.timetable_id).first()
    if not tt:
        raise HTTPException(404, "Timetable not found")

    # Slots NOT belonging to absent faculty → lock them
    absent_faculty = db.query(Faculty).filter(
        Faculty.id == body.absent_faculty_id,
        Faculty.institution_id == tt.institution_id,
    ).first()
    if not absent_faculty:
        raise HTTPException(404, "Faculty not found in this institution")

    new_tt = Timetable(
        institution_id = tt.institution_id,
        name           = f"{tt.name} (What-If)",
        semester       = tt.semester,
        status         = "done",
        solve_time     = 0,
    )
    db.add(new_tt); db.commit(); db.refresh(new_tt)

    affected_days = set(body.affected_days or (tt.institution.working_days or []))
    substituted_count = 0
    break_count = 0

    for slot in tt.slots:
        is_affected = (
            slot.faculty_id == body.absent_faculty_id
            and slot.day in affected_days
            and slot.slot_type != "break"
        )

        if not is_affected:
            db.add(_copy_slot_to_timetable(slot, new_tt.id, is_modified=False))
            continue

        candidates = _find_available_substitutes(
            slot,
            tt,
            db,
            exclude_faculty_ids={body.absent_faculty_id},
        )

        if candidates:
            substituted_count += 1
            db.add(_copy_slot_to_timetable(
                slot,
                new_tt.id,
                faculty_id=candidates[0]["faculty_id"],
                is_modified=True,
            ))
        else:
            break_count += 1
            db.add(_copy_slot_to_timetable(
                slot,
                new_tt.id,
                room_id=None,
                slot_type="break",
                is_modified=True,
            ))

    db.commit()
    new_tt.solve_time = round(time.time() - t0, 3)
    db.commit()

    enriched = _enrich_slots(
        db.query(Slot).filter(Slot.timetable_id == new_tt.id).all(), db
    )
    return {
        "timetable_id":    new_tt.id,
        "status":          new_tt.status,
        "solve_time":      new_tt.solve_time,
        "slots":           enriched,
        "modified_count":  substituted_count + break_count,
        "substituted_count": substituted_count,
        "break_count":     break_count,
        "conflicts":       [],
    }



# ─────────────────────────────────────────────────────────────────────────────
# Slot operations (lock / override)
# ─────────────────────────────────────────────────────────────────────────────

@app.patch("/slots/{slot_id}/lock")
def lock_slot(slot_id: int, db: Session = Depends(get_db)):
    sl = db.query(Slot).filter(Slot.id == slot_id).first()
    if not sl:
        raise HTTPException(404)
    sl.is_locked = not sl.is_locked
    db.commit()
    return {"slot_id": slot_id, "is_locked": sl.is_locked}


@app.patch("/slots/{slot_id}/substitute")
def substitute_faculty(slot_id: int, body: SubstituteRequest, db: Session = Depends(get_db)):
    sl = db.query(Slot).filter(Slot.id == slot_id).first()
    if not sl:
        raise HTTPException(404)
    new_fac = db.query(Faculty).filter(Faculty.id == body.substitute_faculty_id).first()
    if not new_fac:
        raise HTTPException(404, "Substitute faculty not found")
    if not sl.timetable or new_fac.institution_id != sl.timetable.institution_id:
        raise HTTPException(400, "Substitute faculty must belong to the same institution")

    candidate_ids = {
        c["faculty_id"]
        for c in _find_available_substitutes(sl, sl.timetable, db)
    }
    if body.substitute_faculty_id not in candidate_ids:
        raise HTTPException(400, "Selected faculty is not available for this slot")

    sl.faculty_id  = body.substitute_faculty_id
    if sl.slot_type == "break":
        sl.slot_type = "lab" if (sl.duration or 1) > 1 else "theory"
    sl.is_modified = True
    db.commit()
    return {"ok": True, "new_faculty": new_fac.name}


@app.get("/timetables/{tt_id}/substitutes")
def find_substitutes(tt_id: int, slot_id: int = Query(...), db: Session = Depends(get_db)):
    """Find available substitute faculty for a given slot."""
    slot = db.query(Slot).filter(Slot.id == slot_id, Slot.timetable_id == tt_id).first()
    if not slot:
        raise HTTPException(404)

    tt = db.query(Timetable).filter(Timetable.id == tt_id).first()
    return _find_available_substitutes(slot, tt, db)[:5]


# ─────────────────────────────────────────────────────────────────────────────
# Analytics
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/timetables/{tt_id}/analytics")
def get_analytics(tt_id: int, db: Session = Depends(get_db)):
    tt = db.query(Timetable).filter(Timetable.id == tt_id).first()
    if not tt:
        raise HTTPException(404)

    slots = tt.slots
    inst  = tt.institution
    working_days = inst.working_days
    ppd = inst.periods_per_day or {}
    all_periods  = sorted({p for ps in ppd.values() for p in (ps or [])})
    total_slots  = len(working_days) * max(len(all_periods), 1)

    # Faculty load
    faculty_hours: Dict[int, int] = {}
    for sl in slots:
        if sl.slot_type == "break" or not sl.faculty_id:
            continue
        faculty_hours[sl.faculty_id] = faculty_hours.get(sl.faculty_id, 0) + sl.duration
    fac_load = []
    for f_id, hrs in faculty_hours.items():
        fac = db.query(Faculty).filter(Faculty.id == f_id).first()
        fac_load.append({
            "faculty_id": f_id,
            "faculty_name": fac.name if fac else str(f_id),
            "hours_per_week": hrs,
            "wellbeing_score": min(100, max(0, 100 - abs(hrs - 18) * 3)),
        })
    fac_load.sort(key=lambda x: -x["hours_per_week"])

    # Room utilization
    room_usage: Dict[int, int] = {}
    for sl in slots:
        if sl.room_id:
            room_usage[sl.room_id] = room_usage.get(sl.room_id, 0) + sl.duration
    rooms_db = db.query(Room).filter(Room.institution_id == inst.id).all()
    room_util = []
    for r in rooms_db:
        used = room_usage.get(r.id, 0)
        room_util.append({
            "room_id":     r.id,
            "room_name":   r.name,
            "room_type":   r.room_type,
            "used_periods": used,
            "total_periods": total_slots,
            "utilization_pct": round(used / max(total_slots, 1) * 100, 1),
        })

    # Section gaps (free periods between first and last class per day)
    section_gaps: Dict[int, int] = {}
    for sl in slots:
        s_id = sl.section_id
        if s_id:
            section_gaps[s_id] = section_gaps.get(s_id, 0)  # placeholder

    DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    sections_db = db.query(Section).join(Department).filter(
        Department.institution_id == inst.id
    ).all()
    sec_gaps_list = []
    for sec in sections_db:
        sec_slots = [sl for sl in slots if sl.section_id == sec.id and sl.slot_type != "break"]
        gaps = 0
        for d in working_days:
            day_periods = sorted({sl.period for sl in sec_slots if sl.day == d})
            if len(day_periods) >= 2:
                gaps += day_periods[-1] - day_periods[0] - len(day_periods) + 1
        sec_gaps_list.append({"section_id": sec.id, "section_name": sec.name, "total_gaps": gaps})

    # Core subject distribution
    core_in_morning = 0
    core_total = 0
    for sl in slots:
        if sl.slot_type == "break" or not sl.course_id:
            continue
        c = db.query(Course).filter(Course.id == sl.course_id).first()
        if c and c.is_core:
            core_total += 1
            if sl.period < 2:
                core_in_morning += 1
    core_dist = {
        "core_total": core_total,
        "core_in_morning": core_in_morning,
        "morning_pct": round(core_in_morning / max(core_total, 1) * 100, 1),
    }

    return {
        "faculty_load":             fac_load,
        "room_utilization":         room_util,
        "section_gaps":             sec_gaps_list,
        "core_subject_distribution": core_dist,
        "wellbeing_scores":         [{"faculty_id": f["faculty_id"], "faculty_name": f["faculty_name"], "score": f["wellbeing_score"]} for f in fac_load],
        "total_slots":              len(slots),
        "total_conflicts":          len(tt.violations),
    }


# ─────────────────────────────────────────────────────────────────────────────
# NLP constraint parser
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/nlp/parse-constraint")
async def parse_constraint(body: NLPConstraintRequest, db: Session = Depends(get_db)):
    context = _build_nlp_context(body.institution_id, db)
    result = await parse_nlp_constraint(body.text, settings.ANTHROPIC_API_KEY, context)
    return {
        "original_text": body.text,
        "parsed":        result,
        "confidence":    result.get("confidence", 0.5),
        "description":   result.get("description", "Constraint parsed"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Export
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/timetables/{tt_id}/export/excel")
def export_timetable_excel(tt_id: int, db: Session = Depends(get_db)):
    tt = db.query(Timetable).filter(Timetable.id == tt_id).first()
    if not tt:
        raise HTTPException(404)
    enriched = _enrich_slots(tt.slots, db)
    inst = tt.institution
    xlsx_bytes = export_excel(
        enriched, inst.name,
        {int(k): v for k, v in inst.periods_per_day.items()},
    )
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="timetable_{tt_id}.xlsx"'},
    )


@app.get("/timetables/{tt_id}/export/pdf")
def export_timetable_pdf(tt_id: int, db: Session = Depends(get_db)):
    tt = db.query(Timetable).filter(Timetable.id == tt_id).first()
    if not tt:
        raise HTTPException(404)
    enriched = _enrich_slots(tt.slots, db)
    inst = tt.institution
    pdf_bytes = export_pdf(
        enriched, inst.name,
        {int(k): v for k, v in inst.periods_per_day.items()},
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="timetable_{tt_id}.pdf"'},
    )
