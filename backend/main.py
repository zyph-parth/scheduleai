"""
FastAPI application — Intelligent Timetable Generator
All routes are defined inline for hackathon simplicity.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy.orm import Session

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
    NLPConstraintRequest, NLPConstraintResponse, NLPExecuteRequest, NLPExecuteResponse,
    SlotOut, TimetableOut, AnalyticsOut,
)
from solver.engine import solve_timetable
from services.export_service import export_excel, export_pdf
from services.nlp_service import parse_nlp_constraint
from services.timetable_service import (
    annotate_occurrences_from_slots,
    bad_request,
    build_analytics,
    build_recovery_suggestions,
    build_solver_input,
    get_course,
    get_department,
    get_faculty,
    get_institution as require_institution,
    get_section,
    group_entries_by_signature,
    normalize_period_map,
    occupied_periods,
    slot_signature,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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


def _collect_solver_entities(institution_id: int, db: Session):
    institution = require_institution(institution_id, db)
    sections = db.query(Section).join(Department).filter(Department.institution_id == institution_id).all()
    section_ids = [section.id for section in sections]
    courses = db.query(Course).join(Department).filter(Department.institution_id == institution_id).all()
    faculty = db.query(Faculty).filter(Faculty.institution_id == institution_id).all()
    rooms = db.query(Room).filter(Room.institution_id == institution_id).all()
    section_courses = db.query(SectionCourse).filter(SectionCourse.section_id.in_(section_ids or [-1])).all()
    combined_groups = db.query(CombinedGroup).filter(CombinedGroup.institution_id == institution_id).all()
    return institution, sections, courses, faculty, rooms, section_courses, combined_groups


def _build_solver_input_payload(
    institution_id: int,
    db: Session,
    locked_slots: Optional[List[Dict[str, Any]]] = None,
    max_seconds: int = 60,
):
    entity_sets = _collect_solver_entities(institution_id, db)
    return build_solver_input(*entity_sets, locked_slots=locked_slots, max_seconds=max_seconds)


def _validate_section_course_payload(body: SectionCourseCreate, db: Session):
    section = get_section(body.section_id, db)
    course = get_course(body.course_id, db)
    faculty = get_faculty(body.faculty_id, db)
    department = get_department(section.department_id, db)
    if course.department_id != section.department_id:
        raise bad_request("Section and course must belong to the same department")
    if faculty.institution_id != department.institution_id:
        raise bad_request("Faculty must belong to the same institution as the section")
    existing = db.query(SectionCourse).filter(
        SectionCourse.section_id == body.section_id,
        SectionCourse.course_id == body.course_id,
    ).first()
    if existing:
        raise bad_request("This section already has that course assigned")
    return section, course, faculty, department


def _validate_combined_group_payload(body: CombinedGroupCreate, db: Session):
    institution = require_institution(body.institution_id, db)
    course = get_course(body.course_id, db)
    faculty = get_faculty(body.faculty_id, db)
    if faculty.institution_id != institution.id:
        raise bad_request("Faculty must belong to the same institution")
    if len(set(body.section_ids)) < 2:
        raise bad_request("Combined groups require at least two distinct sections")

    sections = [get_section(section_id, db) for section_id in body.section_ids]
    for section in sections:
        department = get_department(section.department_id, db)
        if department.institution_id != institution.id:
            raise bad_request("All combined-group sections must belong to the same institution")

    course_department = get_department(course.department_id, db)
    if course_department.institution_id != institution.id:
        raise bad_request("Course must belong to the same institution")

    existing = db.query(CombinedGroup).filter(
        CombinedGroup.institution_id == body.institution_id,
        CombinedGroup.course_id == body.course_id,
        CombinedGroup.faculty_id == body.faculty_id,
    ).all()
    body_set = set(body.section_ids)
    for group in existing:
        if set(group.section_ids or []) == body_set:
            raise bad_request("An identical combined group already exists")

    return institution, course, faculty, sections


def _serialize_conflicts(conflicts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "type": conflict.get("type", "unknown"),
            "description": conflict.get("description", ""),
            "severity": conflict.get("severity", "hard"),
            "meta": conflict.get("meta", {}),
        }
        for conflict in conflicts
    ]


def _save_schedule(
    timetable_id: int,
    result: Dict[str, Any],
    db: Session,
    modified_signatures: Optional[set] = None,
):
    modified_signatures = modified_signatures or set()
    for entry in result.get("schedule", []):
        signature = slot_signature(entry, occurrence=entry.get("occurrence", 0))
        slot = Slot(
            timetable_id=timetable_id,
            section_id=entry.get("section_id"),
            section_ids=entry.get("section_ids", []),
            course_id=entry["course_id"],
            faculty_id=entry["faculty_id"],
            room_id=entry.get("room_id"),
            day=entry["day"],
            period=entry["period"],
            duration=entry.get("duration", 1),
            slot_type=entry.get("slot_type", "theory"),
            is_combined=entry.get("is_combined", False),
            is_modified=signature in modified_signatures,
        )
        db.add(slot)

    for conflict in _serialize_conflicts(result.get("conflicts", [])):
        db.add(
            ConstraintViolation(
                timetable_id=timetable_id,
                constraint_type=conflict["type"],
                description=conflict["description"],
                severity=conflict["severity"],
            )
        )

    db.commit()


def _enrich_slots(slots, db: Session) -> List[dict]:
    occurrences = annotate_occurrences_from_slots(slots)
    result = []
    for sl in slots:
        data = {column.name: getattr(sl, column.name) for column in sl.__table__.columns}
        data["course_name"] = sl.course.name if sl.course else ""
        data["faculty_name"] = sl.faculty.name if sl.faculty else ""
        data["room_name"] = sl.room.name if sl.room else "TBD"
        data["section_name"] = sl.section.name if sl.section else ""
        data["occurrence"] = occurrences.get(sl.id, 0)
        result.append(data)
    return result


def _resolve_faculty_by_name(institution_id: int, faculty_name: Optional[str], db: Session) -> Faculty:
    if not faculty_name:
        raise bad_request("Could not determine which faculty member you meant")
    faculty_name_lower = faculty_name.strip().lower()
    faculty_members = db.query(Faculty).filter(Faculty.institution_id == institution_id).all()
    exact = next((fac for fac in faculty_members if fac.name.lower() == faculty_name_lower), None)
    if exact:
        return exact
    contains = next((fac for fac in faculty_members if faculty_name_lower in fac.name.lower()), None)
    if contains:
        return contains
    last_word = faculty_name_lower.split()[-1]
    partial = next((fac for fac in faculty_members if last_word in fac.name.lower()), None)
    if partial:
        return partial
    raise bad_request(f"No faculty member matched '{faculty_name}'")


def _resolve_course_by_name(institution_id: int, course_name: Optional[str], db: Session) -> Course:
    if not course_name:
        raise bad_request("Could not determine which course you meant")
    courses = db.query(Course).join(Department).filter(Department.institution_id == institution_id).all()
    target = course_name.strip().lower()
    exact = next((course for course in courses if course.name.lower() == target), None)
    if exact:
        return exact
    partial = next((course for course in courses if target in course.name.lower()), None)
    if partial:
        return partial
    raise bad_request(f"No course matched '{course_name}'")


def _latest_done_timetable(institution_id: int, db: Session) -> Timetable:
    timetable = db.query(Timetable).filter(
        Timetable.institution_id == institution_id,
        Timetable.status == "done",
    ).order_by(Timetable.created_at.desc()).first()
    if not timetable:
        raise bad_request("No completed timetable exists yet for this institution")
    return timetable


def _apply_what_if(
    timetable: Timetable,
    absent_faculty_id: int,
    affected_days: Optional[List[int]],
    db: Session,
) -> Dict[str, Any]:
    institution = timetable.institution
    periods_per_day = normalize_period_map(institution.periods_per_day or {})
    applied_days = affected_days or list(institution.working_days or [])
    slot_occurrences = annotate_occurrences_from_slots(timetable.slots)
    original_slots = []
    locked = []
    affected_signatures = set()

    for slot in timetable.slots:
        occurrence = slot_occurrences.get(slot.id, 0)
        signature = slot_signature(slot, occurrence)
        original_slots.append(
            {
                "signature": signature,
                "section_id": slot.section_id,
                "section_ids": slot.section_ids,
                "course_id": slot.course_id,
                "faculty_id": slot.faculty_id,
                "room_id": slot.room_id,
                "day": slot.day,
                "period": slot.period,
                "duration": slot.duration,
                "slot_type": slot.slot_type,
                "occurrence": occurrence,
            }
        )
        if slot.faculty_id == absent_faculty_id and slot.day in applied_days:
            affected_signatures.add(signature)
            continue
        locked.append(
            {
                "section_id": slot.section_id,
                "course_id": slot.course_id,
                "type": slot.slot_type,
                "occurrence": occurrence,
                "day": slot.day,
                "period": slot.period,
            }
        )

    solver_input = _build_solver_input_payload(timetable.institution_id, db, locked_slots=locked)
    for faculty in solver_input["faculty"]:
        if faculty["id"] != absent_faculty_id:
            continue
        existing = list(faculty.get("unavailable_slots", []))
        for day in applied_days:
            for period in periods_per_day.get(day, []):
                existing.append({"day": day, "period": period})
        faculty["unavailable_slots"] = existing
        break

    result = solve_timetable(solver_input)
    old_by_signature = {item["signature"]: item for item in original_slots}
    new_by_signature = group_entries_by_signature(result.get("schedule", []))
    modified_signatures = set()
    for signature, new_entry in new_by_signature.items():
        old_entry = old_by_signature.get(signature)
        if signature in affected_signatures:
            modified_signatures.add(signature)
            continue
        if not old_entry:
            modified_signatures.add(signature)
            continue
        if (
            old_entry["day"] != new_entry["day"]
            or old_entry["period"] != new_entry["period"]
            or old_entry["faculty_id"] != new_entry["faculty_id"]
            or old_entry["room_id"] != new_entry.get("room_id")
        ):
            modified_signatures.add(signature)

    new_timetable = Timetable(
        institution_id=timetable.institution_id,
        name=f"{timetable.name} (What-If)",
        semester=timetable.semester,
        status="done" if result.get("status") in ("optimal", "feasible") else result["status"],
        solve_time=result.get("solve_time", 0),
    )
    db.add(new_timetable)
    db.commit()
    db.refresh(new_timetable)
    _save_schedule(new_timetable.id, result, db, modified_signatures=modified_signatures)

    enriched = _enrich_slots(db.query(Slot).filter(Slot.timetable_id == new_timetable.id).all(), db)
    conflicts = _serialize_conflicts(result.get("conflicts", []))
    return {
        "timetable_id": new_timetable.id,
        "status": new_timetable.status,
        "solve_time": new_timetable.solve_time,
        "slots": enriched,
        "modified_count": sum(1 for slot in enriched if slot.get("is_modified")),
        "conflicts": conflicts,
        "warnings": result.get("warnings", []),
        "diagnostics": result.get("diagnostics", conflicts),
        "unassigned_slots": result.get("unassigned_slots", []),
        "recovery_suggestions": build_recovery_suggestions(conflicts),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Institutions
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/institutions", response_model=InstitutionOut)
def create_institution(body: InstitutionCreate, db: Session = Depends(get_db)):
    inst = Institution(**body.model_dump())
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
    inst = db.query(Institution).filter(Institution.id == inst_id).first()
    if not inst:
        raise HTTPException(404, "Institution not found")
    for k, v in body.model_dump().items():
        setattr(inst, k, v)
    db.commit(); db.refresh(inst)
    return inst


# ─────────────────────────────────────────────────────────────────────────────
# Departments
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/departments", response_model=DepartmentOut)
def create_department(body: DepartmentCreate, db: Session = Depends(get_db)):
    require_institution(body.institution_id, db)
    dept = Department(**body.model_dump())
    db.add(dept); db.commit(); db.refresh(dept)
    return dept


@app.get("/departments", response_model=List[DepartmentOut])
def list_departments(institution_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Department).filter(Department.institution_id == institution_id).all()


@app.delete("/departments/{dept_id}")
def delete_department(dept_id: int, db: Session = Depends(get_db)):
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(404, "Department not found")
    db.delete(dept); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Rooms
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/rooms", response_model=RoomOut)
def create_room(body: RoomCreate, db: Session = Depends(get_db)):
    require_institution(body.institution_id, db)
    room = Room(**body.model_dump())
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
    for k, v in body.model_dump().items():
        setattr(room, k, v)
    db.commit(); db.refresh(room)
    return room


@app.delete("/rooms/{room_id}")
def delete_room(room_id: int, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    db.delete(room); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Faculty
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/faculty", response_model=FacultyOut)
def create_faculty(body: FacultyCreate, db: Session = Depends(get_db)):
    require_institution(body.institution_id, db)
    data = body.model_dump()
    data["unavailable_slots"] = [s.model_dump() for s in body.unavailable_slots]
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
        raise HTTPException(404, "Faculty not found")
    require_institution(body.institution_id, db)
    data = body.model_dump()
    data["unavailable_slots"] = [s.model_dump() for s in body.unavailable_slots]
    for k, v in data.items():
        setattr(fac, k, v)
    db.commit(); db.refresh(fac)
    return fac


@app.delete("/faculty/{fac_id}")
def delete_faculty(fac_id: int, db: Session = Depends(get_db)):
    fac = db.query(Faculty).filter(Faculty.id == fac_id).first()
    if not fac:
        raise HTTPException(404, "Faculty not found")
    db.delete(fac); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Courses
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/courses", response_model=CourseOut)
def create_course(body: CourseCreate, db: Session = Depends(get_db)):
    get_department(body.department_id, db)
    course = Course(**body.model_dump())
    db.add(course); db.commit(); db.refresh(course)
    return course


@app.get("/courses", response_model=List[CourseOut])
def list_courses(department_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Course).filter(Course.department_id == department_id).all()


@app.put("/courses/{course_id}", response_model=CourseOut)
def update_course(course_id: int, body: CourseCreate, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(404, "Course not found")
    get_department(body.department_id, db)
    for k, v in body.model_dump().items():
        setattr(course, k, v)
    db.commit(); db.refresh(course)
    return course


@app.delete("/courses/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)):
    c = db.query(Course).filter(Course.id == course_id).first()
    if not c:
        raise HTTPException(404, "Course not found")
    db.delete(c); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Sections
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/sections", response_model=SectionOut)
def create_section(body: SectionCreate, db: Session = Depends(get_db)):
    get_department(body.department_id, db)
    sec = Section(**body.model_dump())
    db.add(sec); db.commit(); db.refresh(sec)
    return sec


@app.get("/sections", response_model=List[SectionOut])
def list_sections(department_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Section).filter(Section.department_id == department_id).all()


@app.delete("/sections/{section_id}")
def delete_section(section_id: int, db: Session = Depends(get_db)):
    s = db.query(Section).filter(Section.id == section_id).first()
    if not s:
        raise HTTPException(404, "Section not found")
    db.delete(s); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Section-Course assignments
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/section-courses", response_model=SectionCourseOut)
def create_section_course(body: SectionCourseCreate, db: Session = Depends(get_db)):
    _validate_section_course_payload(body, db)
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
        raise HTTPException(404, "Section-course assignment not found")
    db.delete(sc); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Combined groups
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/combined-groups", response_model=CombinedGroupOut)
def create_combined_group(body: CombinedGroupCreate, db: Session = Depends(get_db)):
    _validate_combined_group_payload(body, db)
    cg = CombinedGroup(**body.model_dump())
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
        raise HTTPException(404, "Combined group not found")
    db.delete(cg); db.commit()
    return {"ok": True}


@app.post("/timetables/generate")
def generate_timetable(body: GenerateRequest, db: Session = Depends(get_db)):
    solver_input = _build_solver_input_payload(
        body.institution_id, db,
        locked_slots=body.locked_slots,
        max_seconds=body.max_solve_seconds,
    )

    result = solve_timetable(solver_input)

    status = result.get("status", "error")
    tt = Timetable(
        institution_id = body.institution_id,
        name           = body.name,
        semester       = body.semester,
        status         = "done" if status in ("optimal", "feasible") else status,
        solve_time     = result.get("solve_time", 0),
    )
    db.add(tt); db.commit(); db.refresh(tt)

    _save_schedule(tt.id, result, db)
    conflicts = _serialize_conflicts(result.get("conflicts", []))
    recovery_suggestions = build_recovery_suggestions(conflicts)

    return {
        "timetable_id":  tt.id,
        "status":        tt.status,
        "solve_time":    tt.solve_time,
        "num_slots":     len(result.get("schedule", [])),
        "conflicts":     conflicts,
        "objective":     result.get("objective", 0),
        "warnings":      result.get("warnings", []),
        "diagnostics":   result.get("diagnostics", conflicts),
        "unassigned_slots": result.get("unassigned_slots", []),
        "recovery_suggestions": recovery_suggestions,
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
    Lock all unaffected slots, re-solve only the disrupted ones.
    Returns a new timetable with is_modified=True on changed slots.
    """
    tt = db.query(Timetable).filter(Timetable.id == body.timetable_id).first()
    if not tt:
        raise HTTPException(404, "Timetable not found")
    return _apply_what_if(tt, body.absent_faculty_id, body.affected_days, db)


