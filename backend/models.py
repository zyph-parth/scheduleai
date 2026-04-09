from sqlalchemy import (
    Column, Integer, String, Boolean, JSON, ForeignKey,
    DateTime, Text, Float, Enum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


class RoomType(str, enum.Enum):
    classroom = "classroom"
    lab = "lab"
    lecture_hall = "lecture_hall"


class Institution(Base):
    __tablename__ = "institutions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    working_days = Column(JSON, default=[0, 1, 2, 3, 4])       # [0=Mon..5=Sat]
    periods_per_day = Column(JSON, default={})                  # {day: [0,1,2,...]}
    break_slots = Column(JSON, default={})                      # {day: [period,...]}
    period_duration_minutes = Column(Integer, default=50)
    start_time = Column(String, default="09:00")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    departments = relationship("Department", back_populates="institution", cascade="all, delete")
    rooms = relationship("Room", back_populates="institution", cascade="all, delete")
    faculty = relationship("Faculty", back_populates="institution", cascade="all, delete")
    timetables = relationship("Timetable", back_populates="institution", cascade="all, delete")


class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    name = Column(String, nullable=False)

    institution = relationship("Institution", back_populates="departments")
    sections = relationship("Section", back_populates="department", cascade="all, delete")
    courses = relationship("Course", back_populates="department", cascade="all, delete")


class Room(Base):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    name = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    room_type = Column(String, default="classroom")   # classroom | lab | lecture_hall

    institution = relationship("Institution", back_populates="rooms")


class Faculty(Base):
    __tablename__ = "faculty"
    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, default="")
    phone = Column(String, default="")
    subjects = Column(JSON, default=[])               # list of subject names
    unavailable_slots = Column(JSON, default=[])      # [{day, period}]
    max_consecutive_periods = Column(Integer, default=3)

    institution = relationship("Institution", back_populates="faculty")


class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    name = Column(String, nullable=False)
    code = Column(String, default="")
    theory_hours = Column(Integer, default=3)         # hours per week
    practical_hours = Column(Integer, default=2)      # hours per week (labs come in pairs)
    credit_hours = Column(Integer, default=3)
    is_core = Column(Boolean, default=False)
    requires_lab = Column(Boolean, default=False)

    department = relationship("Department", back_populates="courses")


class Section(Base):
    __tablename__ = "sections"
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    name = Column(String, nullable=False)
    student_count = Column(Integer, default=60)
    semester = Column(Integer, default=1)
    class_representative_name = Column(String, default="")
    class_representative_phone = Column(String, default="")

    department = relationship("Department", back_populates="sections")
    section_courses = relationship("SectionCourse", back_populates="section", cascade="all, delete")


class SectionCourse(Base):
    __tablename__ = "section_courses"
    id = Column(Integer, primary_key=True, index=True)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)

    section = relationship("Section", back_populates="section_courses")
    course = relationship("Course")
    faculty = relationship("Faculty")


class CombinedGroup(Base):
    __tablename__ = "combined_groups"
    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    section_ids = Column(JSON, nullable=False)         # [section_id, ...]
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)

    course = relationship("Course")
    faculty = relationship("Faculty")


class Timetable(Base):
    __tablename__ = "timetables"
    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    name = Column(String, default="Semester Timetable")
    semester = Column(String, default="")
    status = Column(String, default="pending")        # pending | generating | done | failed | infeasible
    solve_time = Column(Float, default=0.0)
    metadata_ = Column("metadata", JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    institution = relationship("Institution", back_populates="timetables")
    slots = relationship("Slot", back_populates="timetable", cascade="all, delete")
    violations = relationship("ConstraintViolation", back_populates="timetable", cascade="all, delete")


class Slot(Base):
    __tablename__ = "slots"
    id = Column(Integer, primary_key=True, index=True)
    timetable_id = Column(Integer, ForeignKey("timetables.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=True)
    section_ids = Column(JSON, default=[])            # for combined groups
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    day = Column(Integer, nullable=False)             # 0=Mon..5=Sat
    period = Column(Integer, nullable=False)          # period index
    duration = Column(Integer, default=1)             # 1=theory, 2=lab
    slot_type = Column(String, default="theory")      # theory | lab | break
    is_locked = Column(Boolean, default=False)
    is_combined = Column(Boolean, default=False)
    is_modified = Column(Boolean, default=False)      # highlighted in what-if

    timetable = relationship("Timetable", back_populates="slots")
    section = relationship("Section")
    course = relationship("Course")
    faculty = relationship("Faculty")
    room = relationship("Room")


class ConstraintViolation(Base):
    __tablename__ = "constraint_violations"
    id = Column(Integer, primary_key=True, index=True)
    timetable_id = Column(Integer, ForeignKey("timetables.id"), nullable=False)
    constraint_type = Column(String)
    description = Column(Text)
    severity = Column(String, default="hard")

    timetable = relationship("Timetable", back_populates="violations")
