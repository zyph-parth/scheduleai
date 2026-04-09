import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API, type TimetableMeta, type Institution } from '../api/client'
import toast from 'react-hot-toast'
import {
  Sparkles, Zap, Clock, CheckCircle2, AlertCircle,
  ChevronRight, Plus, Trash2, RefreshCw, Calendar
} from 'lucide-react'
import clsx from 'clsx'

const STATUS_BADGE: Record<string, string> = {
  done:       'badge-green',
  optimal:    'badge-green',
  feasible:   'badge-blue',
  infeasible: 'badge-red',
  error:      'badge-red',
  pending:    'badge-slate',
  generating: 'badge-amber',
}

const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

export default function Dashboard() {
  const navigate = useNavigate()
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [timetables,   setTimetables]   = useState<TimetableMeta[]>([])
  const [selInst,      setSelInst]      = useState<number | null>(null)
  const [generating,   setGenerating]   = useState(false)
  const [ttName,       setTtName]       = useState('Semester 5 Timetable')

  const loadInstitutions = async () => {
    try {
      const data = await API.getInstitutions()
      setInstitutions(data)
      if (data.length && !selInst) setSelInst(data[0].id)
    } catch { toast.error('Failed to load institutions') }
  }

  const loadTimetables = async (instId: number) => {
    try {
      const data = await API.listTimetables(instId)
      setTimetables(data)
    } catch {}
  }

  useEffect(() => { loadInstitutions() }, [])
  useEffect(() => { if (selInst) loadTimetables(selInst) }, [selInst])

  const generate = async () => {
    if (!selInst) return toast.error('Select an institution')
    setGenerating(true)
    const t = toast.loading('Generating timetable… (this may take up to 60s)')
    try {
      const res = await API.generateTimetable({
        institution_id: selInst, name: ttName, max_solve_seconds: 60
      })
      toast.dismiss(t)
      if (res.status === 'done' || res.status === 'optimal' || res.status === 'feasible') {
        toast.success(`Generated! ${res.num_slots} slots in ${res.solve_time}s`)
        loadTimetables(selInst)
      } else {
        toast.error(`Solver returned: ${res.status}`)
      }
    } catch (e: any) {
      toast.dismiss(t)
      toast.error(e?.response?.data?.detail || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const deleteTt = async (id: number) => {
    if (!confirm('Delete this timetable?')) return
    await API.deleteTimetable(id)
    if (selInst) loadTimetables(selInst)
    toast.success('Deleted')
  }

  const inst = institutions.find(i => i.id === selInst)

  // Stats
  const stats = [
    { label: 'Timetables Generated', value: timetables.length, icon: Calendar, color: 'text-brand-400' },
    { label: 'Conflict-Free',         value: timetables.filter(t=>t.status==='done').length, icon: CheckCircle2, color: 'text-emerald-400' },
    { label: 'Avg Solve Time (s)',     value: timetables.length ? (timetables.reduce((a,b)=>a+b.solve_time,0)/timetables.length).toFixed(1) : '—', icon: Clock, color: 'text-amber-400' },
    { label: 'Working Days',           value: inst?.working_days.length ?? '—', icon: Zap, color: 'text-blue-400' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">Schedule Intelligence Platform</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/setup')}>
          <Plus className="w-4 h-4" /> New Setup
        </button>
      </div>

      {/* Hero card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900 via-brand-950 to-surface p-6 border border-brand-800/50 glow-brand">
        <div className="absolute top-0 right-0 w-64 h-64 bg-brand-600/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="relative z-10 flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-brand-400" />
              <span className="text-brand-300 text-xs font-semibold uppercase tracking-widest">
                AI-Powered Scheduling
              </span>
            </div>
            <h2 className="text-2xl font-bold text-slate-50 mb-2">
              Conflict-free timetables in under 60 seconds
            </h2>
            <p className="text-slate-400 text-sm max-w-lg">
              Our OR-Tools CP-SAT solver handles all hard constraints — no faculty double-booking,
              no room conflicts, consecutive lab periods, combined sections — guaranteed.
            </p>
          </div>
          <div className="shrink-0 flex flex-col gap-2 w-72">
            {/* Institution selector */}
            <select
              className="select"
              value={selInst ?? ''}
              onChange={e => setSelInst(Number(e.target.value))}
            >
              <option value="" disabled>Select institution…</option>
              {institutions.map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Timetable name"
              value={ttName}
              onChange={e => setTtName(e.target.value)}
            />
            <button
              className="btn-primary w-full justify-center py-3"
              onClick={generate}
              disabled={generating || !selInst}
            >
              {generating
                ? <><span className="spinner w-4 h-4" /> Generating…</>
                : <><Sparkles className="w-4 h-4" /> Generate Timetable</>}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="stat-label">{s.label}</span>
              <s.icon className={clsx('w-4 h-4', s.color)} />
            </div>
            <span className="stat-value">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Institution info */}
      {inst && (
        <div className="glass p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">
            {inst.name} — Schedule Configuration
          </h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="label">Working Days</p>
              <div className="flex gap-1 flex-wrap">
                {inst.working_days.map(d => (
                  <span key={d} className="badge-blue">{DAY_LABELS[d]}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Start Time</p>
              <p className="text-slate-200 font-medium">{inst.start_time}</p>
            </div>
            <div>
              <p className="label">Period Duration</p>
              <p className="text-slate-200 font-medium">{inst.period_duration_minutes} min</p>
            </div>
          </div>
        </div>
      )}

      {/* Timetable list */}
      <div className="glass p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300">Generated Timetables</h3>
          <button className="btn-ghost text-xs" onClick={() => selInst && loadTimetables(selInst)}>
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {timetables.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No timetables yet. Generate one above.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Semester</th>
                  <th>Status</th>
                  <th>Slots</th>
                  <th>Solve Time</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {timetables.map(tt => (
                  <tr key={tt.id} className="cursor-pointer" onClick={() => navigate('/timetable', {state:{ttId:tt.id}})}>
                    <td className="font-medium text-slate-200">{tt.name}</td>
                    <td>{tt.semester || '—'}</td>
                    <td>
                      <span className={STATUS_BADGE[tt.status] || 'badge-slate'}>
                        {tt.status === 'done' ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {tt.status}
                      </span>
                    </td>
                    <td>{tt.slot_count}</td>
                    <td>{tt.solve_time}s</td>
                    <td className="text-slate-500 text-xs">{new Date(tt.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button className="btn-icon" onClick={() => navigate('/timetable', {state:{ttId:tt.id}})}>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button className="btn-icon text-red-400 hover:text-red-300" onClick={() => deleteTt(tt.id)}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