# ─────────────────────────────────────────────────────────────────────────────
# Slot operations (lock / override)
# ─────────────────────────────────────────────────────────────────────────────

@app.patch("/slots/{slot_id}/lock")
def lock_slot(slot_id: int, db: Session = Depends(get_db)):
    sl = db.query(Slot).filter(Slot.id == slot_id).first()
    if not sl:
        raise HTTPException(404, "Slot not found")
    sl.is_locked = not sl.is_locked
    db.commit()
    return {"slot_id": slot_id, "is_locked": sl.is_locked}


@app.patch("/slots/{slot_id}/substitute")
def substitute_faculty(slot_id: int, body: SubstituteRequest, db: Session = Depends(get_db)):
    sl = db.query(Slot).filter(Slot.id == slot_id).first()
    if not sl:
        raise HTTPException(404, "Slot not found")
    new_fac = db.query(Faculty).filter(Faculty.id == body.substitute_faculty_id).first()
    if not new_fac:
        raise HTTPException(404, "Substitute faculty not found")
    if new_fac.institution_id != sl.timetable.institution_id:
        raise bad_request("Substitute faculty must belong to the same institution")

    periods_per_day = normalize_period_map(sl.timetable.institution.periods_per_day or {})
    target_periods = set(occupied_periods(sl.day, sl.period, sl.duration, periods_per_day))
    sibling_slots = db.query(Slot).filter(
        Slot.timetable_id == sl.timetable_id,
        Slot.id != sl.id,
        Slot.day == sl.day,
        Slot.faculty_id == body.substitute_faculty_id,
    ).all()
    for sibling in sibling_slots:
        sibling_periods = set(occupied_periods(sibling.day, sibling.period, sibling.duration, periods_per_day))
        if target_periods & sibling_periods:
            raise bad_request("Substitute faculty is already busy during that slot")
    for blocked in new_fac.unavailable_slots or []:
        if int(blocked["day"]) == sl.day and int(blocked["period"]) in target_periods:
            raise bad_request("Substitute faculty is unavailable during that slot")

    sl.faculty_id  = body.substitute_faculty_id
    sl.is_modified = True
    db.commit()
    return {"ok": True, "new_faculty": new_fac.name}


