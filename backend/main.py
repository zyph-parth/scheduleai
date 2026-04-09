"""
FastAPI application — Intelligent Timetable Generator
All routes are defined inline for hackathon simplicity.
"""

import logging
import os
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
        raise HTTPException(404)
    db.delete(room); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Faculty
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/faculty", response_model=FacultyOut)
def create_faculty(body: FacultyCreate, db: Session = Depends(get_db)):
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
        raise HTTPException(404)
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
        raise HTTPException(404)
    db.delete(fac); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Courses
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/courses", response_model=CourseOut)
def create_course(body: CourseCreate, db: Session = Depends(get_db)):
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
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(course, k, v)
    db.commit(); db.refresh(course)
    return course


@app.delete("/courses/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)):
    c = db.query(Course).filter(Course.id == course_id).first()
    if not c:
        raise HTTPException(404)
    db.delete(c); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Sections
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/sections", response_model=SectionOut)
def create_section(body: SectionCreate, db: Session = Depends(get_db)):
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
        raise HTTPException(404)
    db.delete(s); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Section-Course assignments
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/section-courses", response_model=SectionCourseOut)
def create_section_course(body: SectionCourseCreate, db: Session = Depends(get_db)):
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
    db.delete(sc); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Combined groups
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/combined-groups", response_model=CombinedGroupOut)
def create_combined_group(body: CombinedGroupCreate, db: Session = Depends(get_db)):
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
        raise HTTPException(404)
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
        d["course_name"]  = sl.course.name  if sl.course  else ""
        d["faculty_name"] = sl.faculty.name if sl.faculty else ""
        d["room_name"]    = sl.room.name    if sl.room     else "TBD"
        d["section_name"] = sl.section.name if sl.section else ""
        result.append(d)
    return result


@app.post("/timetables/generate")
def generate_timetable(body: GenerateRequest, db: Session = Depends(get_db)):
    solver_input = _build_solver_input(
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

    # Slots NOT belonging to absent faculty → lock them
    locked = []
    affected_session_ids = set()

    for slot in tt.slots:
        if slot.faculty_id == body.absent_faculty_id:
            if not body.affected_days or slot.day in body.affected_days:
                affected_session_ids.add(slot.id)
                continue  # do NOT lock — needs rescheduling

        # Lock this slot
        locked.append({
            "section_id": slot.section_id,
            "course_id":  slot.course_id,
            "type":       slot.slot_type,
            "occurrence": 0,
            "day":        slot.day,
            "period":     slot.period,
        })

    solver_input = _build_solver_input(tt.institution_id, db, locked_slots=locked)

    # Block the absent faculty's slots from being re-assigned to them
    if body.affected_days:
        for fac in solver_input["faculty"]:
            if fac["id"] == body.absent_faculty_id:
                existing = fac.get("unavailable_slots", [])
                for d in body.affected_days:
                    for p in range(8):
                        existing.append({"day": d, "period": p})
                fac["unavailable_slots"] = existing

    result = solve_timetable(solver_input)

    new_tt = Timetable(
        institution_id = tt.institution_id,
        name           = f"{tt.name} (What-If)",
        semester       = tt.semester,
        status         = "done" if result.get("status") in ("optimal","feasible") else result["status"],
        solve_time     = result.get("solve_time", 0),
    )
    db.add(new_tt); db.commit(); db.refresh(new_tt)
    _save_schedule(new_tt.id, result, db, mark_modified_sessions=affected_session_ids)

    enriched = _enrich_slots(
        db.query(Slot).filter(Slot.timetable_id == new_tt.id).all(), db
    )
    return {
        "timetable_id":    new_tt.id,
        "status":          new_tt.status,
        "solve_time":      new_tt.solve_time,
        "slots":           enriched,
        "modified_count":  sum(1 for s in enriched if s.get("is_modified")),
        "conflicts":       result.get("conflicts", []),
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

    sl.faculty_id  = body.substitute_faculty_id
    sl.is_modified = True
    db.commit()
    return {"ok": True, "new_faculty": new_fac.name}


@app.get("/timetables/{tt_id}/substitutes")
def find_substitutes(tt_id: int, slot_id: int = Query(...), db: Session = Depends(get_db)):
    """Find available substitute faculty for a given slot."""
    slot = db.query(Slot).filter(Slot.id == slot_id, Slot.timetable_id == tt_id).first()
    if not slot:
        raise HTTPException(404)

    tt   = db.query(Timetable).filter(Timetable.id == tt_id).first()
    inst = tt.institution_id
    all_fac = db.query(Faculty).filter(Faculty.institution_id == inst).all()

    # Busy faculty at this (day, period)
    busy_ids = {
        s.faculty_id
        for s in db.query(Slot).filter(
            Slot.timetable_id == tt_id,
            Slot.day == slot.day,
            Slot.period == slot.period,
        )
    }

    # Original course subject
    course = db.query(Course).filter(Course.id == slot.course_id).first()
    subject_name = course.name if course else ""

    candidates = []
    for fac in all_fac:
        if fac.id == slot.faculty_id:
            continue
        if fac.id in busy_ids:
            continue
        # Check unavailability
        unavail = fac.unavailable_slots or []
        if any(u["day"] == slot.day and u["period"] == slot.period for u in unavail):
            continue

        # Score: same subject → higher score
        subject_match = any(subject_name.lower() in s.lower() for s in (fac.subjects or []))
        candidates.append({
            "faculty_id":     fac.id,
            "faculty_name":   fac.name,
            "subject_match":  subject_match,
            "score":          10 if subject_match else 5,
        })

    candidates.sort(key=lambda x: -x["score"])
    return candidates[:5]


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
        sec_slots = [sl for sl in slots if sl.section_id == sec.id]
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
async def parse_constraint(body: NLPConstraintRequest):
    result = await parse_nlp_constraint(body.text, settings.ANTHROPIC_API_KEY)
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
