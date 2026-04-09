from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


# ─── Institution ─────────────────────────────────────────────────────────────
class InstitutionCreate(BaseModel):
    name: str
    working_days: List[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    periods_per_day: Dict[str, List[int]] = Field(default_factory=lambda: {
        "0": [0,1,2,3,4,5,6,7],
        "1": [0,1,2,3,4,5,6,7],
        "2": [0,1,2,3,4,5,6,7],
        "3": [0,1,2,3,4,5,6,7],
        "4": [0,1,2,3,4,5,6,7],
    })
    break_slots: Dict[str, List[int]] = Field(default_factory=lambda: {
        "0": [3], "1": [3], "2": [3], "3": [3], "4": [3]
    })
    period_duration_minutes: int = Field(default=50, ge=1)
    start_time: str = "09:00"


class InstitutionOut(InstitutionCreate):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True


# ─── Department ──────────────────────────────────────────────────────────────
class DepartmentCreate(BaseModel):
    institution_id: int
    name: str


class DepartmentOut(DepartmentCreate):
    id: int
    class Config:
        from_attributes = True


# ─── Room ─────────────────────────────────────────────────────────────────────
class RoomCreate(BaseModel):
    institution_id: int
    name: str
    capacity: int = Field(default=60, ge=1)
    room_type: str = "classroom"   # classroom | lab | lecture_hall


class RoomOut(RoomCreate):
    id: int
    class Config:
        from_attributes = True


# ─── Faculty ──────────────────────────────────────────────────────────────────
class UnavailableSlot(BaseModel):
    day: int
    period: int


class FacultyCreate(BaseModel):
    institution_id: int
    name: str
    email: str = ""
    phone: str = ""
    subjects: List[str] = Field(default_factory=list)
    unavailable_slots: List[UnavailableSlot] = Field(default_factory=list)
    max_consecutive_periods: int = Field(default=3, ge=1)


class FacultyOut(FacultyCreate):
    id: int
    class Config:
        from_attributes = True


# ─── Course ───────────────────────────────────────────────────────────────────
class CourseCreate(BaseModel):
    department_id: int
    name: str
    code: str = ""
    theory_hours: int = Field(default=3, ge=0)
    practical_hours: int = Field(default=0, ge=0)
    credit_hours: int = Field(default=3, ge=0)
    is_core: bool = False
    requires_lab: bool = False


class CourseOut(CourseCreate):
    id: int
    class Config:
        from_attributes = True


# ─── Section ──────────────────────────────────────────────────────────────────
class SectionCreate(BaseModel):
    department_id: int
    name: str
    student_count: int = Field(default=60, ge=1)
    semester: int = Field(default=1, ge=1)
    class_representative_name: str = ""
    class_representative_phone: str = ""


class SectionOut(SectionCreate):
    id: int
    class Config:
        from_attributes = True


# ─── SectionCourse ────────────────────────────────────────────────────────────
class SectionCourseCreate(BaseModel):
    section_id: int
    course_id: int
    faculty_id: int


class SectionCourseOut(SectionCourseCreate):
    id: int
    class Config:
        from_attributes = True


# ─── CombinedGroup ────────────────────────────────────────────────────────────
class CombinedGroupCreate(BaseModel):
    institution_id: int
    section_ids: List[int] = Field(min_length=2)
    course_id: int
    faculty_id: int


class CombinedGroupOut(CombinedGroupCreate):
    id: int
    class Config:
        from_attributes = True


# ─── Timetable Generation ─────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    institution_id: int
    name: str = "Semester Timetable"
    semester: str = ""
    locked_slots: List[Dict[str, Any]] = Field(default_factory=list)
    max_solve_seconds: int = Field(default=60, ge=1, le=300)


class WhatIfRequest(BaseModel):
    timetable_id: int
    absent_faculty_id: int
    affected_days: List[int] = Field(default_factory=list)       # empty = all days


class SubstituteRequest(BaseModel):
    slot_id: int
    substitute_faculty_id: int


# ─── NLP ──────────────────────────────────────────────────────────────────────
class NLPConstraintRequest(BaseModel):
    institution_id: int
    text: str


class NLPExecuteRequest(BaseModel):
    institution_id: int
    text: str
    timetable_id: Optional[int] = None


class NLPConstraintResponse(BaseModel):
    original_text: str
    parsed: Dict[str, Any]
    confidence: float
    description: str


class NLPExecuteResponse(BaseModel):
    original_text: str
    parsed: Dict[str, Any]
    action_type: str
    executed: bool
    description: str
    result: Dict[str, Any] = {}


# ─── Notifications ────────────────────────────────────────────────────────────
class WhatsAppSendRequest(BaseModel):
    to_number: str = Field(..., description="E.164 number, optionally prefixed with 'whatsapp:'")
    message: str = Field(..., min_length=1, max_length=4096)


class WhatsAppSendResponse(BaseModel):
    ok: bool = True
    sid: str


class WhatsAppSectionSendRequest(BaseModel):
    section_ids: List[int] = Field(..., min_length=1)
    message: str = Field(..., min_length=1, max_length=4096)


class WhatsAppSectionDelivery(BaseModel):
    section_id: int
    section_name: str
    to_number: str
    sid: str


class WhatsAppSectionSkipped(BaseModel):
    section_id: int
    section_name: str
    reason: str


class WhatsAppSectionSendResponse(BaseModel):
    ok: bool = True
    sent_count: int
    skipped_count: int
    deliveries: List[WhatsAppSectionDelivery]
    skipped: List[WhatsAppSectionSkipped]


# ─── Slot responses ───────────────────────────────────────────────────────────
class SlotOut(BaseModel):
    id: int
    timetable_id: int
    section_id: Optional[int]
    section_ids: List[int]
    course_id: int
    faculty_id: int
    room_id: Optional[int]
    day: int
    period: int
    duration: int
    slot_type: str
    is_locked: bool
    is_combined: bool
    is_modified: bool
    # Joined names for frontend
    course_name: Optional[str] = None
    faculty_name: Optional[str] = None
    room_name: Optional[str] = None
    section_name: Optional[str] = None

    class Config:
        from_attributes = True


class TimetableOut(BaseModel):
    id: int
    institution_id: int
    name: str
    semester: str
    status: str
    solve_time: float
    created_at: Optional[datetime] = None
    slots: List[SlotOut] = []
    violations: List[Dict[str, Any]] = []

    class Config:
        from_attributes = True


# ─── Analytics ────────────────────────────────────────────────────────────────
class AnalyticsOut(BaseModel):
    faculty_load: List[Dict[str, Any]]
    room_utilization: List[Dict[str, Any]]
    section_gaps: List[Dict[str, Any]]
    core_subject_distribution: Dict[str, Any]
    wellbeing_scores: List[Dict[str, Any]]
    total_slots: int
    total_conflicts: int