@app.get("/timetables/{tt_id}/substitutes")
def find_substitutes(tt_id: int, slot_id: int = Query(...), db: Session = Depends(get_db)):
    """Find available substitute faculty for a given slot."""
    slot = db.query(Slot).filter(Slot.id == slot_id, Slot.timetable_id == tt_id).first()
    if not slot:
        raise HTTPException(404, "Slot not found")

    tt   = db.query(Timetable).filter(Timetable.id == tt_id).first()
    if not tt:
        raise HTTPException(404, "Timetable not found")
    inst = tt.institution_id
    all_fac = db.query(Faculty).filter(Faculty.institution_id == inst).all()
    periods_per_day = normalize_period_map(tt.institution.periods_per_day or {})
    target_periods = set(occupied_periods(slot.day, slot.period, slot.duration, periods_per_day))
    schedule_slots = db.query(Slot).filter(Slot.timetable_id == tt_id, Slot.day == slot.day).all()
    course = db.query(Course).filter(Course.id == slot.course_id).first()
    subject_name = course.name if course else ""
    current_section = slot.section or (db.query(Section).filter(Section.id == slot.section_id).first() if slot.section_id else None)
    target_department_id = current_section.department_id if current_section else None

    faculty_load = {}
    for faculty_member in all_fac:
        total = 0
        member_slots = db.query(Slot).filter(Slot.timetable_id == tt_id, Slot.faculty_id == faculty_member.id).all()
        for scheduled_slot in member_slots:
            total += len(occupied_periods(scheduled_slot.day, scheduled_slot.period, scheduled_slot.duration, periods_per_day))
        faculty_load[faculty_member.id] = total

    faculty_department_ids: Dict[int, set] = {}
    for assignment in db.query(SectionCourse).join(Section).filter(SectionCourse.faculty_id.in_([fac.id for fac in all_fac])).all():
        section = db.query(Section).filter(Section.id == assignment.section_id).first()
        if section:
            faculty_department_ids.setdefault(assignment.faculty_id, set()).add(section.department_id)

    candidates = []
    blocked_reasons = []
    for fac in all_fac:
        reasons = []
        blocked = []
        if fac.id == slot.faculty_id:
            blocked.append("Already assigned to this slot")

        overlaps = False
        for scheduled_slot in schedule_slots:
            if scheduled_slot.id == slot.id or scheduled_slot.faculty_id != fac.id:
                continue
            scheduled_periods = set(occupied_periods(scheduled_slot.day, scheduled_slot.period, scheduled_slot.duration, periods_per_day))
            if target_periods & scheduled_periods:
                overlaps = True
                break
        if overlaps:
            blocked.append("Already teaching during one of the occupied periods")

        unavail = fac.unavailable_slots or []
        if any(int(unavailable["day"]) == slot.day and int(unavailable["period"]) in target_periods for unavailable in unavail):
            blocked.append("Marked unavailable for this time")

        subject_match = any(subject_name.lower() in s.lower() for s in (fac.subjects or []))
        same_department = target_department_id in faculty_department_ids.get(fac.id, set()) if target_department_id is not None else False
        score = 0
        if subject_match:
            score += 10
            reasons.append("Teaches the same or a matching subject")
        if same_department:
            score += 4
            reasons.append("Already teaches in the same department")
        load_penalty = faculty_load.get(fac.id, 0)
        score += max(0, 8 - min(load_penalty, 8))
        reasons.append(f"Current weekly load is {faculty_load.get(fac.id, 0)} periods")

        day_slots = sorted(
            occupied
            for scheduled_slot in db.query(Slot).filter(
                Slot.timetable_id == tt_id,
                Slot.faculty_id == fac.id,
                Slot.day == slot.day,
            ).all()
            for occupied in occupied_periods(scheduled_slot.day, scheduled_slot.period, scheduled_slot.duration, periods_per_day)
        )
        future_chain = sorted(set(day_slots) | target_periods)
        longest_run = 0
        current_run = 0
        prev_period = None
        for period in future_chain:
            if prev_period is None or period == prev_period + 1:
                current_run += 1
            else:
                current_run = 1
            prev_period = period
            longest_run = max(longest_run, current_run)
        if longest_run > fac.max_consecutive_periods:
            blocked.append(
                f"Would exceed max consecutive periods ({fac.max_consecutive_periods})"
            )
        elif longest_run == fac.max_consecutive_periods:
            reasons.append("Fits but reaches the faculty's consecutive-period limit")
        else:
            score += 3
            reasons.append("Keeps consecutive teaching within preference")

        if blocked:
            blocked_reasons.append(
                {
                    "faculty_id": fac.id,
                    "faculty_name": fac.name,
                    "blocked_reasons": blocked,
                }
            )
            continue

        candidates.append(
            {
                "faculty_id": fac.id,
                "faculty_name": fac.name,
                "subject_match": subject_match,
                "same_department": same_department,
                "score": score,
                "candidate_reasons": reasons,
            }
        )

    candidates.sort(key=lambda item: (-item["score"], item["faculty_name"]))
    return {
        "candidates": candidates[:5],
        "candidate_reasons": {candidate["faculty_id"]: candidate["candidate_reasons"] for candidate in candidates[:5]},
        "blocked_reasons": blocked_reasons,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Analytics
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/timetables/{tt_id}/analytics")
def get_analytics(tt_id: int, db: Session = Depends(get_db)):
    tt = db.query(Timetable).filter(Timetable.id == tt_id).first()
    if not tt:
        raise HTTPException(404, "Timetable not found")
    return build_analytics(tt.slots, tt.institution, db, total_conflicts=len(tt.violations))


# ─────────────────────────────────────────────────────────────────────────────
# NLP constraint parser
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/nlp/parse-constraint")
async def parse_constraint(body: NLPConstraintRequest):
    result = await parse_nlp_constraint(body.text, settings.ANTHROPIC_API_KEY)
    return {
        "original_text": body.text,
        "parsed":        result,
        "confidence":    result.get("confidence", 0.5),
        "description":   result.get("description", "Constraint parsed"),
    }


@app.post("/nlp/execute")
async def execute_nlp_command(body: NLPExecuteRequest, db: Session = Depends(get_db)):
    require_institution(body.institution_id, db)
    parsed = await parse_nlp_constraint(body.text, settings.ANTHROPIC_API_KEY)
    action_type = parsed.get("action_type") or parsed.get("type") or "constraint"

    if action_type in {"faculty_absence", "cancel_session", "reschedule_request"}:
        faculty = _resolve_faculty_by_name(body.institution_id, parsed.get("faculty_name"), db)
        timetable = db.query(Timetable).filter(
            Timetable.id == body.timetable_id
        ).first() if body.timetable_id else _latest_done_timetable(body.institution_id, db)
        if not timetable:
            raise bad_request("No timetable was available for execution")
        result = _apply_what_if(timetable, faculty.id, parsed.get("affected_days") or [], db)
        return {
            "original_text": body.text,
            "parsed": parsed,
            "action_type": action_type,
            "executed": True,
            "description": parsed.get("description", "Action executed"),
            "result": {
                "mode": "what_if",
                "faculty_id": faculty.id,
                "faculty_name": faculty.name,
                **result,
            },
        }

    if action_type == "update_faculty_availability":
        faculty = _resolve_faculty_by_name(body.institution_id, parsed.get("faculty_name"), db)
        day = parsed.get("day")
        period = parsed.get("period")
        if day is None:
            raise bad_request("Please specify a day for availability updates")
        new_slot = {"day": int(day), "period": int(period) if period is not None else 0}
        existing = faculty.unavailable_slots or []
        if new_slot not in existing:
            existing.append(new_slot)
            faculty.unavailable_slots = existing
            db.commit()
        return {
            "original_text": body.text,
            "parsed": parsed,
            "action_type": action_type,
            "executed": True,
            "description": parsed.get("description", "Faculty availability updated"),
            "result": {
                "mode": "faculty_update",
                "faculty_id": faculty.id,
                "faculty_name": faculty.name,
                "unavailable_slots": faculty.unavailable_slots,
            },
        }

    if action_type == "update_faculty_max_consecutive":
        faculty = _resolve_faculty_by_name(body.institution_id, parsed.get("faculty_name"), db)
        max_periods = parsed.get("max_periods")
        if not max_periods:
            raise bad_request("Could not determine the max consecutive periods")
        faculty.max_consecutive_periods = int(max_periods)
        db.commit()
        return {
            "original_text": body.text,
            "parsed": parsed,
            "action_type": action_type,
            "executed": True,
            "description": parsed.get("description", "Faculty max consecutive periods updated"),
            "result": {
                "mode": "faculty_update",
                "faculty_id": faculty.id,
                "faculty_name": faculty.name,
                "max_consecutive_periods": faculty.max_consecutive_periods,
            },
        }

    if action_type == "mark_course_priority":
        course = _resolve_course_by_name(body.institution_id, parsed.get("course_name"), db)
        course.is_core = True
        db.commit()
        return {
            "original_text": body.text,
            "parsed": parsed,
            "action_type": action_type,
            "executed": True,
            "description": parsed.get("description", "Course priority updated"),
            "result": {
                "mode": "course_update",
                "course_id": course.id,
                "course_name": course.name,
                "is_core": course.is_core,
            },
        }

    return {
        "original_text": body.text,
        "parsed": parsed,
        "action_type": action_type,
        "executed": False,
        "description": "Parsed successfully, but no executable action was recognized",
        "result": {},
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
