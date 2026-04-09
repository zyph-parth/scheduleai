import { useEffect, useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { API, type Timetable, type Slot } from '../api/client'
import toast from 'react-hot-toast'
import {
  Download, Lock, LockOpen, Filter, RefreshCw,
  AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Eye
} from 'lucide-react'
import clsx from 'clsx'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat']
const COLOURS = {
  theory:   '#4f46e5',
  lab:      '#10b981',
  combined: '#f59e0b',
  modified: '#ef4444',
}

function slotToEvent(slot: Slot, startTime: string, periodDuration: number) {
  const [h, m] = startTime.split(':').map(Number)
  const baseMin = h * 60 + m
  const startMin = baseMin + slot.period * periodDuration
  const endMin   = startMin + slot.duration * periodDuration

  const fmt = (min: number) => {
    const hh = Math.floor(min / 60).toString().padStart(2, '0')
    const mm = (min % 60).toString().padStart(2, '0')
    return `${hh}:${mm}`
  }

  // FullCalendar: week view uses ISO date. Map day index (0=Mon) to next Monday.
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - today.getDay() + 1)
  const d = new Date(monday)
  d.setDate(monday.getDate() + slot.day)
  const dateStr = d.toISOString().slice(0, 10)

  const colour = slot.is_modified ? COLOURS.modified
    : slot.is_combined         ? COLOURS.combined
    : slot.slot_type === 'lab' ? COLOURS.lab
    : COLOURS.theory

  return {
    id:    String(slot.id),
    title: `${slot.course_name || 'Course'}\n${slot.faculty_name || ''}\n${slot.room_name || 'TBD'}`,
    start: `${dateStr}T${fmt(startMin)}`,
    end:   `${dateStr}T${fmt(endMin)}`,
    backgroundColor: colour,
    borderColor: colour,
    extendedProps: { slot },
  }
}

