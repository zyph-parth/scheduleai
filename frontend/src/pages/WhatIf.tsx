import { useEffect, useState } from 'react'
import { API, getErrorMessage } from '../api/client'
import toast from 'react-hot-toast'
import {
  Zap, User, CalendarX, ArrowRight, CheckCircle2,
  AlertTriangle, Diff, Clock, MessageCircle
} from 'lucide-react'
import clsx from 'clsx'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getSlotSectionBindings(slot: any): Array<{ id: number; label: string }> {
  const sectionIds = Array.isArray(slot.section_ids) && slot.section_ids.length
    ? slot.section_ids
    : slot.section_id != null
      ? [slot.section_id]
      : []
  const sectionLabels = Array.isArray(slot.section_labels) ? slot.section_labels : []

  return sectionIds.map((sectionId: number, index: number) => ({
    id: sectionId,
    label: sectionLabels[index] || (sectionIds.length === 1 ? slot.section_name || `Section ${sectionId}` : `Section ${sectionId}`),
  }))
}

function getSlotSectionLabel(slot: any) {
  const bindings = getSlotSectionBindings(slot)
  if (!bindings.length) return slot.section_name || 'Unassigned'
  return bindings.map((binding) => binding.label).join(' + ')
}

export default function WhatIf() {
  const [institutions, setInstitutions] = useState<any[]>([])
  const [timetables, setTimetables] = useState<any[]>([])
  const [faculty, setFaculty] = useState<any[]>([])
  const [selInst, setSelInst] = useState<number | null>(null)
  const [selTtId, setSelTtId] = useState<number | null>(null)
  const [selFac, setSelFac] = useState<number | null>(null)
  const [selDays, setSelDays] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [taNumber, setTaNumber] = useState('')

  useEffect(() => {
    API.getInstitutions().then((data) => {
      setInstitutions(data)
      if (data.length) setSelInst(data[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selInst) return
    API.listTimetables(selInst).then(setTimetables)
    API.getFaculty(selInst).then(setFaculty)
  }, [selInst])

  const toggleDay = (day: number) =>
    setSelDays((prev) => (prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day]))

  const run = async () => {
    if (!selTtId || !selFac) return toast.error('Select a timetable and faculty member')
    setLoading(true)
    setResult(null)
    const loadingToast = toast.loading('Running what-if analysis...')
    try {
      const response = await API.whatIf({
        timetable_id: selTtId,
        absent_faculty_id: selFac,
        affected_days: selDays,
      })
      toast.dismiss(loadingToast)
      setResult(response)
      if (response.status === 'done' || response.status === 'optimal' || response.status === 'feasible') {
        toast.success(
          `Done! ${response.substituted_count ?? 0} substitute(s), ${response.break_count ?? 0} break(s) in ${response.solve_time}s`
        )
      } else {
        toast.error(`Status: ${response.status}`)
      }
    } catch (error: any) {
      toast.dismiss(loadingToast)
      toast.error(error?.response?.data?.detail || 'What-If failed')
    } finally {
      setLoading(false)
    }
  }

  const modifiedSlots = (result?.slots || []).filter((slot: any) => slot.is_modified)
  const stableSlots = (result?.slots || []).filter((slot: any) => !slot.is_modified)
  const selectedFac = faculty.find((item) => item.id === selFac)
  const selectedTt = timetables.find((item) => item.id === selTtId)
  const affectedSections: Array<{ id: number; label: string }> = []

  for (const slot of modifiedSlots as any[]) {
    for (const binding of getSlotSectionBindings(slot)) {
      if (!affectedSections.some((section) => section.id === binding.id)) {
        affectedSections.push(binding)
      }
    }
  }

  const buildWhatsAppMessage = () => {
    if (!result || !selectedFac) return ''

    const intro = [
      'ScheduleAI update',
      `Absent faculty: ${selectedFac.name}`,
      `Timetable: ${selectedTt?.name || `#${selTtId}`}`,
      `Status: ${result.status}`,
      `Updated slots: ${result.modified_count ?? modifiedSlots.length}`,
      `Substitutes: ${result.substituted_count ?? 0}`,
      `Breaks: ${result.break_count ?? 0}`,
    ]

    const slotLines = modifiedSlots.slice(0, 5).map((slot: any) =>
      `- ${getSlotSectionLabel(slot)}: ${slot.course_name} on ${DAYS[slot.day] || `Day ${slot.day + 1}`} P${slot.period + 1} with ${slot.faculty_name}`
    )

    if (modifiedSlots.length > 5) {
      slotLines.push(`- ${modifiedSlots.length - 5} more updated slot(s)`)
    }

    const recipients = affectedSections.length
      ? [`Affected sections: ${affectedSections.map((section) => section.label).join(', ')}`]
      : ['Affected sections: none']

    return [...intro, ...recipients, '', 'Changed slots:', ...(slotLines.length ? slotLines : ['- No slot changes'])].join('\n')
  }

  const sendWhatsApp = async () => {
    if (!result) return toast.error('Run what-if first')
    if (!selectedFac) return toast.error('Select a faculty member first')
    if (!affectedSections.length && !taNumber.trim()) {
      return toast.error('No affected sections or TA number available to notify')
    }

    setSending(true)
    const loadingToast = toast.loading('Sending WhatsApp updates...')
    try {
      const jobs: Array<{ label: string; run: () => Promise<string> }> = []

      if (affectedSections.length) {
        jobs.push({
          label: 'sections',
          run: async () => {
            const response = await API.sendWhatsAppToSections({
              section_ids: affectedSections.map((section) => section.id),
              message: buildWhatsAppMessage(),
            })
            if (response.sent_count > 0) {
              return `Sections notified: ${response.sent_count} sent${response.skipped_count ? `, ${response.skipped_count} skipped` : ''}`
            }
            throw new Error(response.skipped[0]?.reason || 'No section notifications were sent')
          },
        })
      }

      if (taNumber.trim()) {
        jobs.push({
          label: 'TA',
          run: async () => {
            const response = await API.sendWhatsApp({
              to_number: taNumber.trim(),
              message: buildWhatsAppMessage(),
            })
            return `TA notified${response.sid ? ` (${response.sid})` : ''}`
          },
        })
      }

      const results = await Promise.allSettled(jobs.map((job) => job.run()))
      const successes: string[] = []
      const failures: string[] = []

      results.forEach((resultItem, index) => {
        if (resultItem.status === 'fulfilled') {
          successes.push(resultItem.value)
        } else {
          failures.push(`${jobs[index].label}: ${getErrorMessage(resultItem.reason, 'delivery failed')}`)
        }
      })

      toast.dismiss(loadingToast)
      if (!successes.length && failures.length) {
        throw new Error(failures.join(' | '))
      }
      if (successes.length) {
        toast.success(successes.join(' | '))
      }
      if (failures.length) {
        toast.error(failures.join(' | '))
      }
    } catch (error) {
      toast.dismiss(loadingToast)
      toast.error(getErrorMessage(error, 'Unable to notify affected sections'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-50 flex items-center gap-2">
          <Zap className="w-6 h-6 text-amber-400" /> What-If Analysis
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Simulate faculty absence, assign substitutes when available, and turn uncovered classes into breaks
        </p>
      </div>

      <div className="glass p-5 border border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <CalendarX className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="font-semibold text-amber-300 text-sm">Demo scenario</p>
            <p className="text-slate-400 text-sm mt-1">
              "It&apos;s the day before semester starts - Dr. Sharma just called in sick.
              Instead of rebuilding the entire timetable, mark them absent and watch
              only their slots get rescheduled in under 2 seconds."
            </p>
          </div>
        </div>
      </div>

      <div className="glass p-5 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Institution</label>
            <select className="select" value={selInst ?? ''} onChange={(event) => setSelInst(Number(event.target.value))}>
              <option value="" disabled>Select...</option>
              {institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Base Timetable</label>
            <select className="select" value={selTtId ?? ''} onChange={(event) => setSelTtId(Number(event.target.value))}>
              <option value="" disabled>Select timetable...</option>
              {timetables.filter((timetable) => ['done', 'optimal', 'feasible'].includes(timetable.status)).map((timetable) => (
                <option key={timetable.id} value={timetable.id}>{timetable.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Absent Faculty</label>
            <select className="select" value={selFac ?? ''} onChange={(event) => setSelFac(Number(event.target.value))}>
              <option value="" disabled>Select faculty...</option>
              {faculty.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </div>
        </div>

        {selFac && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <label className="label">Section Notifications</label>
              <div className="input min-h-[46px] flex flex-wrap gap-2 items-center">
                {affectedSections.length > 0 ? (
                  affectedSections.map((section) => (
                    <span key={section.id} className="badge badge-amber">
                      {section.label}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500 text-sm">Run the what-if flow to identify affected sections automatically.</span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Messages will be sent to each section&apos;s saved class representative WhatsApp number from Setup.
              </p>
            </div>
            <div>
              <label className="label">TA Mobile Number</label>
              <input
                className="input"
                value={taNumber}
                onChange={(event) => setTaNumber(event.target.value)}
                placeholder="+919876543210"
              />
              <p className="mt-1 text-xs text-slate-500">
                Add the TA WhatsApp number to send the same update there as well.
              </p>
            </div>
            <div className="flex items-end">
              <button
                className="btn-secondary py-3 px-5"
                onClick={sendWhatsApp}
                disabled={sending || !result || (!affectedSections.length && !taNumber.trim())}
              >
                {sending
                  ? <><span className="spinner w-4 h-4" />Sending...</>
                  : <><MessageCircle className="w-4 h-4" />Send Updates</>}
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="label">Affected Days (leave empty = all days)</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((day, index) => (
              <button
                key={day}
                onClick={() => toggleDay(index)}
                className={clsx(
                  'btn text-xs py-1.5 px-3',
                  selDays.includes(index)
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 border'
                    : 'btn-secondary'
                )}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            className="btn-primary py-3 px-6"
            onClick={run}
            disabled={loading || !selTtId || !selFac}
          >
            {loading
              ? <><span className="spinner w-4 h-4" />Regenerating...</>
              : <><Zap className="w-4 h-4" />Run What-If</>}
          </button>
          {result && (
            <div className="flex items-center gap-3">
              <span className={clsx(
                'badge',
                result.status === 'done' || result.status === 'feasible'
                  ? 'badge-green' : 'badge-red'
              )}>
                {result.status === 'done' || result.status === 'feasible'
                  ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {result.status}
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Clock className="w-3 h-3" />{result.solve_time}s
              </span>
              <span className="badge-amber">
                <Diff className="w-3 h-3" />
                {result.modified_count} slot(s) changed
              </span>
              <span className="badge">
                {result.substituted_count ?? 0} substitutes, {result.break_count ?? 0} breaks
              </span>
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-2 gap-5">
          <div className="glass p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <h3 className="font-semibold text-slate-200 text-sm">
                Rescheduled Slots ({modifiedSlots.length})
              </h3>
            </div>
            {modifiedSlots.length === 0 ? (
              <p className="text-slate-500 text-sm">No slots were rescheduled.</p>
            ) : (
              <div className="space-y-2">
                {modifiedSlots.map((slot: any) => (
                  <div key={slot.id} className="glass-sm p-3 border-l-2 border-red-400">
                    <p className="text-sm font-semibold text-slate-200">{slot.course_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">{getSlotSectionLabel(slot)}</span>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                      <span className="text-xs text-slate-400">
                        {DAYS[slot.day]?.slice(0, 3)} P{slot.period + 1} - {slot.room_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <User className="w-3 h-3 text-amber-400" />
                      <span className="text-xs text-amber-300">{slot.faculty_name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-emerald-400" />
              <h3 className="font-semibold text-slate-200 text-sm">
                Unchanged Slots ({stableSlots.length})
              </h3>
            </div>
            <div className="glass-sm p-4 text-center">
              <p className="text-4xl font-bold text-emerald-400 mb-1">{stableSlots.length}</p>
              <p className="text-xs text-slate-400">slots preserved exactly</p>
              <p className="text-xs text-slate-500 mt-2">
                Only {modifiedSlots.length} slot(s) ({Math.round(modifiedSlots.length / Math.max(result.slots.length, 1) * 100)}%) were touched.
              </p>
            </div>

            {result.conflicts.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-red-400">Conflicts:</p>
                {result.conflicts.map((conflict: any, index: number) => (
                  <div key={index} className="glass-sm p-2 border-l-2 border-red-500">
                    <p className="text-xs text-slate-400">{conflict.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
