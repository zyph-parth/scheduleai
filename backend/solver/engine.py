"""
Timetable solver using OR-Tools CP-SAT.
"""

import logging
import math
import time
from typing import Any, Dict, List, Optional, Tuple

from ortools.sat.python import cp_model

logger = logging.getLogger(__name__)


def solve_timetable(data: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.time()
    try:
        solver = TimetableSolver(data)
        result = solver.solve()
    except Exception as exc:
        logger.exception("Solver crashed")
        result = {"status": "error", "message": str(exc), "schedule": [], "conflicts": []}
    result["solve_time"] = round(time.time() - t0, 3)
    return result


class TimetableSolver:
    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.model = cp_model.CpModel()
        self.cp_solver = cp_model.CpSolver()

        institution = data.get("institution", {})
        self.working_days: List[int] = institution.get("working_days", [0, 1, 2, 3, 4])
        self.max_solve_seconds = int(data.get("max_solve_seconds", 60))

        raw_periods = institution.get("periods_per_day", {})
        self.periods_per_day: Dict[int, List[int]] = {
            int(day): sorted(int(period) for period in periods)
            for day, periods in raw_periods.items()
        }
        for day in self.working_days:
            self.periods_per_day.setdefault(day, list(range(8)))

        raw_breaks = institution.get("break_slots", {})
        self.break_slots: Dict[int, set] = {
            int(day): {int(period) for period in periods}
            for day, periods in raw_breaks.items()
        }

        self.section_map = {section["id"]: section for section in data.get("sections", [])}
        self.course_map = {course["id"]: course for course in data.get("courses", [])}
        self.faculty_map = {faculty["id"]: faculty for faculty in data.get("faculty", [])}
        self.room_map = {room["id"]: room for room in data.get("rooms", [])}

        self.section_courses = data.get("section_courses", [])
        self.combined_groups = data.get("combined_groups", [])
        self.locked_slots = data.get("locked_slots", [])

        self.sessions: List[Dict[str, Any]] = []
        self.all_vars: Dict[Tuple[int, int, int], Any] = {}
        self.session_room_candidates: Dict[int, List[Dict[str, Any]]] = {}
        self.impossible_sessions: List[Dict[str, Any]] = []
        self.locked_slot_issues: List[Dict[str, Any]] = []
        self.unassigned_entries: List[Dict[str, Any]] = []

        self._build_slot_lists()

    def _is_break(self, day: int, period: int) -> bool:
        return period in self.break_slots.get(day, set())

    def _build_slot_lists(self) -> None:
        self.valid_theory_slots: List[Tuple[int, int]] = []
        self.valid_lab_starts: List[Tuple[int, int]] = []
        self.period_next: Dict[Tuple[int, int], Optional[int]] = {}

        for day in self.working_days:
            periods = self.periods_per_day.get(day, [])
            for index, period in enumerate(periods):
                nxt = periods[index + 1] if index + 1 < len(periods) else None
                self.period_next[(day, period)] = nxt
                if self._is_break(day, period):
                    continue
                self.valid_theory_slots.append((day, period))
                if nxt is not None and not self._is_break(day, nxt):
                    self.valid_lab_starts.append((day, period))

    def _valid_slots_for(self, slot_type: str) -> List[Tuple[int, int]]:
        return self.valid_lab_starts if slot_type == "lab" else self.valid_theory_slots

    def _student_count_for(self, section_ids: List[int], slot_type: str) -> int:
        total = sum(self.section_map.get(section_id, {}).get("student_count", 0) for section_id in section_ids)
        if slot_type == "lab":
            return max(1, math.ceil(total / 2))
        return total

    def _candidate_rooms_for_session(self, session: Dict[str, Any]) -> List[Dict[str, Any]]:
        student_count = self._student_count_for(session["section_ids"], session["type"])
        needs_lab = session["type"] == "lab"
        candidates: List[Dict[str, Any]] = []
        for room in self.room_map.values():
            effective_capacity = int(room["capacity"]) + (1 if needs_lab else 0)
            if effective_capacity < student_count:
                continue
            if needs_lab and room["room_type"] != "lab":
                continue
            if not needs_lab and room["room_type"] == "lab":
                continue
            candidates.append(room)
        return sorted(candidates, key=lambda room: (room["capacity"], room["name"]))

    def _build_conflict(self, conflict_type: str, description: str, severity: str = "hard", meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {
            "type": conflict_type,
            "severity": severity,
            "description": description,
            "meta": meta or {},
        }

    def _get_occupying_vars(self, sessions: List[Dict[str, Any]], day: int, period: int) -> List[Any]:
        result = []
        for session in sessions:
            session_id = session["session_id"]
            if session["type"] == "theory":
                var = self.all_vars.get((session_id, day, period))
                if var is not None:
                    result.append(var)
                continue

            var = self.all_vars.get((session_id, day, period))
            if var is not None:
                result.append(var)

            periods = self.periods_per_day.get(day, [])
            index = periods.index(period) if period in periods else -1
            if index > 0:
                prev_period = periods[index - 1]
                prev_var = self.all_vars.get((session_id, day, prev_period))
                if prev_var is not None:
                    result.append(prev_var)
        return result

    def _build_sessions(self) -> None:
        sessions: List[Dict[str, Any]] = []
        next_session_id = 0

        combined_covered = {
            (section_id, group["course_id"])
            for group in self.combined_groups
            for section_id in group["section_ids"]
        }

        for assignment in self.section_courses:
            section_id = assignment["section_id"]
            course_id = assignment["course_id"]
            faculty_id = assignment["faculty_id"]
            if (section_id, course_id) in combined_covered:
                continue

            course = self.course_map.get(course_id, {})
            for occurrence in range(course.get("theory_hours", 0)):
                sessions.append({
                    "session_id": next_session_id,
                    "section_id": section_id,
                    "section_ids": [section_id],
                    "course_id": course_id,
                    "faculty_id": faculty_id,
                    "type": "theory",
                    "occurrence": occurrence,
                    "is_combined": False,
                })
                next_session_id += 1

            for occurrence in range(course.get("practical_hours", 0) // 2):
                sessions.append({
                    "session_id": next_session_id,
                    "section_id": section_id,
                    "section_ids": [section_id],
                    "course_id": course_id,
                    "faculty_id": faculty_id,
                    "type": "lab",
                    "occurrence": occurrence,
                    "is_combined": False,
                })
                next_session_id += 1

        for group in self.combined_groups:
            course_id = group["course_id"]
            faculty_id = group["faculty_id"]
            course = self.course_map.get(course_id, {})
            section_ids = list(group["section_ids"])
            primary_section_id = section_ids[0]

            for occurrence in range(course.get("theory_hours", 0)):
                sessions.append({
                    "session_id": next_session_id,
                    "section_id": primary_section_id,
                    "section_ids": section_ids,
                    "course_id": course_id,
                    "faculty_id": faculty_id,
                    "type": "theory",
                    "occurrence": occurrence,
                    "is_combined": True,
                })
                next_session_id += 1

            for occurrence in range(course.get("practical_hours", 0) // 2):
                sessions.append({
                    "session_id": next_session_id,
                    "section_id": primary_section_id,
                    "section_ids": section_ids,
                    "course_id": course_id,
                    "faculty_id": faculty_id,
                    "type": "lab",
                    "occurrence": occurrence,
                    "is_combined": True,
                })
                next_session_id += 1

        self.sessions = sessions
        for session in self.sessions:
            session_id = session["session_id"]
            rooms = self._candidate_rooms_for_session(session)
            self.session_room_candidates[session_id] = rooms
            if rooms:
                continue
            course = self.course_map.get(session["course_id"], {})
            needed_capacity = self._student_count_for(session["section_ids"], session["type"])
            conflict_type = "lab_room_shortage" if session["type"] == "lab" else "room_capacity_shortage"
            room_label = "lab room" if session["type"] == "lab" else "teaching room"
            self.impossible_sessions.append(self._build_conflict(
                conflict_type,
                f"No {room_label} can host {course.get('name', 'the course')} for {needed_capacity} students.",
                meta={
                    "course_id": session["course_id"],
                    "course_name": course.get("name"),
                    "section_ids": session["section_ids"],
                    "needed_capacity": needed_capacity,
                },
            ))

    def _create_vars(self) -> None:
        for session in self.sessions:
            session_id = session["session_id"]
            if not self.session_room_candidates.get(session_id):
                continue
            for day, period in self._valid_slots_for(session["type"]):
                self.all_vars[(session_id, day, period)] = self.model.NewBoolVar(f"x_{session_id}_{day}_{period}")

    def _c_completeness(self) -> None:
        for session in self.sessions:
            session_id = session["session_id"]
            vars_for_session = [
                self.all_vars[(session_id, day, period)]
                for day, period in self._valid_slots_for(session["type"])
                if (session_id, day, period) in self.all_vars
            ]
            if vars_for_session:
                self.model.AddExactlyOne(vars_for_session)
                continue

            course = self.course_map.get(session["course_id"], {})
            faculty = self.faculty_map.get(session["faculty_id"], {})
            self.impossible_sessions.append(self._build_conflict(
                "no_valid_slot",
                f"No valid slot remains for {course.get('name', 'the course')} with {faculty.get('name', 'the assigned faculty')}",
                meta={
                    "course_id": session["course_id"],
                    "course_name": course.get("name"),
                    "faculty_id": session["faculty_id"],
                    "faculty_name": faculty.get("name"),
                    "section_ids": session["section_ids"],
                    "slot_type": session["type"],
                    "occurrence": session["occurrence"],
                },
            ))

    def _c_faculty_no_double(self) -> None:
        faculty_sessions: Dict[int, List[Dict[str, Any]]] = {}
        for session in self.sessions:
            faculty_sessions.setdefault(session["faculty_id"], []).append(session)

        for faculty_id, sessions in faculty_sessions.items():
            faculty = self.faculty_map.get(faculty_id, {})
            for day in self.working_days:
                for period in self.periods_per_day.get(day, []):
                    vars_for_period = self._get_occupying_vars(sessions, day, period)
                    if len(vars_for_period) > 1:
                        self.model.Add(sum(vars_for_period) <= 1)

            for slot in faculty.get("unavailable_slots", []):
                day = int(slot["day"])
                period = int(slot["period"])
                for var in self._get_occupying_vars(sessions, day, period):
                    self.model.Add(var == 0)

    def _teaching_blocks_for_day(self, day: int) -> List[List[int]]:
        blocks: List[List[int]] = []
        current: List[int] = []
        for period in self.periods_per_day.get(day, []):
            if self._is_break(day, period):
                if current:
                    blocks.append(current)
                    current = []
                continue
            current.append(period)
        if current:
            blocks.append(current)
        return blocks

    def _c_faculty_consecutive_limit(self) -> None:
        faculty_sessions: Dict[int, List[Dict[str, Any]]] = {}
        for session in self.sessions:
            faculty_sessions.setdefault(session["faculty_id"], []).append(session)

        for faculty_id, sessions in faculty_sessions.items():
            max_consecutive = max(1, int(self.faculty_map.get(faculty_id, {}).get("max_consecutive_periods", 3) or 3))
            for day in self.working_days:
                for block in self._teaching_blocks_for_day(day):
                    if len(block) <= max_consecutive:
                        continue
                    for start in range(0, len(block) - max_consecutive):
                        window = block[start:start + max_consecutive + 1]
                        vars_for_window: List[Any] = []
                        for period in window:
                            vars_for_window.extend(self._get_occupying_vars(sessions, day, period))
                        if vars_for_window:
                            self.model.Add(sum(vars_for_window) <= max_consecutive)

    def _c_section_no_double(self) -> None:
        section_sessions: Dict[int, List[Dict[str, Any]]] = {}
        for session in self.sessions:
            for section_id in session["section_ids"]:
                section_sessions.setdefault(section_id, []).append(session)

        for sessions in section_sessions.values():
            for day in self.working_days:
                for period in self.periods_per_day.get(day, []):
                    vars_for_period = self._get_occupying_vars(sessions, day, period)
                    if len(vars_for_period) > 1:
                        self.model.Add(sum(vars_for_period) <= 1)

    def _c_locked_slots(self) -> None:
        for locked_slot in self.locked_slots:
            section_id = locked_slot.get("section_id")
            target_section_ids = sorted(int(item) for item in (locked_slot.get("section_ids") or ([] if section_id is None else [section_id])))
            course_id = int(locked_slot["course_id"])
            day = int(locked_slot["day"])
            period = int(locked_slot["period"])
            slot_type = locked_slot.get("type", "theory")
            occurrence = int(locked_slot.get("occurrence", 0))
            matched = False

            for session in self.sessions:
                if (
                    sorted(int(item) for item in session["section_ids"]) == target_section_ids
                    and session["course_id"] == course_id
                    and session["type"] == slot_type
                    and session["occurrence"] == occurrence
                ):
                    matched = True
                    session_id = session["session_id"]
                    if (session_id, day, period) in self.all_vars:
                        self.model.Add(self.all_vars[(session_id, day, period)] == 1)
                    else:
                        self.locked_slot_issues.append(self._build_conflict(
                            "locked_slot_conflict",
                            f"Locked slot for course {course_id} cannot stay on day {day}, period {period}.",
                            meta={
                                "section_id": section_id,
                                "section_ids": target_section_ids,
                                "course_id": course_id,
                                "day": day,
                                "period": period,
                                "occurrence": occurrence,
                                "slot_type": slot_type,
                            },
                        ))
                    break

            if not matched:
                self.locked_slot_issues.append(self._build_conflict(
                    "locked_slot_conflict",
                    f"Locked slot target for course {course_id} occurrence {occurrence} does not exist.",
                    meta={
                        "section_id": section_id,
                        "section_ids": target_section_ids,
                        "course_id": course_id,
                        "day": day,
                        "period": period,
                        "occurrence": occurrence,
                        "slot_type": slot_type,
                    },
                ))

    def _c_soft_and_objective(self) -> None:
        penalties: List[Any] = []
        weights: List[int] = []
        morning_cutoff = 2

        for session in self.sessions:
            if session["type"] != "theory":
                continue
            course = self.course_map.get(session["course_id"], {})
            if not course.get("is_core", False):
                continue

            session_id = session["session_id"]
            for day, period in self.valid_theory_slots:
                if period < morning_cutoff:
                    continue
                var = self.all_vars.get((session_id, day, period))
                if var is not None:
                    penalties.append(var)
                    weights.append(1)

        if penalties:
            self.model.Minimize(sum(weight * var for weight, var in zip(weights, penalties)))

    def _occupied_slots_for_entry(self, entry: Dict[str, Any]) -> List[Tuple[int, int]]:
        day = entry["day"]
        period = entry["period"]
        duration = max(int(entry.get("duration", 1) or 1), 1)
        periods = self.periods_per_day.get(day, [])
        if period not in periods:
            return [(day, period)]
        start_index = periods.index(period)
        return [(day, item) for item in periods[start_index:start_index + duration]]

    def _assign_rooms(self, schedule: List[Dict[str, Any]], max_time_seconds: float = 5.0) -> Optional[List[Dict[str, Any]]]:
        self.unassigned_entries = []
        if not schedule:
            return schedule

        room_model = cp_model.CpModel()
        room_vars: Dict[Tuple[int, int], Any] = {}
        room_usage: Dict[Tuple[int, int, int], List[Any]] = {}
        objective_terms: List[Any] = []

        for entry_index, entry in enumerate(schedule):
            candidates = self.session_room_candidates.get(entry["session_id"], [])
            if not candidates:
                self.unassigned_entries = [entry]
                return None

            needs = self._student_count_for(entry.get("section_ids", []), entry["slot_type"])
            occupied = self._occupied_slots_for_entry(entry)
            entry_vars = []
            for room in candidates:
                var = room_model.NewBoolVar(f"room_{entry_index}_{room['id']}")
                room_vars[(entry_index, room["id"])] = var
                entry_vars.append(var)
                objective_terms.append(max(room["capacity"] - needs, 0) * var)
                for day, period in occupied:
                    room_usage.setdefault((room["id"], day, period), []).append(var)
            room_model.AddExactlyOne(entry_vars)

        for vars_for_slot in room_usage.values():
            if len(vars_for_slot) > 1:
                room_model.Add(sum(vars_for_slot) <= 1)

        if objective_terms:
            room_model.Minimize(sum(objective_terms))

        room_solver = cp_model.CpSolver()
        room_solver.parameters.max_time_in_seconds = max(0.1, min(max_time_seconds, 10.0))
        room_solver.parameters.num_search_workers = 4
        status = room_solver.Solve(room_model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            self.unassigned_entries = list(schedule)
            return None

        for entry_index, entry in enumerate(schedule):
            candidates = self.session_room_candidates.get(entry["session_id"], [])
            assigned_room = None
            for room in candidates:
                if room_solver.Value(room_vars[(entry_index, room["id"])]):
                    assigned_room = room
                    break
            if assigned_room is None:
                self.unassigned_entries = [entry]
                return None
            entry["room_id"] = assigned_room["id"]
            entry["room_name"] = assigned_room["name"]

        return schedule

    def _extract(self) -> List[Dict[str, Any]]:
        schedule = []
        for session in self.sessions:
            session_id = session["session_id"]
            for day, period in self._valid_slots_for(session["type"]):
                var = self.all_vars.get((session_id, day, period))
                if var is None:
                    continue
                if self.cp_solver.Value(var) == 1:
                    schedule.append({
                        "session_id": session_id,
                        "section_id": session["section_id"],
                        "section_ids": session["section_ids"],
                        "course_id": session["course_id"],
                        "faculty_id": session["faculty_id"],
                        "day": day,
                        "period": period,
                        "duration": 2 if session["type"] == "lab" else 1,
                        "slot_type": session["type"],
                        "occurrence": session["occurrence"],
                        "is_combined": session.get("is_combined", False),
                        "is_modified": False,
                    })
                    break
        return schedule

    def _analyze_conflicts(self) -> List[Dict[str, Any]]:
        conflicts: List[Dict[str, Any]] = []
        conflicts.extend(self.impossible_sessions)
        conflicts.extend(self.locked_slot_issues)

        section_demand: Dict[int, int] = {}
        for assignment in self.section_courses:
            section_id = assignment["section_id"]
            course = self.course_map.get(assignment["course_id"], {})
            section_demand[section_id] = section_demand.get(section_id, 0) + course.get("theory_hours", 0) + course.get("practical_hours", 0)
        for group in self.combined_groups:
            course = self.course_map.get(group["course_id"], {})
            for section_id in group["section_ids"]:
                section_demand[section_id] = section_demand.get(section_id, 0) + course.get("theory_hours", 0) + course.get("practical_hours", 0)

        available_section_slots = len(self.valid_theory_slots)
        for section_id, demand in section_demand.items():
            if demand <= available_section_slots:
                continue
            section = self.section_map.get(section_id, {})
            conflicts.append({
                "type": "section_overload",
                "severity": "hard",
                "description": f"Section '{section.get('name', section_id)}' requires {demand} periods but only {available_section_slots} slots are available per week.",
                "meta": {
                    "section_id": section_id,
                    "section_name": section.get("name", section_id),
                    "required_periods": demand,
                    "available_periods": available_section_slots,
                },
            })

        faculty_demand: Dict[int, int] = {}
        for assignment in self.section_courses:
            faculty_id = assignment["faculty_id"]
            course = self.course_map.get(assignment["course_id"], {})
            faculty_demand[faculty_id] = faculty_demand.get(faculty_id, 0) + course.get("theory_hours", 0) + course.get("practical_hours", 0)
        for group in self.combined_groups:
            faculty_id = group["faculty_id"]
            course = self.course_map.get(group["course_id"], {})
            faculty_demand[faculty_id] = faculty_demand.get(faculty_id, 0) + course.get("theory_hours", 0) + course.get("practical_hours", 0)

        for faculty_id, demand in faculty_demand.items():
            faculty = self.faculty_map.get(faculty_id, {})
            unavailable = len(faculty.get("unavailable_slots", []))
            available = len(self.valid_theory_slots) - unavailable
            if demand <= available:
                continue
            conflicts.append({
                "type": "faculty_overload",
                "severity": "hard",
                "description": f"Faculty '{faculty.get('name', faculty_id)}' has {demand} hours to teach but only {available} available slots.",
                "meta": {
                    "faculty_id": faculty_id,
                    "faculty_name": faculty.get("name", faculty_id),
                    "required_periods": demand,
                    "available_periods": available,
                },
            })

        if not conflicts:
            conflicts.append(self._build_conflict(
                "unknown",
                "No valid timetable was found within the time limit. Try reducing faculty blocks, adding rooms, or increasing available periods.",
            ))
        return conflicts

    def _room_conflicts(self) -> List[Dict[str, Any]]:
        conflicts = []
        for entry in self.unassigned_entries:
            course = self.course_map.get(entry["course_id"], {})
            conflict_type = "lab_room_shortage" if entry["slot_type"] == "lab" else "room_capacity_shortage"
            conflicts.append(self._build_conflict(
                conflict_type,
                f"No room was available for {course.get('name', 'the course')} on day {entry['day']}, period {entry['period']}.",
                meta={
                    "course_id": entry["course_id"],
                    "course_name": course.get("name"),
                    "day": entry["day"],
                    "period": entry["period"],
                    "needed_capacity": self._student_count_for(entry.get("section_ids", []), entry["slot_type"]),
                },
            ))
        return conflicts

    def _block_current_schedule(self, schedule: List[Dict[str, Any]]) -> None:
        chosen_vars = [
            self.all_vars[(entry["session_id"], entry["day"], entry["period"])]
            for entry in schedule
            if (entry["session_id"], entry["day"], entry["period"]) in self.all_vars
        ]
        if chosen_vars:
            self.model.Add(sum(chosen_vars) <= len(chosen_vars) - 1)

    def solve(self) -> Dict[str, Any]:
        logger.info("Building sessions")
        self._build_sessions()

        if not self.sessions:
            return {
                "status": "error",
                "message": "No sessions to schedule. Add courses and section assignments first.",
                "schedule": [],
                "conflicts": [],
            }

        if self.impossible_sessions:
            conflicts = self._analyze_conflicts()
            return {
                "status": "infeasible",
                "schedule": [],
                "conflicts": conflicts,
                "diagnostics": conflicts,
                "warnings": [],
                "unassigned_slots": [],
                "num_sessions": len(self.sessions),
            }

        self._create_vars()
        self._c_completeness()
        self._c_faculty_no_double()
        self._c_faculty_consecutive_limit()
        self._c_section_no_double()
        self._c_locked_slots()
        self._c_soft_and_objective()

        solve_started_at = time.time()
        last_room_conflicts: List[Dict[str, Any]] = []

        while True:
            remaining = self.max_solve_seconds - (time.time() - solve_started_at)
            if remaining <= 0:
                break

            self.cp_solver.parameters.max_time_in_seconds = max(0.1, remaining)
            self.cp_solver.parameters.num_search_workers = 4
            status_code = self.cp_solver.Solve(self.model)
            logger.info("Solver status: %s", self.cp_solver.StatusName(status_code))

            if status_code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                conflicts = last_room_conflicts or self._analyze_conflicts()
                return {
                    "status": "infeasible",
                    "schedule": [],
                    "conflicts": conflicts,
                    "diagnostics": conflicts,
                    "warnings": [],
                    "unassigned_slots": self.unassigned_entries,
                    "num_sessions": len(self.sessions),
                }

            schedule = self._extract()
            room_schedule = self._assign_rooms(schedule, max_time_seconds=min(remaining, 5.0))
            if room_schedule is not None:
                return {
                    "status": "optimal" if status_code == cp_model.OPTIMAL else "feasible",
                    "schedule": room_schedule,
                    "conflicts": [],
                    "diagnostics": [],
                    "warnings": [],
                    "unassigned_slots": [],
                    "objective": self.cp_solver.ObjectiveValue() if self.model.HasObjective() else 0,
                    "num_sessions": len(self.sessions),
                }

            last_room_conflicts = self._room_conflicts()
            self._block_current_schedule(schedule)

        conflicts = last_room_conflicts or self._analyze_conflicts()
        warnings = ["No room-feasible timetable was found within the solve time limit."] if last_room_conflicts else []
        return {
            "status": "infeasible",
            "schedule": [],
            "conflicts": conflicts,
            "diagnostics": conflicts,
            "warnings": warnings,
            "unassigned_slots": self.unassigned_entries,
            "num_sessions": len(self.sessions),
        }
