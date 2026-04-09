"""
Export service — generates PDF and Excel timetable exports.
"""

import io
from typing import Any, Dict, List, Optional

# ── Excel export ──────────────────────────────────────────────────────────────

def export_excel(
    slots: List[Dict],
    institution_name: str,
    periods_per_day: Dict,
    days_names: Optional[List[str]] = None,
) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import (
        PatternFill, Font, Alignment, Border, Side, GradientFill
    )
    from openpyxl.utils import get_column_letter

    if days_names is None:
        days_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    wb = Workbook()

    # Collect unique sections
    section_ids = sorted({s["section_id"] for s in slots if s.get("section_id")})
    if not section_ids:
        section_ids = [None]

    HEADER_FILL   = PatternFill("solid", fgColor="1E293B")
    DAY_FILL      = PatternFill("solid", fgColor="334155")
    THEORY_FILL   = PatternFill("solid", fgColor="DBEAFE")
    LAB_FILL      = PatternFill("solid", fgColor="D1FAE5")
    BREAK_FILL    = PatternFill("solid", fgColor="FEF3C7")
    EMPTY_FILL    = PatternFill("solid", fgColor="F8FAFC")
    BORDER_SIDE   = Side(style="thin", color="CBD5E1")
    CELL_BORDER   = Border(
        left=BORDER_SIDE, right=BORDER_SIDE,
        top=BORDER_SIDE, bottom=BORDER_SIDE
    )

    def apply_header(cell, value, bold=True, fg="FFFFFF"):
        cell.value = value
        cell.font = Font(bold=bold, color=fg, name="Calibri", size=10)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = CELL_BORDER

    for sec_id in section_ids:
        sec_slots = [s for s in slots if s.get("section_id") == sec_id or sec_id is None]
        sec_name  = sec_slots[0].get("section_name", f"Section {sec_id}") if sec_slots else str(sec_id)

        ws = wb.create_sheet(title=sec_name[:31])
        ws.sheet_view.showGridLines = False

        # Title row
        max_col = max((max(ps) for ps in periods_per_day.values() if ps), default=7) + 3
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max_col)
        title_cell = ws.cell(row=1, column=1)
        title_cell.value = f"{institution_name} — {sec_name} Timetable"
        title_cell.fill  = HEADER_FILL
        apply_header(title_cell, title_cell.value)
        ws.row_dimensions[1].height = 24

        # Column headers (Period row)
        working_days = sorted(periods_per_day.keys())
        all_periods  = sorted({p for ps in periods_per_day.values() for p in ps})

        ws.cell(row=2, column=1).value = "Day / Period"
        ws.cell(row=2, column=1).fill  = HEADER_FILL
        apply_header(ws.cell(row=2, column=1), "Day / Period")

        for col_i, p in enumerate(all_periods, start=2):
            cell = ws.cell(row=2, column=col_i)
            cell.fill = HEADER_FILL
            apply_header(cell, f"P{p+1}", fg="FFFFFF")

        ws.row_dimensions[2].height = 20

        # Data rows
        for row_i, d in enumerate(working_days, start=3):
            day_name = days_names[d] if d < len(days_names) else f"Day {d}"
            day_cell = ws.cell(row=row_i, column=1)
            day_cell.fill = DAY_FILL
            apply_header(day_cell, day_name, fg="FFFFFF")
            ws.row_dimensions[row_i].height = 40

            for col_i, p in enumerate(all_periods, start=2):
                # Find a slot for this section/day/period
                matching = [
                    s for s in sec_slots
                    if s.get("day") == d
                    and (s.get("period") == p or
                         (s.get("slot_type") == "lab" and s.get("period") == p - 1))
                ]
                cell = ws.cell(row=row_i, column=col_i)
                if matching:
                    sl = matching[0]
                    if sl.get("slot_type") == "break":
                        text = "Break Lecture\nNo substitute available\nFree period"
                        cell.fill = BREAK_FILL
                    else:
                        text = (
                            f"{sl.get('course_name','')}\n"
                            f"{sl.get('faculty_name','')}\n"
                            f"{sl.get('room_name','')}"
                        )
                        cell.fill  = LAB_FILL if sl.get("slot_type") == "lab" else THEORY_FILL
                    cell.value = text
                    cell.font  = Font(name="Calibri", size=9)
                    cell.alignment = Alignment(
                        horizontal="center", vertical="center", wrap_text=True
                    )
                else:
                    cell.fill = EMPTY_FILL
                cell.border = CELL_BORDER

        # Column widths
        ws.column_dimensions["A"].width = 14
        for col_i in range(2, len(all_periods) + 2):
            ws.column_dimensions[get_column_letter(col_i)].width = 18

    # Remove default empty sheet
    if "Sheet" in wb.sheetnames:
        del wb["Sheet"]

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── PDF export ────────────────────────────────────────────────────────────────

