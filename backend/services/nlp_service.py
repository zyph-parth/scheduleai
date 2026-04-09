"""
NLP Constraint Parser.

The local parser is intentionally lightweight, but it now accepts institution
context so custom faculty names, course names, and timing configurations work
without relying on seed-data assumptions.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DAY_MAP = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

PERIOD_HOUR_MAP = {
    "8": 0, "8am": 0, "08:00": 0,
    "9": 0, "9am": 0, "09:00": 0,
    "10": 1, "10am": 1, "10:00": 1,
    "11": 2, "11am": 2, "11:00": 2,
    "12": 3, "12pm": 3, "12:00": 3,
    "1": 4, "1pm": 4, "13:00": 4,
    "2": 5, "2pm": 5, "14:00": 5,
    "3": 6, "3pm": 6, "15:00": 6,
    "4": 7, "4pm": 7, "16:00": 7,
}


def _parse_clock_time(value: str) -> Optional[int]:
    text = value.lower().strip().replace(" ", "")
    if not text:
        return None

    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?(am|pm)?", text)
    if not match:
        return None

    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = match.group(3)

    if meridiem == "pm" and hour != 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    return hour * 60 + minute


def _match_known_name(text_lower: str, names: List[str]) -> Optional[str]:
    for name in names:
        normalized = (name or "").strip().lower()
        if normalized and normalized in text_lower:
            return name

    for name in names:
        parts = [part for part in (name or "").strip().split() if part]
        if not parts:
            continue
        tail = parts[-1].lower()
        if len(tail) >= 3 and re.search(rf"\b{re.escape(tail)}\b", text_lower):
            return name
    return None


def _time_to_period(time_str: str, institution_context: Optional[Dict[str, Any]] = None) -> int:
    token = time_str.lower().strip().replace(" ", "")
    if token in PERIOD_HOUR_MAP:
        return PERIOD_HOUR_MAP[token]

    context = institution_context or {}
    parsed_time = _parse_clock_time(token)
    if parsed_time is None:
        return -1

    start_time = context.get("start_time")
    duration = int(context.get("period_duration_minutes") or 0)
    if not start_time or duration <= 0:
        return -1

    start_minutes = _parse_clock_time(start_time)
    if start_minutes is None or parsed_time < start_minutes:
        return -1

    raw_index = max((parsed_time - start_minutes) // duration, 0)
    periods_per_day = context.get("periods_per_day") or {}
    all_periods = sorted({
        int(period)
        for periods in periods_per_day.values()
        for period in (periods or [])
    })
    if not all_periods:
        return raw_index

    for period in all_periods:
        if period >= raw_index:
            return period
    return all_periods[-1]


def parse_constraint_local(text: str, institution_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Lightweight regex-based parser as fallback when Claude API is unavailable.
    """
    text_lower = text.lower()
    context = institution_context or {}
    known_faculty = context.get("faculty_names") or []
    known_courses = context.get("course_names") or []
    result: Dict[str, Any] = {"raw": text, "confidence": 0.6}

    day_found = None
    for day_word, day_idx in DAY_MAP.items():
        if re.search(rf"\b{re.escape(day_word)}\b", text_lower):
            day_found = day_idx
            break

    faculty_re = re.search(r"(?:dr\.?|prof\.?|mr\.?|ms\.?)\s+([\w\s]+?)(?:\b(?:cannot|not|unavailable|busy|must|should)\b|$)", text, re.I)
    faculty_name = _match_known_name(text_lower, known_faculty)
    if not faculty_name and faculty_re:
        faculty_name = faculty_re.group(0).strip()

    course_re = re.search(r"(?:subject|course)?\s*['\"]?([\w\s]+?)(?:['\"])?\s+(?:must|should)", text, re.I)
    course_name = _match_known_name(text_lower, known_courses)
    if not course_name and course_re:
        course_name = course_re.group(1).strip()

    time_re = re.search(r"(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)", text_lower)
    period_found = _time_to_period(time_re.group(1), context) if time_re else -1

    if any(word in text_lower for word in ["cannot teach", "not available", "unavailable", "busy"]):
        before_period = period_found if "before" in text_lower and period_found >= 0 else None
        after_period = period_found if "after" in text_lower and period_found >= 0 else None
        exact_period = period_found if before_period is None and after_period is None and period_found >= 0 else None
        result.update({
            "type": "unavailability",
            "faculty_name": faculty_name,
            "course_name": None,
            "day": day_found,
            "period": exact_period,
            "before_period": before_period,
            "after_period": after_period,
            "max_periods": None,
            "preferred_periods": None,
            "excluded_days": None,
            "description": f"Mark {faculty_name or 'faculty'} unavailable",
        })
        return result

    if any(word in text_lower for word in ["morning", "early", "first period", "priority"]):
        result.update({
            "type": "core_priority",
            "faculty_name": None,
            "course_name": course_name,
            "day": None,
            "period": None,
            "before_period": None,
            "after_period": None,
            "max_periods": None,
            "preferred_periods": [0, 1, 2],
            "excluded_days": None,
            "description": "Schedule course in morning slots (periods 0-2)",
        })
        return result

    if any(word in text_lower for word in ["avoid friday", "not on friday", "not be on fridays"]):
        result.update({
            "type": "day_restriction",
            "faculty_name": None,
            "course_name": course_name,
            "day": None,
            "period": None,
            "before_period": None,
            "after_period": None,
            "max_periods": None,
            "preferred_periods": None,
            "excluded_days": [4],
            "description": "Avoid scheduling on Friday",
        })
        return result

    consec_re = re.search(r"(\d+)\s+consecutive", text_lower)
    if consec_re:
        max_periods = int(consec_re.group(1))
        result.update({
            "type": "max_consecutive",
            "faculty_name": faculty_name,
            "course_name": None,
            "day": None,
            "period": None,
            "before_period": None,
            "after_period": None,
            "max_periods": max_periods,
            "preferred_periods": None,
            "excluded_days": None,
            "description": f"Limit consecutive teaching to {max_periods} periods",
        })
        return result

    result.update({
        "type": "custom",
        "faculty_name": faculty_name,
        "course_name": course_name,
        "day": day_found,
        "period": period_found if period_found >= 0 else None,
        "before_period": None,
        "after_period": None,
        "max_periods": None,
        "preferred_periods": None,
        "excluded_days": None,
        "description": f"Constraint noted: {text}",
        "confidence": 0.3,
    })
    return result


