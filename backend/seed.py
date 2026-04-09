"""
Demo seed data — populates a realistic CS department with:
  - 1 Institution (Delhi Technical College)
  - 1 Department (Computer Science, Semester 5)
  - 4 Sections (CS-A, CS-B, CS-C, CS-D, ~60 students each)
  - 8 Faculty members
  - 10 Rooms (6 classrooms + 4 labs)
  - 8 Courses (mix of theory + practical, core + elective)
  - Section-Course assignments
  - 1 Combined group (Engineering Maths shared across CS-A & CS-B)

Run: python seed.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, init_db
from models import (
    Institution, Department, Room, Faculty,
    Course, Section, SectionCourse, CombinedGroup,
)


def seed():
    init_db()
    db = SessionLocal()

    # Clean existing
    for model in [SectionCourse, CombinedGroup, Section, Course,
                  Faculty, Room, Department, Institution]:
        db.query(model).delete()
    db.commit()

    # ── Institution ───────────────────────────────────────────────────────────
    inst = Institution(
        name="Delhi Technical College",
        working_days=[0, 1, 2, 3, 4, 5],          # Mon–Sat
        periods_per_day={
            "0": [0, 1, 2, 3, 4, 5, 6, 7],        # Mon: 8 periods
            "1": [0, 1, 2, 3, 4, 5, 6, 7],
            "2": [0, 1, 2, 3, 4, 5, 6, 7],
            "3": [0, 1, 2, 3, 4, 5, 6, 7],
            "4": [0, 1, 2, 3, 4, 5, 6, 7],
            "5": [0, 1, 2, 3],                     # Sat: 4 periods (half day)
        },
        break_slots={
            "0": [3], "1": [3], "2": [3],          # Lunch = period 3
            "3": [3], "4": [3], "5": [],            # Sat: no lunch break
        },
        period_duration_minutes=50,
        start_time="09:00",
    )
    db.add(inst); db.commit(); db.refresh(inst)

    # ── Department ────────────────────────────────────────────────────────────
    dept = Department(institution_id=inst.id, name="Computer Science")
    db.add(dept); db.commit(); db.refresh(dept)

    # ── Rooms ─────────────────────────────────────────────────────────────────
    rooms_data = [
        ("Room 101",  65, "classroom"),
        ("Room 102",  65, "classroom"),
        ("Room 201",  65, "classroom"),
        ("Room 202",  65, "classroom"),
        ("LH-1",     130, "lecture_hall"),    # combined classes
        ("LH-2",     130, "lecture_hall"),
        ("Lab A",     30, "lab"),
        ("Lab B",     30, "lab"),
        ("Lab C",     30, "lab"),
        ("Lab D",     30, "lab"),
    ]
    rooms = []
    for name, cap, rtype in rooms_data:
        r = Room(institution_id=inst.id, name=name, capacity=cap, room_type=rtype)
        db.add(r); rooms.append(r)
    db.commit()

    # ── Faculty ───────────────────────────────────────────────────────────────
    faculty_data = [
        ("Dr. Anita Sharma",    "anita@dtc.edu",  ["Data Structures", "Algorithms"],
         [{"day": 0, "period": 0}]),                # Unavailable Mon P1
        ("Prof. Rajan Mehta",   "rajan@dtc.edu",  ["DBMS", "SQL"],
         [{"day": 4, "period": 7}]),                # Unavailable Fri last period
        ("Dr. Priya Singh",     "priya@dtc.edu",  ["Operating Systems", "Linux"],
         []),
        ("Prof. Vikram Joshi",  "vikram@dtc.edu", ["Engineering Maths", "Calculus"],
         [{"day": 5, "period": 0}, {"day": 5, "period": 1}]),  # Sat first 2 periods
        ("Dr. Neha Gupta",      "neha@dtc.edu",   ["Computer Networks", "TCP/IP"],
         []),
        ("Prof. Arjun Patel",   "arjun@dtc.edu",  ["Software Engineering", "Agile"],
         [{"day": 2, "period": 0}]),
        ("Dr. Kavya Reddy",     "kavya@dtc.edu",  ["Machine Learning", "Python"],
         []),
        ("Prof. Suresh Kumar",  "suresh@dtc.edu", ["Web Technology", "JavaScript"],
         [{"day": 1, "period": 7}, {"day": 3, "period": 7}]),
    ]
    faculty = []
    for name, email, subjects, unavail in faculty_data:
        f = Faculty(
            institution_id=inst.id, name=name, email=email,
            subjects=subjects, unavailable_slots=unavail,
            max_consecutive_periods=3,
        )
        db.add(f); faculty.append(f)
    db.commit()

    f_sharma, f_mehta, f_singh, f_joshi, f_gupta, f_patel, f_reddy, f_suresh = faculty

    # ── Courses ───────────────────────────────────────────────────────────────
    courses_data = [
        # (name, code, theory_hrs, practical_hrs, credits, is_core, requires_lab)
        ("Data Structures",       "CS501", 3, 2, 4, True,  True),
        ("Database Management",   "CS502", 3, 2, 4, True,  True),
        ("Operating Systems",     "CS503", 3, 2, 4, True,  True),
        ("Engineering Maths",     "MA501", 4, 0, 4, True,  False),   # combined
        ("Computer Networks",     "CS504", 3, 0, 3, False, False),
        ("Software Engineering",  "CS505", 3, 0, 3, False, False),
        ("Machine Learning",      "CS506", 3, 2, 4, False, True),
        ("Web Technology",        "CS507", 2, 2, 3, False, True),
    ]
    courses = []
    for name, code, th, pr, cr, core, lab in courses_data:
        c = Course(
            department_id=dept.id, name=name, code=code,
            theory_hours=th, practical_hours=pr, credit_hours=cr,
            is_core=core, requires_lab=lab,
        )
        db.add(c); courses.append(c)
    db.commit()

    c_ds, c_dbms, c_os, c_maths, c_cn, c_se, c_ml, c_web = courses

    # ── Sections ──────────────────────────────────────────────────────────────
    sections_data = [
        ("CS-A", 58), ("CS-B", 62), ("CS-C", 55), ("CS-D", 60),
    ]
    sections = []
    for name, count in sections_data:
        s = Section(department_id=dept.id, name=name, student_count=count, semester=5)
        db.add(s); sections.append(s)
    db.commit()

    s_a, s_b, s_c, s_d = sections

    # ── Section-Course assignments ─────────────────────────────────────────────
    # Engineering Maths is combined for CS-A + CS-B → handled via CombinedGroup
    # So we DON'T add individual SectionCourse for Maths for CS-A/B

    assignments = [
        # CS-A
        (s_a, c_ds,   f_sharma),
        (s_a, c_dbms, f_mehta),
        (s_a, c_os,   f_singh),
        (s_a, c_cn,   f_gupta),
        (s_a, c_se,   f_patel),
        (s_a, c_ml,   f_reddy),
        (s_a, c_web,  f_suresh),

        # CS-B
        (s_b, c_ds,   f_sharma),
        (s_b, c_dbms, f_mehta),
        (s_b, c_os,   f_singh),
        (s_b, c_cn,   f_gupta),
        (s_b, c_se,   f_patel),
        (s_b, c_ml,   f_reddy),
        (s_b, c_web,  f_suresh),

        # CS-C
        (s_c, c_ds,    f_sharma),
        (s_c, c_dbms,  f_mehta),
        (s_c, c_os,    f_singh),
        (s_c, c_maths, f_joshi),
        (s_c, c_cn,    f_gupta),
        (s_c, c_se,    f_patel),
        (s_c, c_web,   f_suresh),

        # CS-D
        (s_d, c_ds,    f_sharma),
        (s_d, c_dbms,  f_mehta),
        (s_d, c_os,    f_singh),
        (s_d, c_maths, f_joshi),
        (s_d, c_cn,    f_gupta),
        (s_d, c_ml,    f_reddy),
        (s_d, c_web,   f_suresh),
    ]

    for sec, course, fac in assignments:
        sc = SectionCourse(
            section_id=sec.id, course_id=course.id, faculty_id=fac.id
        )
        db.add(sc)
    db.commit()

    # ── Combined Group: Maths for CS-A + CS-B ────────────────────────────────
    cg = CombinedGroup(
        institution_id=inst.id,
        section_ids=[s_a.id, s_b.id],
        course_id=c_maths.id,
        faculty_id=f_joshi.id,
    )
    db.add(cg); db.commit()

    print("✅ Seed complete!")
    print(f"   Institution ID : {inst.id}")
    print(f"   Department ID  : {dept.id}")
    print(f"   Sections       : {[s.id for s in sections]}")
    print(f"   Courses        : {[c.id for c in courses]}")
    print(f"   Faculty        : {[f.id for f in faculty]}")
    print(f"   Rooms          : {[r.id for r in rooms]}")
    print(f"\nNow generate a timetable:")
    print(f'  POST /timetables/generate  {{"institution_id": {inst.id}, "name": "Sem 5 Timetable"}}')

    db.close()


if __name__ == "__main__":
    seed()
