import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { API, type Timetable, type Slot, type Institution } from '../api/client'
import toast from 'react-hot-toast'
import {
  Download, Lock, LockOpen, Filter, RefreshCw,
  AlertTriangle, CheckCircle2, FileSpreadsheet, FileText,
  X, Clock, MapPin, User, BookOpen, ChevronDown, Layers
} from 'lucide-react'
import clsx from 'clsx'

/* ─── Theme tokens (mirror your global CSS vars) ──────────────────────────
   Map everything to the light ScheduleAI palette from the screenshot:
   • Background : #F8F9FC  (page canvas)
   • Surface    : #FFFFFF  (cards / glass panels)
   • Border     : #E4E7EF
   • Text-primary   : #0F172A  (slate-900)
   • Text-secondary : #64748B  (slate-500)
   • Text-muted     : #94A3B8  (slate-400)
   • Brand accent   : #1B4FD8  (royal blue – CTAs, active states)
   • Brand light    : #EEF2FF  (badge bg, hover tints)
   • Success green  : #059669
   • Warning amber  : #D97706
   • Danger red     : #DC2626
   ──────────────────────────────────────────────────────────────────────── */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* Slot pill colours – solid fills that pop on the white grid */
const THEME_COLORS = {
  theory:   { bg: 'bg-[#1B4FD8]',  ring: 'ring-[#1B4FD8]/30' },
  lab:      { bg: 'bg-[#059669]',  ring: 'ring-[#059669]/30' },
  break:    { bg: 'bg-[#D97706]',  ring: 'ring-[#D97706]/30' },
  combined: { bg: 'bg-[#D97706]',  ring: 'ring-[#D97706]/30' },
  modified: { bg: 'bg-[#DC2626]',  ring: 'ring-[#DC2626]/30' },
}

function getSlotColor(slot: Slot) {
  if (slot.is_modified) return THEME_COLORS.modified
  if (slot.slot_type === 'break') return THEME_COLORS.break
  if (slot.is_combined) return THEME_COLORS.combined
  if (slot.slot_type === 'lab') return THEME_COLORS.lab
  return THEME_COLORS.theory
}

function formatTime(startTime: string, period: number, durationMinutes: number) {
  const [h, m] = startTime.split(':').map(Number)
  const startMin = h * 60 + m + period * durationMinutes
  const endMin = startMin + durationMinutes
  const fmt = (min: number) => {
    const hh = Math.floor(min / 60)
    const mm = min % 60
    const ampm = hh >= 12 ? 'PM' : 'AM'
    const dispH = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh
    return `${dispH}:${mm.toString().padStart(2, '0')} ${ampm}`
  }
  return { start: fmt(startMin), end: fmt(endMin) }
}