async def parse_constraint_claude(text: str, api_key: str) -> Dict[str, Any]:
    """
    Use Claude API to parse natural language into structured constraint JSON.
    """
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

        system_prompt = """You are a timetable constraint parser for a college scheduling system.
Convert natural language scheduling constraints into structured JSON.

The JSON must have these fields:
  type: one of [unavailability, max_consecutive, core_priority, day_restriction, workload_balance, custom]
  faculty_name: string or null
  course_name: string or null
  day: integer 0-6 (Mon=0, Sun=6) or null
  period: integer 0-7 or null
  before_period: integer or null
  after_period: integer or null
  max_periods: integer or null
  preferred_periods: list of ints or null
  excluded_days: list of ints or null
  confidence: float 0.0-1.0
  description: short human-readable summary

Respond ONLY with valid JSON, no markdown, no explanation."""

        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": text}],
        )

        raw = message.content[0].text.strip()
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip()
        parsed = json.loads(raw)
        parsed["raw"] = text
        return parsed

    except Exception as exc:
        logger.warning("Claude parse failed (%s), falling back to local parser", exc)
        return parse_constraint_local(text)


async def parse_nlp_constraint(
    text: str,
    api_key: str = "",
    institution_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Main entry: use Claude if key available, else local parser."""
    if api_key and api_key.strip():
        return await parse_constraint_claude(text, api_key)
    return parse_constraint_local(text, institution_context=institution_context)
