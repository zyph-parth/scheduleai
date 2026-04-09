from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import CombinedGroup, Course, Department, Faculty, Institution, Room, Section, SectionCourse, Slot


SessionSignature = Tuple[Tuple[int, ...], int, int, str, int]


def not_found(entity: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{entity} not found")


def bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def get_required(model, entity: str, object_id: int, db: Session):
    obj = db.query(model).filter(model.id == object_id).first()
    if not obj:
        raise not_found(entity)
    return obj


def get_institution(institution_id: int, db: Session) -> Institution:
    return get_required(Institution, "Institution", institution_id, db)


def get_department(department_id: int, db: Session) -> Department:
    return get_required(Department, "Department", department_id, db)


def get_course(course_id: int, db: Session) -> Course:
    return get_required(Course, "Course", course_id, db)


def get_faculty(faculty_id: int, db: Session) -> Faculty:
    return get_required(Faculty, "Faculty", faculty_id, db)


def get_section(section_id: int, db: Session) -> Section:
    return get_required(Section, "Section", section_id, db)


def get_room(room_id: int, db: Session) -> Room:
    return get_required(Room, "Room", room_id, db)


def normalize_period_map(periods_per_day: Dict[Any, Sequence[int]]) -> Dict[int, List[int]]:
    return {int(day): sorted(int(period) for period in periods) for day, periods in (periods_per_day or {}).items()}


def occupied_periods(day: int, period: int, duration: int, periods_per_day: Dict[int, Sequence[int]]) -> List[int]:
    periods = list(periods_per_day.get(day, []))
    if period not in periods:
        return [period]
    idx = periods.index(period)
    return periods[idx: idx + max(duration, 1)]


def slot_signature(slot_like: Any, occurrence: int = 0) -> SessionSignature:
    section_ids = tuple(sorted(getattr(slot_like, "section_ids", None) or slot_like.get("section_ids") or []))
    section_id = getattr(slot_like, "section_id", None)
    if section_id is None and hasattr(slot_like, "get"):
        section_id = slot_like.get("section_id")
    if not section_ids and section_id is not None:
        section_ids = (section_id,)
    course_id = getattr(slot_like, "course_id", None)
    if course_id is None and hasattr(slot_like, "get"):
        course_id = slot_like.get("course_id")
    faculty_id = getattr(slot_like, "faculty_id", None)
    if faculty_id is None and hasattr(slot_like, "get"):
        faculty_id = slot_like.get("faculty_id")
    slot_type = getattr(slot_like, "slot_type", None)
    if slot_type is None and hasattr(slot_like, "get"):
        slot_type = slot_like.get("slot_type")
    return (section_ids, int(course_id), int(faculty_id), str(slot_type), int(occurrence))


def annotate_occurrences_from_slots(slots: Sequence[Slot]) -> Dict[int, int]:
    grouped: Dict[Tuple[Tuple[int, ...], int, int, str], List[Slot]] = defaultdict(list)
    for slot in slots:
        signature = slot_signature(slot)[:-1]
        grouped[signature].append(slot)

    occurrences: Dict[int, int] = {}
    for signature_slots in grouped.values():
        for occ, slot in enumerate(sorted(signature_slots, key=lambda item: (item.day, item.period, item.id))):
            occurrences[slot.id] = occ
    return occurrences


def group_entries_by_signature(entries: Sequence[Dict[str, Any]]) -> Dict[SessionSignature, Dict[str, Any]]:
    grouped: Dict[SessionSignature, Dict[str, Any]] = {}
    for entry in entries:
        signature = slot_signature(entry, occurrence=entry.get("occurrence", 0))
        grouped[signature] = entry
    return grouped


def build_recovery_suggestions(conflicts: Sequence[Dict[str, Any]]) -> List[str]:
    suggestions: List[str] = []
    for conflict in conflicts:
        conflict_type = conflict.get("type")
        meta = conflict.get("meta") or {}
        if conflict_type == "section_overload":
            suggestions.append(
                f"Add more teaching periods or reduce the weekly load for section {meta.get('section_name', 'the affected section')}."
            )
        elif conflict_type == "faculty_overload":
            suggestions.append(
                f"Free up {meta.get('faculty_name', 'the affected faculty member')} or reassign one of their courses."
            )
        elif conflict_type == "room_capacity_shortage":
            suggestions.append(
                f"Add one room with at least {meta.get('needed_capacity', 'the required')} seats for {meta.get('course_name', 'the affected class')}."
            )
        elif conflict_type == "lab_room_shortage":
            suggestions.append("Add or free one lab room for the affected lab blocks.")
        elif conflict_type == "locked_slot_conflict":
            suggestions.append("Unlock or move one of the pinned slots that is blocking regeneration.")
        elif conflict_type == "no_valid_slot":
            suggestions.append(
                f"Free {meta.get('faculty_name', 'the faculty member')} or open one more valid period for {meta.get('course_name', 'the affected course')}."
            )

    # Preserve order while removing duplicates.
    seen: Set[str] = set()
    unique: List[str] = []
    for suggestion in suggestions:
        if suggestion not in seen:
            seen.add(suggestion)
            unique.append(suggestion)
    return unique[:5]


def build_solver_input(
    institution: Institution,
    sections: Sequence[Section],
    courses: Sequence[Course],
    faculty: Sequence[Faculty],
    rooms: Sequence[Room],
    section_courses: Sequence[SectionCourse],
    combined_groups: Sequence[CombinedGroup],
    locked_slots: Optional[List[Dict[str, Any]]] = None,
    max_seconds: int = 60,
) -> Dict[str, Any]:
    return {
        "institution": {
            "working_days": institution.working_days,
            "periods_per_day": institution.periods_per_day,
            "break_slots": institution.break_slots,
            "period_duration_minutes": institution.period_duration_minutes,
            "start_time": institution.start_time,
        },
        "sections": [
            {
                "id": section.id,
                "name": section.name,
                "student_count": section.student_count,
                "department_id": section.department_id,
            }
            for section in sections
        ],
        "courses": [
            {
                "id": course.id,
                "name": course.name,
                "theory_hours": course.theory_hours,
                "practical_hours": course.practical_hours,
                "is_core": course.is_core,
                "requires_lab": course.requires_lab,
                "department_id": course.department_id,
            }
            for course in courses
        ],
        "faculty": [
            {
                "id": member.id,
                "name": member.name,
                "unavailable_slots": member.unavailable_slots or [],
                "max_consecutive_periods": member.max_consecutive_periods,
            }
            for member in faculty
        ],
        "rooms": [
            {
                "id": room.id,
                "name": room.name,
                "capacity": room.capacity,
                "room_type": room.room_type,
            }
            for room in rooms
        ],
        "section_courses": [
            {
                "section_id": assignment.section_id,
                "course_id": assignment.course_id,
                "faculty_id": assignment.faculty_id,
            }
            for assignment in section_courses
        ],
        "combined_groups": [
            {
                "id": group.id,
                "section_ids": group.section_ids,
                "course_id": group.course_id,
                "faculty_id": group.faculty_id,
            }
            for group in combined_groups
        ],
        "locked_slots": locked_slots or [],
        "max_solve_seconds": max_seconds,
    }


def build_analytics(
    tt_slots: Sequence[Slot],
    institution: Institution,
    db: Session,
    total_conflicts: int = 0,
) -> Dict[str, Any]:
    periods_per_day = normalize_period_map(institution.periods_per_day or {})
    total_periods_per_room = sum(len(periods_per_day.get(day, [])) for day in institution.working_days)

    faculty_load: Dict[int, int] = defaultdict(int)
    room_usage: Dict[int, int] = defaultdict(int)
    section_daily_periods: Dict[int, Dict[int, Set[int]]] = defaultdict(lambda: defaultdict(set))
    core_total = 0
    core_in_morning = 0

    for slot in tt_slots:
        occupied = occupied_periods(slot.day, slot.period, slot.duration, periods_per_day)
        faculty_load[slot.faculty_id] += len(occupied)
        if slot.room_id:
            room_usage[slot.room_id] += len(occupied)
        for section_id in slot.section_ids or ([slot.section_id] if slot.section_id else []):
            section_daily_periods[section_id][slot.day].update(occupied)
        if slot.course and slot.course.is_core:
            core_total += 1
            if slot.period < 2:
                core_in_morning += 1

    faculty_rows = []
    for faculty_id, hours in sorted(faculty_load.items(), key=lambda item: item[1], reverse=True):
        faculty = db.query(Faculty).filter(Faculty.id == faculty_id).first()
        wellbeing = min(100, max(0, 100 - abs(hours - 18) * 3))
        faculty_rows.append(
            {
                "faculty_id": faculty_id,
                "faculty_name": faculty.name if faculty else str(faculty_id),
                "hours_per_week": hours,
                "wellbeing_score": wellbeing,
            }
        )

    room_rows = []
    for room in db.query(Room).filter(Room.institution_id == institution.id).all():
        used = room_usage.get(room.id, 0)
        room_rows.append(
            {
                "room_id": room.id,
                "room_name": room.name,
                "room_type": room.room_type,
                "used_periods": used,
                "total_periods": total_periods_per_room,
                "utilization_pct": round((used / max(total_periods_per_room, 1)) * 100, 1),
            }
        )

    gap_rows = []
    sections = db.query(Section).join(Department).filter(Department.institution_id == institution.id).all()
    for section in sections:
        total_gaps = 0
        for day in institution.working_days:
            periods = sorted(section_daily_periods.get(section.id, {}).get(day, set()))
            if len(periods) >= 2:
                total_gaps += periods[-1] - periods[0] + 1 - len(periods)
        gap_rows.append(
            {
                "section_id": section.id,
                "section_name": section.name,
                "total_gaps": total_gaps,
            }
        )

    return {
        "faculty_load": faculty_rows,
        "room_utilization": room_rows,
        "section_gaps": gap_rows,
        "core_subject_distribution": {
            "core_total": core_total,
            "core_in_morning": core_in_morning,
            "morning_pct": round((core_in_morning / max(core_total, 1)) * 100, 1),
        },
        "wellbeing_scores": [
            {
                "faculty_id": row["faculty_id"],
                "faculty_name": row["faculty_name"],
                "score": row["wellbeing_score"],
            }
            for row in faculty_rows
        ],
        "total_slots": len(tt_slots),
        "total_conflicts": total_conflicts,
    }
