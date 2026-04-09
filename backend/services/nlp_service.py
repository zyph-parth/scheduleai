"""
NLP Constraint Parser — converts plain-English faculty/room constraints
into structured JSON that the solver understands.

Example inputs → outputs:
  "Dr. Sharma cannot teach before 10am on Mondays"
  → {type:"unavailability", faculty_name:"Sharma", day:0, before_period:1}

  "Lab sessions should not be on Fridays"
  → {type:"day_restriction", session_type:"lab", excluded_days:[4]}

  "Mathematics must be in morning slots"
  → {type:"core_priority", course_name:"Mathematics", preferred_periods:[0,1,2]}
"""

import json
import logging
import re
from typing import Any, Dict, Optional

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


def _hour_to_period(time_str: str) -> int:
    """Best-effort time-string → period index."""
    t = time_str.lower().strip().replace(" ", "")
    return PERIOD_HOUR_MAP.get(t, -1)


def parse_constraint_local(text: str) -> Dict[str, Any]:
    """
    Lightweight regex-based parser as fallback when Claude API is unavailable.
    Handles the most common constraint patterns.
    """
    text_lower = text.lower()
    result: Dict[str, Any] = {"raw": text, "confidence": 0.6}

    # --- Unavailability: "cannot teach / not available on Monday before 10am" ---
    day_found = None
    for day_word, day_idx in DAY_MAP.items():
        if day_word in text_lower:
            day_found = day_idx
            break

    period_found = -1
    time_re = re.search(r"(\d{1,2})(am|pm|:\d{2})?", text_lower)
    if time_re:
        period_found = _hour_to_period(time_re.group(0))

    faculty_re = re.search(r"(?:dr\.?|prof\.?|mr\.?|ms\.?)\s+(\w+)", text, re.I)
    faculty_name = faculty_re.group(1) if faculty_re else None

    if any(w in text_lower for w in ["cannot teach", "not available", "unavailable", "busy"]):
        result.update({
            "type": "unavailability",
            "faculty_name": faculty_name,
            "day": day_found,
            "period": period_found if period_found >= 0 else None,
            "description": f"Mark {faculty_name or 'faculty'} unavailable"
            + (f" on day {day_found}" if day_found is not None else "")
            + (f" period {period_found}" if period_found >= 0 else ""),
        })
        return result

    # --- Core subject priority: "Maths must be in morning" ---
    if any(w in text_lower for w in ["morning", "early", "first period", "priority"]):
        course_re = re.search(r"(?:subject|course)?\s*['\"]?(\w[\w\s]*?)(?:['\"])?\s+(?:must|should)", text, re.I)
        result.update({
            "type": "core_priority",
            "course_name": course_re.group(1).strip() if course_re else None,
            "preferred_periods": [0, 1, 2],
            "description": "Schedule course in morning slots (periods 0-2)",
        })
        return result

    # --- Max consecutive: "no faculty should teach more than 3 consecutive" ---
    consec_re = re.search(r"(\d+)\s+consecutive", text_lower)
    if consec_re:
        result.update({
            "type": "max_consecutive",
            "faculty_name": faculty_name,
            "max_periods": int(consec_re.group(1)),
            "description": f"Limit consecutive teaching to {consec_re.group(1)} periods",
        })
        return result

    # Generic fallback
    result.update({
        "type": "generic",
        "description": f"Constraint noted: {text}",
        "confidence": 0.3,
    })
    return result


async def parse_constraint_claude(text: str, api_key: str) -> Dict[str, Any]:
    """
    Use Claude API to parse natural language into structured constraint JSON.
    Returns the parsed constraint dict.
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
  before_period: integer or null (for "before 10am" constraints)
  after_period: integer or null
  max_periods: integer or null (for consecutive limits)
  preferred_periods: list of ints or null
  excluded_days: list of ints or null
  confidence: float 0.0-1.0 (your confidence in the parse)
  description: short human-readable summary of what this constraint does

Respond ONLY with valid JSON, no markdown, no explanation."""

        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": text}],
        )

        raw = message.content[0].text.strip()
        # Remove markdown code fences if present
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip()
        parsed = json.loads(raw)
        parsed["raw"] = text
        return parsed

    except Exception as exc:
        logger.warning("Claude parse failed (%s), falling back to local parser", exc)
        return parse_constraint_local(text)


async def parse_nlp_constraint(text: str, api_key: str = "") -> Dict[str, Any]:
    """Main entry: use Claude if key available, else local parser."""
    if api_key and api_key.strip():
        return await parse_constraint_claude(text, api_key)
    return parse_constraint_local(text)