def export_pdf(
    slots: List[Dict],
    institution_name: str,
    periods_per_day: Dict,
    days_names: Optional[List[str]] = None,
) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph,
        Spacer, PageBreak,
    )

    if days_names is None:
        days_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        leftMargin=10*mm, rightMargin=10*mm,
        topMargin=10*mm, bottomMargin=10*mm
    )

    styles = getSampleStyleSheet()
    cell_style = ParagraphStyle(
        "cell", fontSize=7, leading=9, alignment=1,   # center
        fontName="Helvetica"
    )
    header_style = ParagraphStyle(
        "hdr", fontSize=8, leading=10, alignment=1,
        fontName="Helvetica-Bold", textColor=colors.white
    )
    title_style  = ParagraphStyle(
        "title", fontSize=14, leading=18, alignment=1,
        fontName="Helvetica-Bold", textColor=colors.HexColor("#1E293B")
    )

    story = []
    section_ids = sorted({s["section_id"] for s in slots if s.get("section_id")})
    working_days = sorted(periods_per_day.keys())
    all_periods  = sorted({p for ps in periods_per_day.values() for p in ps})

    NAVY  = colors.HexColor("#1E293B")
    SLATE = colors.HexColor("#334155")
    BLUE  = colors.HexColor("#DBEAFE")
    GREEN = colors.HexColor("#D1FAE5")
    AMBER = colors.HexColor("#FEF3C7")
    WHITE = colors.white

    for sec_id in (section_ids or [None]):
        sec_slots = [s for s in slots if s.get("section_id") == sec_id]
        sec_name  = sec_slots[0].get("section_name", f"Section {sec_id}") if sec_slots else "-"

        story.append(Paragraph(f"{institution_name}", title_style))
        story.append(Paragraph(f"Section: {sec_name}", styles["Heading2"]))
        story.append(Spacer(1, 4*mm))

        # Build table data
        header_row = [Paragraph("Day / Period", header_style)] + [
            Paragraph(f"P{p+1}", header_style) for p in all_periods
        ]
        table_data = [header_row]

        for d in working_days:
            day_name = days_names[d] if d < len(days_names) else f"Day {d}"
            row = [Paragraph(day_name, ParagraphStyle(
                "day", fontSize=8, fontName="Helvetica-Bold",
                alignment=1, textColor=colors.white
            ))]
            for p in all_periods:
                matching = [
                    s for s in sec_slots
                    if s.get("day") == d
                    and (s.get("period") == p or
                         (s.get("slot_type") == "lab" and s.get("period") == p - 1))
                ]
                if matching:
                    sl = matching[0]
                    if sl.get("slot_type") == "break":
                        txt = "<b>Break Lecture</b><br/>No substitute available<br/><i>Free period</i>"
                    else:
                        txt = (
                            f"<b>{sl.get('course_name','')}</b><br/>"
                            f"{sl.get('faculty_name','')}<br/>"
                            f"<i>{sl.get('room_name','')}</i>"
                        )
                    row.append(Paragraph(txt, cell_style))
                else:
                    row.append(Paragraph("", cell_style))
            table_data.append(row)

        col_w = [30*mm] + [22*mm] * len(all_periods)
        tbl   = Table(table_data, colWidths=col_w, repeatRows=1)

        style_cmds = [
            ("BACKGROUND", (0, 0), (-1, 0),  NAVY),
            ("BACKGROUND", (0, 1), (0, -1),  SLATE),
            ("TEXTCOLOR",  (0, 0), (-1,  0), WHITE),
            ("TEXTCOLOR",  (0, 1), (0,  -1), WHITE),
            ("ROWBACKGROUNDS", (1, 1), (-1, -1), [WHITE, colors.HexColor("#F1F5F9")]),
            ("GRID",       (0, 0), (-1, -1),  0.4, colors.HexColor("#CBD5E1")),
            ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN",      (0, 0), (-1, -1), "CENTER"),
            ("FONTSIZE",   (0, 0), (-1, -1),  7),
            ("ROWHEIGHT",  (1, 0), (-1, -1),  26),
        ]

        # Colour lab cells green
        for r_i, d in enumerate(working_days, start=1):
            for c_i, p in enumerate(all_periods, start=1):
                matching = [
                    s for s in sec_slots
                    if s.get("day") == d and s.get("period") == p
                    and s.get("slot_type") == "lab"
                ]
                if matching:
                    fill_color = AMBER if matching[0].get("slot_type") == "break" else GREEN
                    style_cmds.append(("BACKGROUND", (c_i, r_i), (c_i, r_i), fill_color))

        tbl.setStyle(TableStyle(style_cmds))
        story.append(tbl)
        story.append(PageBreak())

    story = story[:-1]   # remove trailing page break
    doc.build(story)
    return buf.getvalue()
