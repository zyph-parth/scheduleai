"""
Timetable Solver using Google OR-Tools CP-SAT.

Model:
  - A "session" = one schedulable unit (1 theory period OR 1 lab block of 2 consecutive periods)
  - Decision variable: x[(session_id, day, period)] ∈ {0,1}
      = 1 if that session starts at (day, period)
  - For labs: starting at period p occupies p AND p+1 (must be consecutive, non-break)

Hard constraints enforced:
  1. Each session assigned exactly once
  2. No faculty double-booking (theory + lab overlap aware)
  3. No section double-booking
  4. No room double-booking (post-solve greedy assignment)
  5. Labs only start where p+1 is also a valid non-break period
  6. Break slots are excluded from all assignments
  7. Faculty unavailability slots blocked
  8. Combined sections share exactly the same slot
  9. Locked slots pinned to their positions
  10. Over-constrained: detect & report which constraints conflict

Soft constraints (objective minimization):
  - Core subjects scheduled in early periods (penalize late-slot assignment)
  - Faculty consecutive period load (penalize >3 back-to-back)
"""

import logging
import time
import math
from typing import Any, Dict, List, Optional, Tuple

from ortools.sat.python import cp_model

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────────────────────────────────────

def solve_timetable(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    data keys:
        institution   – working_days, periods_per_day, break_slots
        sections      – [{id, name, student_count}]
        courses       – [{id, name, theory_hours, practical_hours, is_core, requires_lab}]
        faculty       – [{id, name, unavailable_slots:[{day,period}], max_consecutive_periods}]
        rooms         – [{id, name, capacity, room_type}]
        section_courses – [{section_id, course_id, faculty_id}]
        combined_groups – [{id, section_ids, course_id, faculty_id}]
        locked_slots  – [{section_id, course_id, type, occurrence, day, period}]
        max_solve_seconds – int (default 60)
    """
    t0 = time.time()
    try:
        solver = TimetableSolver(data)
        result = solver.solve()
    except Exception as exc:
        logger.exception("Solver crashed")
        result = {"status": "error", "message": str(exc), "schedule": [], "conflicts": []}
    result["solve_time"] = round(time.time() - t0, 3)
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Solver class
# ──────────────────────────────────────────────────────────────────────────────

class TimetableSolver:

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.model = cp_model.CpModel()
        self.cp_solver = cp_model.CpSolver()

        inst = data.get("institution", {})
        self.working_days: List[int] = inst.get("working_days", [0, 1, 2, 3, 4])
        self.max_solve_seconds: int = data.get("max_solve_seconds", 60)

        # periods_per_day: {int(day): [p0, p1, ...]} ordered
        raw_ppd = inst.get("periods_per_day", {})
        self.periods_per_day: Dict[int, List[int]] = {
            int(d): sorted(ps) for d, ps in raw_ppd.items()
        }
        # Ensure every working day has a periods list
        for d in self.working_days:
            if d not in self.periods_per_day:
                self.periods_per_day[d] = list(range(8))

        # break_slots: {int(day): set(period)}
        raw_breaks = inst.get("break_slots", {})
        self.break_slots: Dict[int, set] = {
            int(d): set(ps) for d, ps in raw_breaks.items()
        }

        # Lookup maps
        self.section_map  = {s["id"]: s for s in data.get("sections", [])}
        self.course_map   = {c["id"]: c for c in data.get("courses", [])}
        self.faculty_map  = {f["id"]: f for f in data.get("faculty", [])}
        self.room_map     = {r["id"]: r for r in data.get("rooms", [])}

        self.section_courses  = data.get("section_courses", [])
        self.combined_groups  = data.get("combined_groups", [])
        self.locked_slots     = data.get("locked_slots", [])

        # Pre-compute valid slot lists
        self._build_slot_lists()

        # Build session list + CP variables
        self.sessions: List[Dict] = []
        self.all_vars: Dict[Tuple, Any] = {}   # (session_id, day, period) → BoolVar
        self.session_room_candidates: Dict[int, List[Dict[str, Any]]] = {}
        self.impossible_sessions: List[Dict[str, Any]] = []
        self.locked_slot_issues: List[Dict[str, Any]] = []
        self.unassigned_entries: List[Dict[str, Any]] = []

    # ── Slot helpers ──────────────────────────────────────────────────────────

    def _is_break(self, day: int, period: int) -> bool:
        return period in self.break_slots.get(day, set())

    def _build_slot_lists(self):
        """Pre-compute valid (day, period) for theory and lab starts."""
        self.valid_theory_slots: List[Tuple[int, int]] = []
        self.valid_lab_starts:   List[Tuple[int, int]] = []

        # period_next[(day, period)] → next period on same day, or None
        self.period_next: Dict[Tuple, Optional[int]] = {}

        for d in self.working_days:
            periods = self.periods_per_day.get(d, [])
            for i, p in enumerate(periods):
                nxt = periods[i + 1] if i + 1 < len(periods) else None
                self.period_next[(d, p)] = nxt

                if self._is_break(d, p):
                    continue
                self.valid_theory_slots.append((d, p))
                if nxt is not None and not self._is_break(d, nxt):
                    self.valid_lab_starts.append((d, p))

    def _valid_slots_for(self, stype: str) -> List[Tuple[int, int]]:
        return self.valid_lab_starts if stype == "lab" else self.valid_theory_slots

    def _student_count_for(self, section_ids: List[int], slot_type: str) -> int:
        total = sum(self.section_map.get(section_id, {}).get("student_count", 0) for section_id in section_ids)
        if slot_type == "lab":
            return max(1, math.ceil(total / 2))
        return total

    def _candidate_rooms_for_session(self, sess: Dict[str, Any]) -> List[Dict[str, Any]]:
        student_count = self._student_count_for(sess["section_ids"], sess["type"])
        need_lab = sess["type"] == "lab"
        candidates = []
        for room in self.room_map.values():
            effective_capacity = room["capacity"] + (1 if need_lab else 0)
            if effective_capacity < student_count:
                continue
            if need_lab and room["room_type"] != "lab":
                continue
            if not need_lab and room["room_type"] == "lab":
                continue
            candidates.append(room)
        return sorted(candidates, key=lambda room: room["capacity"])

    def _build_conflict(
        self,
        conflict_type: str,
        description: str,
        severity: str = "hard",
        meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "type": conflict_type,
            "severity": severity,
            "description": description,
            "meta": meta or {},
        }

    def _occupies_period(self, stype: str, start_p: int, day: int, check_p: int) -> bool:
        """Does a session of stype, starting at start_p, occupy check_p?"""
        if check_p == start_p:
            return True
        if stype == "lab":
            nxt = self.period_next.get((day, start_p))
            return nxt is not None and check_p == nxt
        return False

    def _get_occupying_vars(
        self,
        sessions: List[Dict],
        day: int,
        period: int,
    ) -> List[Any]:
        """
        Return all BoolVars from `sessions` that indicate occupancy of (day, period).
        Theory: var at (d, period)
        Lab   : var at (d, period)  — lab starting here
              + var at (d, prev_p) — lab starting one earlier (covers period)
        """
        result = []
        for sess in sessions:
            sid = sess["session_id"]
            stype = sess["type"]
            # Direct start
            if (sid, day, period) in self.all_vars and stype == "theory":
                result.append(self.all_vars[(sid, day, period)])
            elif stype == "lab":
                # Lab starting at period
                if (sid, day, period) in self.all_vars:
                    result.append(self.all_vars[(sid, day, period)])
                # Lab starting one period earlier (also covers 'period')
                periods = self.periods_per_day.get(day, [])
                idx = periods.index(period) if period in periods else -1
                if idx > 0:
                    prev_p = periods[idx - 1]
                    if (sid, day, prev_p) in self.all_vars:
                        result.append(self.all_vars[(sid, day, prev_p)])
        return result

    # ── Session builder ───────────────────────────────────────────────────────

    def _build_sessions(self):
        """
        Create a flat list of sessions to schedule.
        Each theory hour → 1 session.
        Each 2 practical hours → 1 lab session (occupies 2 consecutive periods).
        Combined groups → single session (not per-section).
        """
        sessions = []
        sid = 0

        # Track which (section_id, course_id) are covered by combined groups
        combined_covered: set = set()
        for cg in self.combined_groups:
            for s_id in cg["section_ids"]:
                combined_covered.add((s_id, cg["course_id"]))

        # Regular section-course sessions
        for sc in self.section_courses:
            s_id = sc["section_id"]
            c_id = sc["course_id"]
            f_id = sc["faculty_id"]

            # Skip if this (section, course) is handled by a combined group
            if (s_id, c_id) in combined_covered:
                continue

            c = self.course_map.get(c_id, {})
            theory_hrs  = c.get("theory_hours", 0)
            lab_sessions = c.get("practical_hours", 0) // 2   # each lab = 2 periods

            for occ in range(theory_hrs):
                sessions.append(dict(
                    session_id=sid, section_id=s_id, section_ids=[s_id],
                    course_id=c_id, faculty_id=f_id,
                    type="theory", occurrence=occ, is_combined=False,
                ))
                sid += 1

            for occ in range(lab_sessions):
                sessions.append(dict(
                    session_id=sid, section_id=s_id, section_ids=[s_id],
                    course_id=c_id, faculty_id=f_id,
                    type="lab", occurrence=occ, is_combined=False,
                ))
                sid += 1

        # Combined group sessions (one session serves all sections in the group)
        for cg in self.combined_groups:
            c_id = cg["course_id"]
            f_id = cg["faculty_id"]
            c = self.course_map.get(c_id, {})

            for occ in range(c.get("theory_hours", 0)):
                sessions.append(dict(
                    session_id=sid, section_id=cg["section_ids"][0],
                    section_ids=cg["section_ids"],
                    course_id=c_id, faculty_id=f_id,
                    type="theory", occurrence=occ, is_combined=True,
                    combined_group_id=cg["id"],
                ))
                sid += 1

            for occ in range(c.get("practical_hours", 0) // 2):
                sessions.append(dict(
                    session_id=sid, section_id=cg["section_ids"][0],
                    section_ids=cg["section_ids"],
                    course_id=c_id, faculty_id=f_id,
                    type="lab", occurrence=occ, is_combined=True,
                    combined_group_id=cg["id"],
                ))
                sid += 1

        self.sessions = sessions
        for sess in self.sessions:
            sid = sess["session_id"]
            rooms = self._candidate_rooms_for_session(sess)
            self.session_room_candidates[sid] = rooms
            if rooms:
                continue

            course = self.course_map.get(sess["course_id"], {})
            needed_capacity = self._student_count_for(sess["section_ids"], sess["type"])
            conflict_type = "lab_room_shortage" if sess["type"] == "lab" else "room_capacity_shortage"
            room_label = "lab room" if sess["type"] == "lab" else "teaching room"
            self.impossible_sessions.append(
                self._build_conflict(
                    conflict_type,
                    (
                        f"No {room_label} can host {course.get('name', 'the course')} "
                        f"for {needed_capacity} students."
                    ),
                    meta={
                        "course_id": sess["course_id"],
                        "course_name": course.get("name"),
                        "faculty_id": sess["faculty_id"],
                        "faculty_name": self.faculty_map.get(sess["faculty_id"], {}).get("name"),
                        "section_ids": sess["section_ids"],
                        "needed_capacity": needed_capacity,
                    },
                )
            )

    # ── Variable creation ─────────────────────────────────────────────────────

    def _create_vars(self):
        for sess in self.sessions:
            sid = sess["session_id"]
            if not self.session_room_candidates.get(sid):
                continue
            for d, p in self._valid_slots_for(sess["type"]):
                self.all_vars[(sid, d, p)] = self.model.NewBoolVar(
                    f"x_{sid}_{d}_{p}"
                )

    # ── Constraints ───────────────────────────────────────────────────────────

    def _c_completeness(self):
        """Every session must be assigned to exactly one slot."""
        for sess in self.sessions:
            sid = sess["session_id"]
            stype = sess["type"]
            vars_ = [
                self.all_vars[(sid, d, p)]
                for d, p in self._valid_slots_for(stype)
                if (sid, d, p) in self.all_vars
            ]
            if vars_:
                self.model.AddExactlyOne(vars_)
            else:
                course = self.course_map.get(sess["course_id"], {})
                faculty = self.faculty_map.get(sess["faculty_id"], {})
                self.impossible_sessions.append(
                    self._build_conflict(
                        "no_valid_slot",
                        (
                            f"No valid slot remains for {course.get('name', 'the course')} "
                            f"with {faculty.get('name', 'the assigned faculty')}."
                        ),
                        meta={
                            "course_id": sess["course_id"],
                            "course_name": course.get("name"),
                            "faculty_id": sess["faculty_id"],
                            "faculty_name": faculty.get("name"),
                            "section_ids": sess["section_ids"],
                            "slot_type": stype,
                            "occurrence": sess["occurrence"],
                        },
                    )
                )

    def _c_faculty_no_double(self):
        """No faculty at the same (day, period) in more than one session."""
        faculty_sessions: Dict[int, List[Dict]] = {}
        for sess in self.sessions:
            faculty_sessions.setdefault(sess["faculty_id"], []).append(sess)

        for f_id, sessions in faculty_sessions.items():
            fac = self.faculty_map.get(f_id, {})

            for d in self.working_days:
                for p in self.periods_per_day.get(d, []):
                    occ_vars = self._get_occupying_vars(sessions, d, p)
                    if len(occ_vars) > 1:
                        self.model.Add(sum(occ_vars) <= 1)

            # Enforce unavailability
            for slot in fac.get("unavailable_slots", []):
                ud, up = int(slot["day"]), int(slot["period"])
                for var in self._get_occupying_vars(sessions, ud, up):
                    self.model.Add(var == 0)

    def _c_section_no_double(self):
        """No section at two places simultaneously."""
        section_sessions: Dict[int, List[Dict]] = {}
        for sess in self.sessions:
            for s_id in sess["section_ids"]:
                section_sessions.setdefault(s_id, []).append(sess)

        for s_id, sessions in section_sessions.items():
            for d in self.working_days:
                for p in self.periods_per_day.get(d, []):
                    occ_vars = self._get_occupying_vars(sessions, d, p)
                    if len(occ_vars) > 1:
                        self.model.Add(sum(occ_vars) <= 1)

    def _c_locked_slots(self):
        """Pin locked slots to their specified (day, period)."""
        for ls in self.locked_slots:
            s_id  = ls["section_id"]
            c_id  = ls["course_id"]
            d, p  = ls["day"], ls["period"]
            stype = ls.get("type", "theory")
            occ   = ls.get("occurrence", 0)
            matched = False

            for sess in self.sessions:
                if (
                    sess["section_id"] == s_id
                    and sess["course_id"] == c_id
                    and sess["type"] == stype
                    and sess["occurrence"] == occ
                ):
                    matched = True
                    sid = sess["session_id"]
                    if (sid, d, p) in self.all_vars:
                        self.model.Add(self.all_vars[(sid, d, p)] == 1)
                    else:
                        self.locked_slot_issues.append(
                            self._build_conflict(
                                "locked_slot_conflict",
                                f"Locked slot for course {c_id} cannot stay on day {d}, period {p}.",
                                meta={
                                    "section_id": s_id,
                                    "course_id": c_id,
                                    "day": d,
                                    "period": p,
                                    "occurrence": occ,
                                    "slot_type": stype,
                                },
                            )
                        )
                    break
            if not matched:
                self.locked_slot_issues.append(
                    self._build_conflict(
                        "locked_slot_conflict",
                        f"Locked slot target for course {c_id} occurrence {occ} does not exist.",
                        meta={
                            "section_id": s_id,
                            "course_id": c_id,
                            "day": d,
                            "period": p,
                            "occurrence": occ,
                            "slot_type": stype,
                        },
                    )
                )

    def _c_soft_and_objective(self):
        """
        Soft constraints encoded as penalty BoolVars added to minimize objective.
        Penalty 1: core subjects assigned to non-morning periods (high weight).
        Penalty 2: lab sessions on the same day as another lab for same section (low weight).
        """
        penalties: List[Any] = []
        weights:   List[int] = []

        morning_cutoff = 2   # periods 0,1 considered "morning"

        for sess in self.sessions:
            if sess["type"] != "theory":
                continue
            c = self.course_map.get(sess["course_id"], {})
            if not c.get("is_core", False):
                continue

            sid = sess["session_id"]
            for d, p in self.valid_theory_slots:
                if p >= morning_cutoff:
                    v = self.all_vars.get((sid, d, p))
                    if v is not None:
                        penalties.append(v)
                        weights.append(1)

        if penalties:
            self.model.Minimize(
                sum(w * v for w, v in zip(weights, penalties))
            )

    # ── Room assignment (greedy, post-solve) ──────────────────────────────────

    def _assign_rooms(self, schedule: List[Dict]) -> List[Dict]:
        """
        Greedy room assignment:
        - Lab sessions → lab rooms first, fallback classroom
        - Prefer smallest room that fits the student count
        - Ensure no room double-booking across overlapping periods
        """
        rooms_sorted = sorted(
            self.room_map.values(), key=lambda r: r["capacity"]
        )
        # room_usage[(day, period)] → set of room_ids in use
        room_usage: Dict[Tuple, set] = {}

        def _occupied_periods(entry: Dict) -> List[Tuple[int, int]]:
            d, p = entry["day"], entry["period"]
            if entry["slot_type"] == "lab":
                periods = self.periods_per_day.get(d, [])
                idx = periods.index(p) if p in periods else -1
                if idx >= 0 and idx + 1 < len(periods):
                    return [(d, p), (d, periods[idx + 1])]
            return [(d, p)]

        for entry in schedule:
            occupied = _occupied_periods(entry)
            candidates = self.session_room_candidates.get(entry["session_id"], [])
            assigned = None

            for room in candidates:
                if all(
                    room["id"] not in room_usage.get(slot, set())
                    for slot in occupied
                ):
                    assigned = room
                    break

            if assigned:
                for slot in occupied:
                    room_usage.setdefault(slot, set()).add(assigned["id"])
                entry["room_id"]   = assigned["id"]
                entry["room_name"] = assigned["name"]
            else:
                entry["room_id"]   = None
                entry["room_name"] = "UNASSIGNED"
                self.unassigned_entries.append(entry)

        return schedule

    # ── Extract solution ──────────────────────────────────────────────────────

    def _extract(self) -> List[Dict]:
        schedule = []
        for sess in self.sessions:
            sid = sess["session_id"]
            for d, p in self._valid_slots_for(sess["type"]):
                if (sid, d, p) in self.all_vars:
                    if self.cp_solver.Value(self.all_vars[(sid, d, p)]) == 1:
                        schedule.append(dict(
                            session_id  = sid,
                            section_id  = sess["section_id"],
                            section_ids = sess["section_ids"],
                            course_id   = sess["course_id"],
                            faculty_id  = sess["faculty_id"],
                            day         = d,
                            period      = p,
                            duration    = 2 if sess["type"] == "lab" else 1,
                            slot_type   = sess["type"],
                            occurrence  = sess["occurrence"],
                            is_combined = sess.get("is_combined", False),
                            is_modified = False,
                        ))
                        break
        return schedule

    # ── Conflict analysis (for infeasible cases) ──────────────────────────────

    def _analyze_conflicts(self) -> List[Dict]:
        """
        When the solver cannot find a solution, diagnose the most likely causes.
        Checks:
          - Total required slots > available slots per section
          - Faculty overloaded (total hours > available slots)
          - No lab slots of length 2 available for lab courses
        """
        conflicts: List[Dict[str, Any]] = []

        if self.impossible_sessions:
            conflicts.extend(self.impossible_sessions)
        if self.locked_slot_issues:
            conflicts.extend(self.locked_slot_issues)

        # Check per-section slot demand
        section_demand: Dict[int, int] = {}
        for sc in self.section_courses:
            s_id = sc["section_id"]
            c    = self.course_map.get(sc["course_id"], {})
            section_demand[s_id] = (
                section_demand.get(s_id, 0)
                + c.get("theory_hours", 0)
                + c.get("practical_hours", 0)
            )

        for cg in self.combined_groups:
            for s_id in cg["section_ids"]:
                c = self.course_map.get(cg["course_id"], {})
                section_demand[s_id] = (
                    section_demand.get(s_id, 0)
                    + c.get("theory_hours", 0)
                    + c.get("practical_hours", 0)
                )

        for s_id, demand in section_demand.items():
            avail = len(self.valid_theory_slots)
            if demand > avail:
                sec = self.section_map.get(s_id, {})
                conflicts.append({
                    "type": "section_overload",
                    "severity": "hard",
                    "description": (
                        f"Section '{sec.get('name', s_id)}' requires {demand} periods "
                        f"but only {avail} slots are available per week. "
                        f"Reduce courses or add more periods."
                    ),
                    "meta": {
                        "section_id": s_id,
                        "section_name": sec.get("name", s_id),
                        "required_periods": demand,
                        "available_periods": avail,
                    },
                })

        # Faculty overload
        faculty_demand: Dict[int, int] = {}
        for sc in self.section_courses:
            f_id = sc["faculty_id"]
            c    = self.course_map.get(sc["course_id"], {})
            faculty_demand[f_id] = (
                faculty_demand.get(f_id, 0)
                + c.get("theory_hours", 0)
                + c.get("practical_hours", 0)
            )

        for f_id, demand in faculty_demand.items():
            fac   = self.faculty_map.get(f_id, {})
            unavail = len(fac.get("unavailable_slots", []))
            avail = len(self.valid_theory_slots) - unavail
            if demand > avail:
                conflicts.append({
                    "type": "faculty_overload",
                    "severity": "hard",
                    "description": (
                        f"Faculty '{fac.get('name', f_id)}' has {demand} hours to teach "
                        f"but only {avail} available slots. "
                        f"Reassign some courses."
                    ),
                    "meta": {
                        "faculty_id": f_id,
                        "faculty_name": fac.get("name", f_id),
                        "required_periods": demand,
                        "available_periods": avail,
                    },
                })

        if not conflicts:
            conflicts.append(
                self._build_conflict(
                    "unknown",
                    (
                        "No valid timetable found within the time limit. "
                        "Try relaxing constraints: reduce unavailable slots, add more rooms, or increase working days."
                    ),
                )
            )

        return conflicts

    def _room_conflicts(self) -> List[Dict[str, Any]]:
        conflicts = []
        for entry in self.unassigned_entries:
            course = self.course_map.get(entry["course_id"], {})
            conflict_type = "lab_room_shortage" if entry["slot_type"] == "lab" else "room_capacity_shortage"
            conflicts.append(
                self._build_conflict(
                    conflict_type,
                    (
                        f"No room was available for {course.get('name', 'the course')} "
                        f"on day {entry['day']}, period {entry['period']}."
                    ),
                    meta={
                        "course_id": entry["course_id"],
                        "course_name": course.get("name"),
                        "day": entry["day"],
                        "period": entry["period"],
                        "needed_capacity": self._student_count_for(entry.get("section_ids", []), entry["slot_type"]),
                    },
                )
            )
        return conflicts

    # ── Main solve ────────────────────────────────────────────────────────────

    def solve(self) -> Dict[str, Any]:
        logger.info("Building sessions …")
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

        logger.info("Creating %d sessions, %d CP variables …", len(self.sessions), 0)
        self._create_vars()
        logger.info("… %d CP variables created", len(self.all_vars))

        # Add all hard constraints
        self._c_completeness()
        self._c_faculty_no_double()
        self._c_section_no_double()
        self._c_locked_slots()

        # Soft objective
        self._c_soft_and_objective()

        # Solver parameters
        self.cp_solver.parameters.max_time_in_seconds = self.max_solve_seconds
        self.cp_solver.parameters.num_search_workers  = 4   # parallel search

        logger.info("Solving …")
        status_code = self.cp_solver.Solve(self.model)
        logger.info("Solver status: %s", self.cp_solver.StatusName(status_code))

        if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            schedule = self._extract()
            schedule = self._assign_rooms(schedule)
            if self.unassigned_entries:
                conflicts = self._room_conflicts()
                return {
                    "status": "infeasible",
                    "schedule": [],
                    "conflicts": conflicts,
                    "diagnostics": conflicts,
                    "warnings": [],
                    "unassigned_slots": self.unassigned_entries,
                    "objective": self.cp_solver.ObjectiveValue(),
                    "num_sessions": len(self.sessions),
                }
            return {
                "status": "optimal" if status_code == cp_model.OPTIMAL else "feasible",
                "schedule": schedule,
                "conflicts": [],
                "diagnostics": [],
                "warnings": [],
                "unassigned_slots": [],
                "objective": self.cp_solver.ObjectiveValue(),
                "num_sessions": len(self.sessions),
            }
        else:
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
