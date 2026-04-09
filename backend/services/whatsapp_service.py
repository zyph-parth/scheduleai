from __future__ import annotations

from typing import Any, Dict, List, Optional

from twilio.rest import Client


def normalize_whatsapp_address(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return raw
    if raw.startswith("whatsapp:"):
        prefix, raw = "whatsapp:", raw[len("whatsapp:"):]
    else:
        prefix = "whatsapp:"
    raw = raw.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if raw.startswith("whatsapp:"):
        return raw
    return f"{prefix}{raw}"


class WhatsAppService:
    def __init__(self, account_sid: str, auth_token: str, from_number: str):
        self._client = Client(account_sid, auth_token)
        self._from_number = normalize_whatsapp_address(from_number)

    def send_text(self, to_number: str, body: str) -> str:
        msg = self._client.messages.create(
            from_=self._from_number,
            to=normalize_whatsapp_address(to_number),
            body=body,
        )
        return msg.sid


DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _day_name(day: Optional[int]) -> str:
    if day is None:
        return "the scheduled day"
    if 0 <= int(day) < len(DAY_NAMES):
        return DAY_NAMES[int(day)]
    return f"day {day}"


def _period_label(period: Optional[int]) -> str:
    if period is None:
        return "scheduled period"
    return f"period {int(period) + 1}"


def render_schedule_change_template(
    action_type: str,
    faculty_name: str,
    timetable_name: str,
    affected_sections: List[str],
    slot_summaries: List[Dict[str, Any]],
) -> str:
    sections_line = ", ".join(affected_sections[:4]) if affected_sections else "your section"
    if len(affected_sections) > 4:
        sections_line += f" and {len(affected_sections) - 4} more"

    if slot_summaries:
        first = slot_summaries[0]
        course_name = first.get("course_name") or "a scheduled class"
        day_label = _day_name(first.get("day"))
        period_label = _period_label(first.get("period"))
    else:
        course_name = "a scheduled class"
        day_label = "the scheduled day"
        period_label = "the scheduled period"

    if action_type == "cancel_session":
        headline = f"Schedule update: {course_name} has been cancelled."
    elif action_type == "reschedule_request":
        headline = f"Schedule update: {course_name} has been rescheduled."
    elif action_type == "faculty_absence":
        headline = f"Schedule update: {faculty_name} is unavailable."
    else:
        headline = "Schedule update from ScheduleAI."

    return (
        f"{headline}\n"
        f"Faculty: {faculty_name}\n"
        f"Affected section(s): {sections_line}\n"
        f"When: {day_label}, {period_label}\n"
        f"Timetable: {timetable_name}\n"
        "Please check the updated timetable or contact your class representative for details."
    )


def build_whatsapp_service(
    account_sid: str,
    auth_token: str,
    from_number: str,
) -> Optional[WhatsAppService]:
    if not (account_sid or "").strip():
        return None
    if not (auth_token or "").strip():
        return None
    if not (from_number or "").strip():
        return None
    return WhatsAppService(account_sid=account_sid, auth_token=auth_token, from_number=from_number)
