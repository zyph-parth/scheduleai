import { useEffect, useState } from 'react'
import { API, getErrorMessage } from '../api/client'
import toast from 'react-hot-toast'
import {
  Zap, User, CalendarX, ArrowRight, CheckCircle2,
  AlertTriangle, Diff, Clock, MessageCircle
} from 'lucide-react'
import clsx from 'clsx'

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

export default function WhatIf() {
  const [institutions, setInstitutions] = useState<any[]>([])
  const [timetables,   setTimetables]   = useState<any[]>([])
  const [faculty,      setFaculty]      = useState<any[]>([])
  const [selInst,      setSelInst]      = useState<number | null>(null)
  const [selTtId,      setSelTtId]      = useState<number | null>(null)
  const [selFac,       setSelFac]       = useState<number | null>(null)
  const [selDays,      setSelDays]      = useState<number[]>([])
  const [loading,      setLoading]      = useState(false)
  const [sending,      setSending]      = useState(false)
  const [result,       setResult]       = useState<any>(null)
  const [crNumber,     setCrNumber]     = useState('')
  const [taNumber,     setTaNumber]     = useState('')

  useEffect(() => { API.getInstitutions().then(d => { setInstitutions(d); if (d.length) setSelInst(d[0].id) }) }, [])
  useEffect(() => {
    if (!selInst) return
    API.listTimetables(selInst).then(setTimetables)
    API.getFaculty(selInst).then(setFaculty)
  }, [selInst])

  const toggleDay = (d: number) =>
    setSelDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])

  const run = async () => {
    if (!selTtId || !selFac) return toast.error('Select a timetable and faculty member')
    setLoading(true)
    setResult(null)
    const t = toast.loading('Running what-if analysis…')
    try {
      const res = await API.whatIf({
        timetable_id: selTtId,
        absent_faculty_id: selFac,
        affected_days: selDays,
      })
      toast.dismiss(t)
      setResult(res)
      if (res.status === 'done' || res.status === 'optimal' || res.status === 'feasible') {
        toast.success(
          `Done! ${res.substituted_count ?? 0} substitute(s), ${res.break_count ?? 0} break(s) in ${res.solve_time}s`
        )
      } else {
        toast.error(`Status: ${res.status}`)
      }
    } catch (e: any) {
      toast.dismiss(t)
      toast.error(e?.response?.data?.detail || 'What-If failed')
    } finally {
      setLoading(false)
    }
  }

  const modifiedSlots = (result?.slots || []).filter((s: any) => s.is_modified)
  const stableSlots   = (result?.slots || []).filter((s: any) => !s.is_modified)
  const selectedFac   = faculty.find(f => f.id === selFac)
  const selectedTt    = timetables.find(t => t.id === selTtId)

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
      `- ${slot.section_name}: ${slot.course_name} on ${DAYS[slot.day] || `Day ${slot.day + 1}`} P${slot.period + 1} with ${slot.faculty_name}`
    )

    if (modifiedSlots.length > 5) {
      slotLines.push(`- ${modifiedSlots.length - 5} more updated slot(s)`)
    }

    return [...intro, '', 'Changed slots:', ...(slotLines.length ? slotLines : ['- No slot changes'])].join('\n')
  }

  const sendWhatsApp = async () => {
    if (!result) return toast.error('Run what-if first')
    if (!selectedFac) return toast.error('Select a faculty member first')
    if (!crNumber.trim() && !taNumber.trim()) return toast.error('Enter at least one mobile number')

    setSending(true)
    const t = toast.loading('Sending WhatsApp message…')
    try {
      const numbers = [
        { label: 'CR', value: crNumber.trim() },
        { label: 'TA', value: taNumber.trim() },
      ].filter((entry) => entry.value)

      const results = await Promise.allSettled(
        numbers.map(async (entry) => ({
          ...entry,
          sid: (
            await API.sendWhatsApp({
              to_number: entry.value,
              message: buildWhatsAppMessage(),
            })
          ).sid,
        }))
      )

      const successes = results
        .filter((result): result is PromiseFulfilledResult<{ label: string; value: string; sid: string }> => result.status === 'fulfilled')
        .map((result) => result.value)

      const failures = results
        .map((result, index) => ({ result, entry: numbers[index] }))
        .filter((item): item is { result: PromiseRejectedResult; entry: { label: string; value: string } } => item.result.status === 'rejected')

      toast.dismiss(t)
      if (!successes.length && failures.length) {
        throw failures[0].result.reason
      }

      if (successes.length && !failures.length) {
        toast.success(
          successes.length === 1
            ? `WhatsApp sent to ${successes[0].label}${successes[0].sid ? ` (${successes[0].sid})` : ''}`
            : `WhatsApp sent to ${successes.length} recipients`
        )
        return
      }

      const failedLabels = failures.map((item) => item.entry.label).join(', ')
      toast.success(`WhatsApp sent to ${successes.map((item) => item.label).join(', ')}`)
      toast.error(`Failed for ${failedLabels}. Check that the number is valid and joined to the Twilio WhatsApp sandbox.`)
    } catch (error) {
      toast.dismiss(t)
      toast.error(getErrorMessage(error, 'Unable to send WhatsApp message'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-50 flex items-center gap-2">
          <Zap className="w-6 h-6 text-amber-400" /> What-If Analysis
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Simulate faculty absence, assign substitutes when available, and turn uncovered classes into breaks
        </p>
      </div>

      {/* Story prompt */}
      <div className="glass p-5 border border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <CalendarX className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="font-semibold text-amber-300 text-sm">Demo scenario</p>
            <p className="text-slate-400 text-sm mt-1">
              "It's the day before semester starts — Dr. Sharma just called in sick.
              Instead of rebuilding the entire timetable, mark them absent and watch
              only their slots get rescheduled in under 2 seconds."
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="glass p-5 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Institution</label>
            <select className="select" value={selInst ?? ''} onChange={e => setSelInst(Number(e.target.value))}>
              <option value="" disabled>Select…</option>
              {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Base Timetable</label>
            <select className="select" value={selTtId ?? ''} onChange={e => setSelTtId(Number(e.target.value))}>
              <option value="" disabled>Select timetable…</option>
              {timetables.filter(t => t.status === 'done').map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Absent Faculty</label>
            <select className="select" value={selFac ?? ''} onChange={e => setSelFac(Number(e.target.value))}>
              <option value="" disabled>Select faculty…</option>
              {faculty.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        {selFac && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <label className="label">CR Mobile Number</label>
              <input
                className="input"
                value={crNumber}
                onChange={e => setCrNumber(e.target.value)}
                placeholder="+919876543210"
              />
              <p className="mt-1 text-xs text-slate-500">
                The message will be sent to this WhatsApp number through your configured Twilio sender.
              </p>
            </div>
            <div>
              <label className="label">TA Mobile Number</label>
              <input
                className="input"
                value={taNumber}
                onChange={e => setTaNumber(e.target.value)}
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
                disabled={sending || !result || (!crNumber.trim() && !taNumber.trim())}
              >
                {sending
                  ? <><span className="spinner w-4 h-4" />Sending…</>
                  : <><MessageCircle className="w-4 h-4" />Send WhatsApp</>}
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="label">Affected Days (leave empty = all days)</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => toggleDay(i)}
                className={clsx(
                  'btn text-xs py-1.5 px-3',
                  selDays.includes(i)
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 border'
                    : 'btn-secondary'
                )}
              >
                {d.slice(0, 3)}
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
              ? <><span className="spinner w-4 h-4" />Regenerating…</>
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

      {/* Results */}
      {result && (
        <div className="grid grid-cols-2 gap-5">
          {/* Modified slots */}
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
                {modifiedSlots.map((s: any) => (
                  <div key={s.id} className="glass-sm p-3 border-l-2 border-red-400">
                    <p className="text-sm font-semibold text-slate-200">{s.course_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">{s.section_name}</span>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                      <span className="text-xs text-slate-400">
                        {DAYS[s.day]?.slice(0,3)} P{s.period + 1} · {s.room_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <User className="w-3 h-3 text-amber-400" />
                      <span className="text-xs text-amber-300">{s.faculty_name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stable slots summary */}
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
                {result.conflicts.map((c: any, i: number) => (
                  <div key={i} className="glass-sm p-2 border-l-2 border-red-500">
                    <p className="text-xs text-slate-400">{c.description}</p>
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
