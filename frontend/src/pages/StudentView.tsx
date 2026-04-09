import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API, type Slot } from '../api/client'
import { GraduationCap, Clock, User, DoorOpen, BookOpen } from 'lucide-react'
import clsx from 'clsx'

const DAY_LABELS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const TYPE_COLOUR: Record<string, string> = {
  theory: 'bg-brand-600/80',
  lab:    'bg-emerald-600/80',
  break:  'bg-amber-500/80',
}

export default function StudentView() {
  const { ttId: ttIdParam } = useParams()
  const [institutions, setInstitutions] = useState<any[]>([])
  const [timetables,   setTimetables]   = useState<any[]>([])
  const [selInst,      setSelInst]      = useState<number | null>(null)
  const [selTtId,      setSelTtId]      = useState<number | null>(ttIdParam ? Number(ttIdParam) : null)
  const [selSection,   setSelSection]   = useState<string>('')
  const [tt,           setTt]           = useState<any>(null)

  useEffect(() => {
    API.getInstitutions().then(d => { setInstitutions(d); if (d.length) setSelInst(d[0].id) })
  }, [])
  useEffect(() => {
    if (!selInst) return
    API.listTimetables(selInst).then(d => {
      setTimetables(d)
      const done = d.find((t: any) => t.status === 'done')
      if (done && !selTtId) setSelTtId(done.id)
    })
  }, [selInst])
  useEffect(() => {
    if (!selTtId) return
    API.getTimetable(selTtId).then(setTt)
  }, [selTtId])

  const sections = Array.from(new Set((tt?.slots || []).map((s: Slot) => s.section_name).filter(Boolean))) as string[]
  const activeSection = selSection || sections[0] || ''

  // Filter slots for selected section, group by day
  const sectionSlots: Slot[] = (tt?.slots || []).filter(
    (s: Slot) => s.section_name === activeSection
  )

  const workingDays = Array.from(new Set(sectionSlots.map(s => s.day))).sort()

  const inst = institutions.find(i => i.id === selInst)
  const startTime   = inst?.start_time || '09:00'
  const periodDur   = inst?.period_duration_minutes || 50

  function periodToTime(p: number) {
    const [h, m] = startTime.split(':').map(Number)
    const total = h * 60 + m + p * periodDur
    const hh = Math.floor(total / 60).toString().padStart(2,'0')
    const mm  = (total % 60).toString().padStart(2,'0')
    return `${hh}:${mm}`
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Top bar */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-100">ScheduleAI</p>
            <p className="text-[10px] text-slate-500">Student Timetable</p>
          </div>
        </div>

        <div className="flex gap-3 ml-auto flex-wrap">
          <select className="select w-40 text-xs" value={selInst ?? ''} onChange={e => setSelInst(Number(e.target.value))}>
            <option value="" disabled>Institution…</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <select className="select w-48 text-xs" value={selTtId ?? ''} onChange={e => setSelTtId(Number(e.target.value))}>
            <option value="" disabled>Timetable…</option>
            {timetables.filter((t:any) => t.status === 'done').map((t:any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* Section tabs */}
        {sections.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {sections.map(s => (
              <button
                key={s}
                onClick={() => setSelSection(s)}
                className={clsx(
                  'btn text-sm py-2 px-4',
                  s === activeSection ? 'btn-primary' : 'btn-secondary'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Timetable grid */}
        {sectionSlots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500">
            <BookOpen className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Select a section to view the timetable</p>
          </div>
        ) : (
          <div className="space-y-4">
            {workingDays.map(day => {
              const daySlots = sectionSlots
                .filter(s => s.day === day)
                .sort((a, b) => a.period - b.period)
              return (
                <div key={day} className="glass overflow-hidden">
                  <div className="px-5 py-3 bg-surface-1 border-b border-slate-700">
                    <h3 className="font-semibold text-slate-200 text-sm">{DAY_LABELS[day]}</h3>
                  </div>
                  <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {daySlots.map(slot => (
                      <div
                        key={slot.id}
                        className={clsx(
                          'rounded-xl p-3 text-white',
                          TYPE_COLOUR[slot.slot_type] || TYPE_COLOUR.theory
                        )}
                      >
                        <p className="font-semibold text-sm leading-tight">{slot.course_name}</p>
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center gap-1.5 text-xs text-white/80">
                            <Clock className="w-3 h-3 shrink-0" />
                            {periodToTime(slot.period)}
                            {slot.duration > 1 && ` – ${periodToTime(slot.period + slot.duration)}`}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-white/80">
                            <User className="w-3 h-3 shrink-0" />
                            {slot.faculty_name || '—'}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-white/80">
                            <DoorOpen className="w-3 h-3 shrink-0" />
                            {slot.room_name || 'TBD'}
                          </div>
                        </div>
                        {slot.slot_type === 'lab' && (
                          <span className="mt-2 inline-block text-[10px] font-bold bg-white/20 rounded px-1.5 py-0.5">
                            LAB · {slot.duration} periods
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
