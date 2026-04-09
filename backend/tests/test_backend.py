import os
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_timetable.db")

from fastapi.testclient import TestClient

from database import SessionLocal, init_db
from main import app
from models import CombinedGroup, Course, Department, Faculty, Institution, Room, Section, SectionCourse, Slot, Timetable
from seed import seed


class BackendTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

    def setUp(self):
        seed()

    def _generate(self, institution_id: int = 1, name: str = "Test Timetable", locked_slots=None):
        payload = {
            "institution_id": institution_id,
            "name": name,
            "max_solve_seconds": 20,
        }
        if locked_slots is not None:
            payload["locked_slots"] = locked_slots
        response = self.client.post("/timetables/generate", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_generate_seed_data_success_and_no_overlaps(self):
        generated = self._generate()
        self.assertEqual(generated["status"], "done")
        self.assertEqual(generated["conflicts"], [])
        detail = self.client.get(f"/timetables/{generated['timetable_id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        slots = detail.json()["slots"]

        faculty_usage = set()
        section_usage = set()
        room_usage = set()
        for slot in slots:
            occupied = [slot["period"]]
            if slot["duration"] > 1:
                occupied.append(slot["period"] + 1)
            for period in occupied:
                faculty_key = (slot["faculty_id"], slot["day"], period)
                self.assertNotIn(faculty_key, faculty_usage)
                faculty_usage.add(faculty_key)
                for section_id in slot.get("section_ids") or ([slot["section_id"]] if slot["section_id"] else []):
                    section_key = (section_id, slot["day"], period)
                    self.assertNotIn(section_key, section_usage)
                    section_usage.add(section_key)
                if slot["room_id"] is not None:
                    room_key = (slot["room_id"], slot["day"], period)
                    self.assertNotIn(room_key, room_usage)
                    room_usage.add(room_key)

    def test_locked_slots_are_preserved(self):
        first = self._generate(name="Baseline")
        detail = self.client.get(f"/timetables/{first['timetable_id']}").json()
        first_slot = detail["slots"][0]
        second = self._generate(
            name="Locked",
            locked_slots=[
                {
                    "section_id": first_slot["section_id"],
                    "course_id": first_slot["course_id"],
                    "type": first_slot["slot_type"],
                    "occurrence": first_slot.get("occurrence", 0),
                    "day": first_slot["day"],
                    "period": first_slot["period"],
                }
            ],
        )
        self.assertEqual(second["status"], "done")
        new_detail = self.client.get(f"/timetables/{second['timetable_id']}").json()
        matching = [
            slot for slot in new_detail["slots"]
            if slot["section_id"] == first_slot["section_id"]
            and slot["course_id"] == first_slot["course_id"]
            and slot["slot_type"] == first_slot["slot_type"]
            and slot.get("occurrence", 0) == first_slot.get("occurrence", 0)
        ]
        self.assertTrue(matching)
        self.assertEqual(matching[0]["day"], first_slot["day"])
        self.assertEqual(matching[0]["period"], first_slot["period"])

    def test_what_if_marks_modified_slots_and_returns_diagnostics(self):
        generated = self._generate()
        response = self.client.post(
            "/timetables/what-if",
            json={
                "timetable_id": generated["timetable_id"],
                "absent_faculty_id": 1,
                "affected_days": [],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertIn("diagnostics", payload)
        self.assertIn("recovery_suggestions", payload)
        self.assertGreaterEqual(payload["modified_count"], 0)

    def test_nlp_execute_absence_runs_action(self):
        generated = self._generate()
        response = self.client.post(
            "/nlp/execute",
            json={
                "institution_id": 1,
                "timetable_id": generated["timetable_id"],
                "text": "Dr. Sharma is absent on Monday",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["executed"])
        self.assertEqual(payload["action_type"], "faculty_absence")
        self.assertEqual(payload["result"]["mode"], "what_if")

    def test_substitutes_return_candidate_and_block_reasons(self):
        generated = self._generate()
        detail = self.client.get(f"/timetables/{generated['timetable_id']}").json()
        slot = detail["slots"][0]
        response = self.client.get(
            f"/timetables/{generated['timetable_id']}/substitutes",
            params={"slot_id": slot["id"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertIn("candidates", payload)
        self.assertIn("blocked_reasons", payload)
        self.assertIsInstance(payload["candidates"], list)

    def test_analytics_and_exports_work(self):
        generated = self._generate()
        analytics = self.client.get(f"/timetables/{generated['timetable_id']}/analytics")
        self.assertEqual(analytics.status_code, 200, analytics.text)
        analytics_payload = analytics.json()
        self.assertIn("faculty_load", analytics_payload)
        self.assertIn("room_utilization", analytics_payload)
        self.assertIn("core_subject_distribution", analytics_payload)

        excel = self.client.get(f"/timetables/{generated['timetable_id']}/export/excel")
        pdf = self.client.get(f"/timetables/{generated['timetable_id']}/export/pdf")
        self.assertEqual(excel.status_code, 200, excel.text)
        self.assertEqual(pdf.status_code, 200, pdf.text)
        self.assertGreater(len(excel.content), 100)
        self.assertGreater(len(pdf.content), 100)

    def test_infeasible_generation_reports_room_shortage(self):
        db = SessionLocal()
        for model in [Slot, Timetable, SectionCourse, CombinedGroup, Section, Course, Faculty, Room, Department, Institution]:
            db.query(model).delete()
        db.commit()

        institution = Institution(
            name="Room Stress Test",
            working_days=[0],
            periods_per_day={"0": [0]},
            break_slots={"0": []},
            period_duration_minutes=50,
            start_time="09:00",
        )
        db.add(institution)
        db.commit()
        db.refresh(institution)

        department = Department(institution_id=institution.id, name="CSE")
        db.add(department)
        db.commit()
        db.refresh(department)

        room = Room(institution_id=institution.id, name="Tiny Room", capacity=30, room_type="classroom")
        faculty = Faculty(institution_id=institution.id, name="Prof. Room", subjects=["Mega Class"], unavailable_slots=[])
        course = Course(department_id=department.id, name="Mega Class", theory_hours=1, practical_hours=0, is_core=True)
        section = Section(department_id=department.id, name="A", student_count=120, semester=1)
        db.add_all([room, faculty, course, section])
        db.commit()
        db.refresh(course)
        db.refresh(section)
        db.refresh(faculty)

        db.add(SectionCourse(section_id=section.id, course_id=course.id, faculty_id=faculty.id))
        db.commit()
        institution_id = institution.id
        db.close()

        payload = self._generate(institution_id=institution_id, name="Infeasible")
        self.assertEqual(payload["status"], "infeasible")
        conflict_types = {conflict["type"] for conflict in payload["conflicts"]}
        self.assertIn("room_capacity_shortage", conflict_types)
        self.assertTrue(payload["recovery_suggestions"])


if __name__ == "__main__":
    unittest.main()