export default function TimetablePage() {
  const loc           = useLocation()
  const calRef        = useRef<any>(null)
  const [timetables,  setTimetables]  = useState<any[]>([])
  const [selTtId,     setSelTtId]     = useState<number | null>((loc.state as any)?.ttId ?? null)
  const [tt,          setTt]          = useState<Timetable | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [filterSec,   setFilterSec]   = useState<string>('all')
  const [selSlot,     setSelSlot]     = useState<Slot | null>(null)
  const [subs,        setSubs]        = useState<any[]>([])
  const [institutions,setInstitutions]= useState<any[]>([])
  const [selInst,     setSelInst]     = useState<number | null>(null)

  useEffect(() => {
    API.getInstitutions().then(d => {
      setInstitutions(d)
      if (d.length) setSelInst(d[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selInst) return
    API.listTimetables(selInst).then(setTimetables)
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
  const startTime  = inst?.start_time || '09:00'
  const periodDur  = inst?.period_duration_minutes || 50

  const sections = Array.from(new Set((tt?.slots || []).map(s => s.section_name).filter(Boolean)))

  const filteredSlots = (tt?.slots || []).filter(s =>
    filterSec === 'all' || s.section_name === filterSec
  )

  const events = filteredSlots.map(s => slotToEvent(s, startTime, periodDur))

  const handleEventClick = async (info: any) => {
    const slot = info.event.extendedProps.slot as Slot
    setSelSlot(slot)
    if (selTtId) {
      const candidates = await API.findSubstitutes(selTtId, slot.id).catch(() => [])
      setSubs(candidates)
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
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Timetable</h1>
          <p className="text-slate-400 text-sm mt-0.5">Interactive schedule grid with slot management</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selTtId && (
            <>
              <a
                href={API.exportExcel(selTtId)}
                className="btn-secondary"
                download
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Excel
              </a>
              <a
                href={API.exportPdf(selTtId)}
                className="btn-secondary"
                download
              >
                <FileText className="w-4 h-4 text-red-400" /> PDF
              </a>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="glass p-4 flex gap-3 flex-wrap items-end">
        <div>
          <label className="label">Institution</label>
          <select className="select w-44"
            value={selInst ?? ''} onChange={e => setSelInst(Number(e.target.value))}>
            <option value="" disabled>Institution…</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Timetable</label>
          <select className="select w-56"
            value={selTtId ?? ''} onChange={e => setSelTtId(Number(e.target.value))}>
            <option value="" disabled>Select timetable…</option>
            {timetables.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Filter Section</label>
          <select className="select w-36"
            value={filterSec} onChange={e => setFilterSec(e.target.value)}>
            <option value="all">All Sections</option>
            {sections.map(s => <option key={s} value={s!}>{s}</option>)}
          </select>
        </div>
        {tt && (
          <div className="ml-auto flex items-center gap-3">
            {tt.violations.length > 0
              ? <span className="badge-red"><AlertTriangle className="w-3 h-3"/>{tt.violations.length} conflict(s)</span>
              : <span className="badge-green"><CheckCircle2 className="w-3 h-3"/>Conflict-free</span>}
            <span className="text-xs text-slate-500">{tt.slots.length} slots · {tt.solve_time}s</span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs flex-wrap">
        {Object.entries(COLOURS).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded" style={{ background: v }} />
            <span className="text-slate-400 capitalize">{k}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-5">
        {/* Calendar */}
        <div className={clsx('glass p-4 flex-1 min-w-0', loading && 'opacity-50 pointer-events-none')}>
          {loading && (
            <div className="flex items-center justify-center py-20">
              <span className="spinner w-8 h-8" />
            </div>
          )}
          {!loading && tt && (
            <FullCalendar
              ref={calRef}
              plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
              initialView="timeGridWeek"
              headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' }}
              events={events}
              eventClick={handleEventClick}
              slotMinTime="08:00:00"
              slotMaxTime="18:00:00"
              slotDuration="00:50:00"
              allDaySlot={false}
              weekends={true}
              height="auto"
              eventContent={(info) => (
                <div className="p-1 text-white leading-tight overflow-hidden h-full">
                  {info.event.title.split('\n').map((l, i) => (
                    <div key={i} className={clsx(i === 0 && 'font-semibold', i > 0 && 'opacity-75 text-[10px]')}>
                      {l}
                    </div>
                  ))}
                </div>
              )}
            />
          )}
          {!loading && !tt && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-500">
              <Filter className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Select an institution and timetable to view the schedule</p>
            </div>
          )}
        </div>

        {/* Slot detail panel */}
        {selSlot && (
          <div className="w-72 shrink-0 space-y-3 animate-slide-up">
            <div className="glass p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-200 text-sm">Slot Details</h3>
                <button className="btn-ghost p-1" onClick={() => setSelSlot(null)}>✕</button>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="label">Course</span>
                  <p className="text-slate-200 font-medium">{selSlot.course_name}</p>
                </div>
                <div>
                  <span className="label">Faculty</span>
                  <p className="text-slate-200">{selSlot.faculty_name}</p>
                </div>
                <div>
                  <span className="label">Room</span>
                  <p className="text-slate-200">{selSlot.room_name || 'TBD'}</p>
                </div>
                <div>
                  <span className="label">Time</span>
                  <p className="text-slate-200">{DAYS[selSlot.day]} · Period {selSlot.period + 1}
                    {selSlot.duration > 1 ? `–${selSlot.period + selSlot.duration}` : ''}
                  </p>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {selSlot.slot_type === 'lab'      && <span className="badge-green">Lab</span>}
                  {selSlot.is_combined               && <span className="badge-amber">Combined</span>}
                  {selSlot.is_locked                 && <span className="badge-blue">Locked</span>}
                  {selSlot.is_modified               && <span className="badge-red">Modified</span>}
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  className={clsx('btn-secondary flex-1 text-xs', selSlot.is_locked && 'border-brand-500 text-brand-300')}
                  onClick={() => lockSlot(selSlot.id)}
                >
                  {selSlot.is_locked ? <><Lock className="w-3 h-3"/>Locked</> : <><LockOpen className="w-3 h-3"/>Lock</>}
                </button>
              </div>
            </div>

            {/* Substitutes */}
            {subs.length > 0 && (
              <div className="glass p-4">
                <h3 className="font-semibold text-slate-200 text-sm mb-3">Available Substitutes</h3>
                <div className="space-y-2">
                  {subs.map((s: any) => (
                    <div key={s.faculty_id} className="glass-sm p-2.5 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">{s.faculty_name}</p>
                        {s.subject_match && <span className="badge-green text-[10px]">Subject match</span>}
                      </div>
                      <button
                        className="btn-success text-xs py-1 px-2 shrink-0"
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

      {/* Violations */}
      {tt && tt.violations.length > 0 && (
        <div className="glass p-4 border border-red-500/20">
          <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Constraint Violations
          </h3>
          <div className="space-y-2">
            {tt.violations.map((v, i) => (
              <div key={i} className="glass-sm p-3">
                <p className="text-xs font-semibold text-slate-300">{v.type}</p>
                <p className="text-xs text-slate-400 mt-0.5">{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