export default function TimetablePage() {
  const loc = useLocation()
  const [timetables, setTimetables] = useState<any[]>([])
  const [selTtId, setSelTtId] = useState<number | null>((loc.state as any)?.ttId ?? null)
  const [tt, setTt] = useState<Timetable | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterSec, setFilterSec] = useState<string>('all')
  const [selSlot, setSelSlot] = useState<Slot | null>(null)
  const [subs, setSubs] = useState<any[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [selInst, setSelInst] = useState<number | null>(null)

  useEffect(() => {
    API.getInstitutions().then(d => {
      setInstitutions(d)
      if (d.length) setSelInst(d[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selInst) return
    API.listTimetables(selInst).then(d => {
      setTimetables(d)
      if (!selTtId && d.length) {
        const done = d.find((t: any) => t.status === 'done')
        if (done) setSelTtId(done.id)
      }
    })
  }, [selInst])

  useEffect(() => {
    if (!selTtId) return
    setLoading(true)
    API.getTimetable(selTtId)
      .then(setTt)
      .catch(() => toast.error('Failed to load timetable'))
      .finally(() => setLoading(false))
  }, [selTtId])

  const inst = institutions.find(i => i.id === selInst)
  const startTime = inst?.start_time || '09:00'
  const periodDur = inst?.period_duration_minutes || 50
  const workingDays = inst?.working_days || [0, 1, 2, 3, 4]
  const periodsPerDay = inst?.periods_per_day || {}
  const breakSlots = inst?.break_slots || {}

  const allPeriods: number[] = Array.from(
    new Set(Object.values(periodsPerDay).flat())
  ).sort((a, b) => a - b)

  const sections = Array.from(
    new Set((tt?.slots || []).map(s => s.section_name).filter(Boolean))
  ).sort()

  const filteredSlots = (tt?.slots || []).filter(s =>
    filterSec === 'all' || s.section_name === filterSec
  )

  const slotGrid: Record<number, Record<number, Slot[]>> = {}
  for (const d of workingDays) {
    slotGrid[d] = {}
    for (const p of allPeriods) {
      slotGrid[d][p] = []
    }
  }
  for (const s of filteredSlots) {
    if (slotGrid[s.day]?.[s.period]) {
      slotGrid[s.day][s.period].push(s)
    }
  }

  const isBreak = (day: number, period: number): boolean => {
    const breaks = breakSlots[String(day)] || []
    return breaks.includes(period)
  }

  const hasPeriod = (day: number, period: number): boolean => {
    const periods = periodsPerDay[String(day)] || []
    return periods.includes(period)
  }

  const handleSlotClick = async (slot: Slot) => {
    setSelSlot(slot)
    if (selTtId) {
      const response = await API.findSubstitutes(selTtId, slot.id).catch(() => ({ candidates: [] }))
      setSubs(response?.candidates || [])
    }
  }

  const lockSlot = async (slotId: number) => {
    await API.lockSlot(slotId)
    toast.success('Lock toggled')
    if (selTtId) API.getTimetable(selTtId).then(setTt)
  }

  const substitute = async (slotId: number, facId: number) => {
    await API.substituteSlot(slotId, { slot_id: slotId, substitute_faculty_id: facId })
    toast.success('Substitution applied')
    setSelSlot(null)
    if (selTtId) API.getTimetable(selTtId).then(setTt)
  }

  return (
    /* Page canvas – light grey like the screenshot background */
    <div className="space-y-5 animate-fade-in bg-[#F8F9FC] min-h-screen p-0">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Timetable</h1>
          <p className="text-[#64748B] text-sm mt-0.5">Interactive schedule grid with slot management</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selTtId && (
            <>
              {/* Export buttons – outlined style matching screenshot's secondary actions */}
              <a
                href={API.exportExcel(selTtId)}
                download
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E4E7EF] bg-white text-sm font-medium text-[#0F172A] hover:bg-[#F1F5F9] transition-colors shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#059669]" /> Excel
              </a>
              <a
                href={API.exportPdf(selTtId)}
                download
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E4E7EF] bg-white text-sm font-medium text-[#0F172A] hover:bg-[#F1F5F9] transition-colors shadow-sm"
              >
                <FileText className="w-4 h-4 text-[#DC2626]" /> PDF
              </a>
            </>
          )}
        </div>
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm p-4 flex gap-4 flex-wrap items-end">
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-[#64748B] mb-1.5">
            Institution
          </label>
          <select
            className="h-9 px-3 pr-8 rounded-lg border border-[#E4E7EF] bg-white text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]/30 focus:border-[#1B4FD8] transition-all w-52"
            value={selInst ?? ''} onChange={e => setSelInst(Number(e.target.value))}
          >
            <option value="" disabled>Institution…</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-[#64748B] mb-1.5">
            Timetable
          </label>
          <select
            className="h-9 px-3 pr-8 rounded-lg border border-[#E4E7EF] bg-white text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]/30 focus:border-[#1B4FD8] transition-all w-64"
            value={selTtId ?? ''} onChange={e => setSelTtId(Number(e.target.value))}
          >
            <option value="" disabled>Select timetable…</option>
            {timetables.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
            ))}
          </select>
        </div>
        {tt && (
          <div className="ml-auto flex items-center gap-3">
            {tt.violations.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-semibold">
                <AlertTriangle className="w-3 h-3" />{tt.violations.length} conflict(s)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 text-xs font-semibold">
                <CheckCircle2 className="w-3 h-3" />Conflict-free
              </span>
            )}
            <span className="text-xs text-[#94A3B8]">{tt.slots.length} slots · {tt.solve_time}s</span>
          </div>
        )}
      </div>

      {/* ── Section filter tabs ───────────────────────────────────────────── */}
      {tt && sections.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterSec('all')}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 border',
              filterSec === 'all'
                ? 'bg-[#1B4FD8] text-white border-[#1B4FD8] shadow-sm'
                : 'bg-white text-[#64748B] border-[#E4E7EF] hover:text-[#0F172A] hover:border-[#CBD5E1]'
            )}
          >
            <span className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" /> All Sections
            </span>
          </button>
          {sections.map(s => {
            const active = filterSec === s
            return (
              <button
                key={s}
                onClick={() => setFilterSec(s!)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 border',
                  active
                    ? 'bg-[#1B4FD8] text-white border-[#1B4FD8] shadow-sm'
                    : 'bg-white text-[#64748B] border-[#E4E7EF] hover:text-[#0F172A] hover:border-[#CBD5E1]'
                )}
              >
                {s}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-5 text-xs flex-wrap items-center">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#1B4FD8]" />
          <span className="text-[#64748B]">Theory</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#059669]" />
          <span className="text-[#64748B]">Lab (2 periods)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#D97706]" />
          <span className="text-[#64748B]">Combined Section</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#DC2626]" />
          <span className="text-[#64748B]">Modified</span>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex gap-5">

        {/* ── Timetable Grid ──────────────────────────────────────────────── */}
        <div className={clsx('flex-1 min-w-0', loading && 'opacity-50 pointer-events-none')}>
          {loading && (
            <div className="flex items-center justify-center py-20">
              <span className="spinner w-8 h-8" />
            </div>
          )}

          {!loading && tt && (
            <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full bg-[#F8F9FC]" style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: '0' }}>
                  {/* Header */}
                  <thead>
                    <tr>
                      <th className="w-20 bg-[#F8F9FC] text-[#64748B] text-[10px] uppercase tracking-wider font-semibold p-3 border-b border-r border-[#E4E7EF] text-center sticky left-0 z-10">
                        Period
                      </th>
                      {workingDays.map(d => (
                        <th key={d}
                          className="bg-[#F8F9FC] text-[#0F172A] text-xs font-semibold p-3 border-b border-r border-[#E4E7EF] text-center"
                          style={{ minWidth: filterSec === 'all' && sections.length > 2 ? 180 : 160 }}
                        >
                          <div className="text-[#0F172A] font-bold">{SHORT_DAYS[d]}</div>
                          <div className="text-[#94A3B8] text-[10px] font-normal mt-0.5">{DAYS[d]}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  {/* Body */}
                  <tbody>
                    {allPeriods.map(p => {
                      const timeInfo = formatTime(startTime, p, periodDur)
                      const isBr = workingDays.every(d => isBreak(d, p))

                      if (isBr) {
                        return (
                          <tr key={p}>
                            <td className="bg-[#FFFBEB] p-3 border-b border-r border-[#E4E7EF] text-center sticky left-0 z-10">
                              <div className="text-[10px] text-[#D97706] font-bold uppercase tracking-wider">Break</div>
                              <div className="text-[9px] text-[#94A3B8]">{timeInfo.start}</div>
                            </td>
                            {workingDays.map(d => (
                              <td key={d} className="bg-[#FFFBEB] border-b border-r border-[#E4E7EF] p-3 text-center">
                                <div className="rounded-lg border border-[#FDE68A] bg-[#FFF7D6] px-3 py-5">
                                  <span className="text-[10px] text-[#D97706]/70 font-medium uppercase tracking-wider">Lunch Break</span>
                                </div>
                              </td>
                            ))}
                          </tr>
                        )
                      }

                      return (
                        <tr key={p} className="group hover:bg-[#F8F9FC]/60 transition-colors">
                          {/* Period label */}
                          <td className="p-3 border-b border-r border-[#E4E7EF] text-center sticky left-0 z-10 bg-white w-[4.5rem]">
                            <div className="flex flex-col items-center justify-center">
                              <span className="text-sm font-bold text-[#0F172A]">P{p + 1}</span>
                              <span className="text-[10px] text-[#64748B] mt-0.5 tracking-tight">{timeInfo.start}</span>
                              <span className="text-[10px] text-[#94A3B8] tracking-tight">{timeInfo.end}</span>
                            </div>
                          </td>

                          {/* Day cells */}
                          {workingDays.map(d => {
                            if (!hasPeriod(d, p)) {
                              return (
                                <td key={d} className="border-b border-r border-[#E4E7EF] p-2 bg-[#F8F9FC]">
                                  <div className="h-20 rounded-lg border border-dashed border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-center">
                                    <span className="text-[10px] text-[#CBD5E1]">—</span>
                                  </div>
                                </td>
                              )
                            }

                            if (isBreak(d, p)) {
                              return (
                                <td key={d} className="border-b border-r border-[#E4E7EF] p-2 bg-[#FFFDF5]">
                                  <div className="h-20 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] flex items-center justify-center">
                                    <span className="text-[10px] text-[#D97706]/60 font-medium">Break</span>
                                  </div>
                                </td>
                              )
                            }

                            const cellSlots = slotGrid[d]?.[p] || []

                            return (
                              <td key={d} className="border-b border-r border-[#E4E7EF] px-3 py-2 align-top bg-[#F8F9FC]">
                                <div className={clsx(
                                  'min-h-[5.25rem] rounded-xl bg-white p-1.5 flex flex-col gap-1.5',
                                  cellSlots.length === 0 && 'items-center justify-center border border-dashed border-[#E2E8F0]'
                                )}>
                                  {cellSlots.length === 0 && (
                                    <span className="text-[10px] text-[#CBD5E1]">—</span>
                                  )}
                                  {cellSlots.map(slot => {
                                    const color = getSlotColor(slot)
                                    return (
                                      <button
                                        key={slot.id}
                                        onClick={() => handleSlotClick(slot)}
                                        className={clsx(
                                          'w-full rounded-lg px-4 py-2.5 text-left transition-all duration-150',
                                          'hover:scale-[1.02] active:scale-[0.98] cursor-pointer',
                                          'shadow-sm hover:shadow-md ring-1',
                                          color.bg, color.ring
                                        )}
                                      >
                                        <div className="font-semibold text-white text-[12px] mb-1 leading-snug">
                                          {slot.course_name || 'Course'}
                                        </div>
                                        <div className="flex items-center gap-1 text-white/80 text-[10px] mb-0.5">
                                          <User className="w-2.5 h-2.5 shrink-0" />
                                          <span className="truncate">{slot.faculty_name || '—'}</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-white/80 text-[10px] mb-2">
                                          <MapPin className="w-2.5 h-2.5 shrink-0" />
                                          <span className="truncate">{slot.room_name || 'TBD'}</span>
                                        </div>
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {slot.slot_type === 'lab' && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/25 text-white font-bold tracking-wide uppercase">LAB</span>
                                          )}
                                          {slot.slot_type === 'break' && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/25 text-white font-bold tracking-wide uppercase">BREAK</span>
                                          )}
                                          {slot.is_combined && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/25 text-white font-bold tracking-wide uppercase">COMBINED</span>
                                          )}
                                          {slot.is_locked && (
                                            <Lock className="w-2.5 h-2.5 text-white/70" />
                                          )}
                                          {slot.section_name && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-black/15 text-white font-bold tracking-wide">
                                              {slot.section_name}
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                    )
                                  })}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && !tt && (
            <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm flex flex-col items-center justify-center py-24 text-[#94A3B8]">
              <Filter className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Select an institution and timetable to view the schedule</p>
            </div>
          )}
        </div>

        {/* ── Slot detail panel ───────────────────────────────────────────── */}
        {selSlot && (
          <div className="w-80 shrink-0 space-y-3 animate-slide-up">
            <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-[#0F172A] text-sm flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#1B4FD8]" />
                  Slot Details
                </h3>
                <button
                  className="p-1.5 rounded-lg hover:bg-[#F1F5F9] text-[#94A3B8] hover:text-[#64748B] transition-colors"
                  onClick={() => setSelSlot(null)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Course Card */}
              <div className={clsx('rounded-lg p-4 mb-4', getSlotColor(selSlot).bg)}>
                <p className="text-white font-bold text-base mb-3">{selSlot.course_name}</p>
                <div className="flex gap-2 flex-wrap">
                  {selSlot.slot_type === 'lab' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/25 text-white font-bold uppercase tracking-wide">LAB</span>}
                  {selSlot.slot_type === 'break' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/25 text-white font-bold uppercase tracking-wide">BREAK</span>}
                  {selSlot.is_combined && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/25 text-white font-bold uppercase tracking-wide">COMBINED</span>}
                  {selSlot.is_locked && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/25 text-white font-bold uppercase tracking-wide flex items-center gap-1"><Lock className="w-2.5 h-2.5" />LOCKED</span>}
                  {selSlot.is_modified && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/25 text-white font-bold uppercase tracking-wide">MODIFIED</span>}
                </div>
              </div>

              {/* Details */}
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#F8F9FC] border border-[#E4E7EF]">
                  <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] flex items-center justify-center">
                    <User className="w-4 h-4 text-[#1B4FD8]" />
                  </div>
                  <div>
                    <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold">Faculty</p>
                    <p className="text-sm text-[#0F172A] font-medium">{selSlot.faculty_name}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#F8F9FC] border border-[#E4E7EF]">
                  <div className="w-8 h-8 rounded-lg bg-[#ECFDF5] flex items-center justify-center">
                    <MapPin className="w-4 h-4 text-[#059669]" />
                  </div>
                  <div>
                    <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold">Room</p>
                    <p className="text-sm text-[#0F172A] font-medium">{selSlot.room_name || 'TBD'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#F8F9FC] border border-[#E4E7EF]">
                  <div className="w-8 h-8 rounded-lg bg-[#FFFBEB] flex items-center justify-center">
                    <Clock className="w-4 h-4 text-[#D97706]" />
                  </div>
                  <div>
                    <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold">Schedule</p>
                    <p className="text-sm text-[#0F172A] font-medium">
                      {SHORT_DAYS[selSlot.day]} · Period {selSlot.period + 1}
                      {selSlot.duration > 1 ? `–${selSlot.period + selSlot.duration}` : ''}
                    </p>
                    <p className="text-[10px] text-[#94A3B8]">
                      {formatTime(startTime, selSlot.period, periodDur).start} — {formatTime(startTime, selSlot.period + selSlot.duration - 1, periodDur).end}
                    </p>
                  </div>
                </div>

                {selSlot.section_name && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-[#F8F9FC] border border-[#E4E7EF]">
                    <div className="w-8 h-8 rounded-lg bg-[#F0F9FF] flex items-center justify-center">
                      <Layers className="w-4 h-4 text-[#0284C7]" />
                    </div>
                    <div>
                      <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold">Section</p>
                      <p className="text-sm text-[#0F172A] font-medium">
                        {selSlot.is_combined ? selSlot.section_ids?.join(', ') : selSlot.section_name}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Lock button */}
              <div className="mt-4">
                <button
                  className={clsx(
                    'w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all border',
                    selSlot.is_locked
                      ? 'bg-[#EEF2FF] text-[#1B4FD8] border-[#C7D2FE] hover:bg-[#E0E7FF]'
                      : 'bg-white text-[#64748B] border-[#E4E7EF] hover:bg-[#F8F9FC] hover:text-[#0F172A]'
                  )}
                  onClick={() => lockSlot(selSlot.id)}
                >
                  {selSlot.is_locked
                    ? <><Lock className="w-4 h-4" /> Locked — Click to Unlock</>
                    : <><LockOpen className="w-4 h-4" /> Lock This Slot</>}
                </button>
              </div>
            </div>

            {/* Substitutes */}
            {subs.length > 0 && (
              <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm p-5">
                <h3 className="font-bold text-[#0F172A] text-sm mb-3 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-[#059669]" />
                  Available Substitutes
                </h3>
                <div className="space-y-2">
                  {subs.map((s: any) => (
                    <div
                      key={s.faculty_id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-[#F8F9FC] border border-[#E4E7EF] hover:border-[#CBD5E1] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#0F172A] truncate">{s.faculty_name}</p>
                        {s.subject_match && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[9px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 font-semibold">
                            Subject match
                          </span>
                        )}
                      </div>
                      <button
                        className="px-3 py-1.5 rounded-lg bg-[#059669] text-white text-xs font-semibold hover:bg-[#047857] transition-colors shrink-0"
                        onClick={() => substitute(selSlot.id, s.faculty_id)}
                      >
                        Assign
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Violations ────────────────────────────────────────────────────── */}
      {tt && tt.violations.length > 0 && (
        <div className="bg-white border border-red-200 rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-bold text-red-600 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Constraint Violations
          </h3>
          <div className="space-y-2">
            {tt.violations.map((v, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#0F172A]">{v.type}</p>
                  <p className="text-xs text-[#64748B] mt-0.5">{v.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
