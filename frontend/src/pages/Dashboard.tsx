import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API, type TimetableMeta, type Institution } from '../api/client'
import toast from 'react-hot-toast'

// ─── Status badge map ────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, { cls: string; label: string }> = {
  done:       { cls: 'bg-green-100 text-green-800',  label: 'READY'      },
  optimal:    { cls: 'bg-green-100 text-green-800',  label: 'READY'      },
  feasible:   { cls: 'bg-blue-100 text-blue-800',    label: 'FEASIBLE'   },
  infeasible: { cls: 'bg-red-100 text-red-800',      label: 'ERROR'      },
  error:      { cls: 'bg-red-100 text-red-800',      label: 'ERROR'      },
  pending:    { cls: 'bg-slate-100 text-slate-600',  label: 'DRAFT'      },
  generating: { cls: 'bg-amber-100 text-amber-800',  label: 'GENERATING' },
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Inline styles (no Tailwind dependency for new tokens) ───────────────────
const fontImport = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap');
`

export default function Dashboard() {
  const navigate = useNavigate()
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [timetables,   setTimetables]   = useState<TimetableMeta[]>([])
  const [selInst,      setSelInst]      = useState<number | null>(null)
  const [generating,   setGenerating]   = useState(false)
  const [ttName,       setTtName]       = useState('')

  const loadInstitutions = async () => {
    try {
      const data = await API.getInstitutions()
      setInstitutions(data)
      if (data.length && !selInst) setSelInst(data[0].id)
    } catch { toast.error('Failed to load institutions') }
  }

  const loadTimetables = async (instId: number) => {
    try {
      setTimetables(await API.listTimetables(instId))
    } catch {
      toast.error('Failed to load timetables')
    }
  }

  useEffect(() => { loadInstitutions() }, [])
  useEffect(() => { if (selInst) loadTimetables(selInst) }, [selInst])

  const generate = async () => {
    if (!selInst) return toast.error('Select an institution')
    setGenerating(true)
    const t = toast.loading('Generating timetable… (this may take up to 60s)')
    try {
      const res = await API.generateTimetable({
        institution_id: selInst, name: ttName || 'Untitled Timetable', max_solve_seconds: 60,
      })
      toast.dismiss(t)
      if (['done', 'optimal', 'feasible'].includes(res.status)) {
        toast.success(`Generated! ${res.num_slots} slots in ${res.solve_time}s`)
        loadTimetables(selInst)
      } else {
        toast.error(`Solver returned: ${res.status}`)
      }
    } catch (e: any) {
      toast.dismiss(t)
      toast.error(e?.response?.data?.detail || 'Generation failed')
    } finally { setGenerating(false) }
  }

  const deleteTt = async (id: number) => {
    if (!confirm('Delete this timetable?')) return
    try {
      await API.deleteTimetable(id)
      if (selInst) loadTimetables(selInst)
      toast.success('Deleted')
    } catch {
      toast.error('Failed to delete timetable')
    }
  }

  const inst = institutions.find(i => i.id === selInst)

  const conflictFreeCount = timetables.filter(
    t => t.status === 'done' || t.status === 'optimal' || t.status === 'feasible'
  ).length
  const conflictFreePct   = timetables.length
    ? ((conflictFreeCount / timetables.length) * 100).toFixed(1) + '%'
    : '—'
  const avgSolve = timetables.length
    ? (timetables.reduce((a, b) => a + b.solve_time, 0) / timetables.length).toFixed(1) + 's'
    : '—'

  const stats = [
    { label: 'Timetables Generated', value: timetables.length.toLocaleString(), sub: '+0%' },
    { label: 'Conflict-Free %',       value: conflictFreePct,                    sub: 'Target 100%' },
    { label: 'Avg Solve Time',        value: avgSolve,                           sub: '' },
    { label: 'Active Working Days',   value: inst?.working_days.length ?? '—',   sub: 'Configured calendar' },
  ]

  return (
    <>
      {/* Font injection */}
      <style>{fontImport}{`
        .dash-root { font-family: 'Inter', sans-serif; color: #2a3439; }
        .dash-root h1, .dash-root h2, .dash-root h3, .dash-root h4 { font-family: 'Manrope', sans-serif; }
        .ms { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal;
              font-size: 20px; line-height: 1; letter-spacing: normal; text-transform: none;
              display: inline-block; white-space: nowrap; word-wrap: normal; direction: ltr;
              -webkit-font-feature-settings: 'liga'; font-feature-settings: 'liga'; -webkit-font-smoothing: antialiased; }
        .status-badge { font-size: 10px; font-weight: 800; letter-spacing: .08em; padding: 2px 8px; }
        .btn-primary-dash { background: #0053db; color: #fff; font-family: 'Manrope', sans-serif;
                            font-weight: 700; font-size: 13px; letter-spacing: .05em; padding: 10px 24px;
                            border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .btn-primary-dash:hover { background: #0048c1; }
        .btn-primary-dash:disabled { opacity: .5; cursor: not-allowed; }
        .btn-ghost-dash { background: transparent; border: 1px solid #cbd5e1; color: #475569;
                          font-size: 10px; font-weight: 800; letter-spacing: .1em; padding: 10px 0;
                          cursor: pointer; width: 100%; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .btn-ghost-dash:hover { background: #f8fafc; }
        .stat-card { background: #fff; border: 1px solid rgba(169,180,185,.3); padding: 24px;
                     display: flex; flex-direction: column; justify-content: space-between; height: 128px; }
        .table-row:hover { background: rgba(248,250,252,.8); }
        .input-field { border: 1px solid rgba(169,180,185,.5); padding: 10px 16px; font-size: 14px;
                       font-family: 'Inter', sans-serif; width: 100%; outline: none; background: #fff; }
        .input-field:focus { border-color: #0053db; }
        .label-xs { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;
                    letter-spacing: .1em; margin-bottom: 6px; display: block; }
        .section-card { background: #fff; border: 1px solid rgba(169,180,185,.3); }
        .icon-btn { background: none; border: none; cursor: pointer; color: #94a3b8; padding: 2px; }
        .icon-btn:hover { color: #0053db; }
        .icon-btn.red:hover { color: #ef4444; }
        .pulse { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; display: inline-block;
                 animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .dash-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 32px; gap: 16px; }
        .dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 32px; }
        .dash-hero { display: grid; grid-template-columns: 5fr 7fr; margin-bottom: 32px; overflow: hidden; }
        .dash-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
        .dash-bottom { display: grid; grid-template-columns: 9fr 3fr; gap: 32px; align-items: start; }

        @media (max-width: 1200px) {
          .dash-bottom { grid-template-columns: 1fr; }
        }

        @media (max-width: 960px) {
          .dash-stats { grid-template-columns: repeat(2, 1fr); }
          .dash-hero { grid-template-columns: 1fr; }
          .dash-hero-copy { border-right: none !important; border-bottom: 1px solid #f1f5f9; }
        }

        @media (max-width: 720px) {
          .dash-root { padding: 20px !important; }
          .dash-header { flex-direction: column; align-items: stretch; }
          .dash-stats, .dash-form-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="dash-root" style={{ background: '#f7f9fb', minHeight: '100vh', padding: '32px' }}>

        {/* ── Page header ── */}
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Dashboard</h1>
            <p style={{ color: '#64748b', fontWeight: 500, marginTop: 4, fontSize: 14 }}>
              Schedule Intelligence Platform • Institutional Operations Ledger
            </p>
          </div>
          <button className="btn-primary-dash" onClick={() => navigate('/setup')}>
            <span className="ms">add</span> NEW SETUP
          </button>
        </div>

        {/* ── Stats ── */}
        <div className="dash-stats">
          {stats.map(s => (
            <div key={s.label} className="stat-card">
              <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                {s.label}
              </p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 800, fontFamily: 'Manrope, sans-serif' }}>{s.value}</span>
                {s.sub && <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{s.sub}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* ── AI Generation Core ── */}
        <div className="section-card dash-hero">
          {/* Left */}
          <div
            className="dash-hero-copy"
            style={{ padding: '40px', background: '#f8fafc', borderRight: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, letterSpacing: '-.01em' }}>AI Generation Core</h2>
            <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              Deploy the ScheduleAI neural engine to resolve multi-dimensional institutional
              constraints. Our ledger-based approach ensures zero-overlap and optimal resource
              distribution for faculty and students.
            </p>
            <div style={{ display: 'flex', gap: 24, fontSize: 12, fontWeight: 700, color: '#0053db', letterSpacing: '.08em' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="ms" style={{ fontSize: 16 }}>check_circle</span> GPU ACCELERATED
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="ms" style={{ fontSize: 16 }}>verified_user</span> ISO 27001
              </span>
            </div>
          </div>
          {/* Right */}
          <div style={{ padding: '40px' }}>
            <div className="dash-form-grid">
              <div>
                <span className="label-xs">Institution Selector</span>
                <select
                  className="input-field"
                  value={selInst ?? ''}
                  onChange={e => setSelInst(Number(e.target.value))}
                >
                  <option value="" disabled>Select institution…</option>
                  {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <span className="label-xs">Timetable Name</span>
                <input
                  className="input-field"
                  placeholder="e.g. Semester 1 Core Schedule"
                  value={ttName}
                  onChange={e => setTtName(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 24, borderTop: '1px solid #f1f5f9' }}>
              <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Solver window: up to 60 seconds</p>
              <button
                className="btn-primary-dash"
                style={{ padding: '12px 32px' }}
                onClick={generate}
                disabled={generating || !selInst}
              >
                {generating
                  ? <><span className="ms" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>refresh</span> GENERATING…</>
                  : 'GENERATE TIMETABLE'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Bottom: Table + Sidebar ── */}
        <div className="dash-bottom">

          {/* Generated Timetables */}
          <div className="section-card">
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(248,250,252,.5)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Generated Timetables</h3>
              <button className="icon-btn" onClick={() => selInst && loadTimetables(selInst)}>
                <span className="ms">refresh</span>
              </button>
            </div>

            {timetables.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '64px 0', color: '#94a3b8' }}>
                <span className="ms" style={{ fontSize: 40, opacity: .3, display: 'block', marginBottom: 12 }}>calendar_month</span>
                <p style={{ fontSize: 14 }}>No timetables yet. Generate one above.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      {['NAME', 'INSTITUTION', 'STATUS', 'DATE GENERATED', 'ACTIONS'].map((h, i) => (
                        <th key={h} style={{
                          padding: '14px 24px', textAlign: i === 4 ? 'right' : 'left',
                          fontSize: 10, fontWeight: 700, color: '#94a3b8',
                          letterSpacing: '.1em', textTransform: 'uppercase',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timetables.map(tt => {
                      const s = STATUS_STYLES[tt.status] || { cls: 'bg-slate-100 text-slate-600', label: tt.status.toUpperCase() }
                      return (
                        <tr
                          key={tt.id}
                          className="table-row"
                          style={{ borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
                          onClick={() => navigate('/timetable', { state: { ttId: tt.id } })}
                        >
                          <td style={{ padding: '20px 24px', fontWeight: 600, color: '#0f172a' }}>{tt.name}</td>
                          <td style={{ padding: '20px 24px', color: '#475569' }}>
                            {inst?.name ?? '—'}
                          </td>
                          <td style={{ padding: '20px 24px' }}>
                            <span className={`status-badge ${s.cls}`} style={{ borderRadius: 0 }}>{s.label}</span>
                          </td>
                          <td style={{ padding: '20px 24px', color: '#64748b' }}>
                            {new Date(tt.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td style={{ padding: '20px 24px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }} onClick={e => e.stopPropagation()}>
                              <button className="icon-btn" onClick={() => navigate('/timetable', { state: { ttId: tt.id } })}>
                                <span className="ms">visibility</span>
                              </button>
                              <button className="icon-btn red" onClick={() => deleteTt(tt.id)}>
                                <span className="ms">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Active Constraints */}
            <div className="section-card" style={{ padding: 24 }}>
              <h4 style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 24 }}>
                Active Constraints
              </h4>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
                {[
                  { label: 'Slot Duration',       value: `${inst?.period_duration_minutes ?? 50} Minutes` },
                  { label: 'Conflict Threshold',  value: 'Zero Tolerance', locked: true },
                  { label: 'Lunch Buffer',         value: '60 Min Fixed' },
                  { label: 'Staff Utilization',    value: 'Max 85%' },
                ].map(c => (
                  <li key={c.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      {c.label}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{c.value}</span>
                      <span className="ms" style={{ fontSize: 16, color: '#cbd5e1' }}>{c.locked ? 'lock' : 'chevron_right'}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <button className="btn-ghost-dash" style={{ marginTop: 32 }}>Adjust All Rules</button>
            </div>

            {/* System Status */}
            <div style={{ background: '#0053db', padding: 24, color: '#fff' }}>
              <h4 style={{ fontSize: 10, fontWeight: 700, color: '#bfdbfe', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>
                System Status
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span className="pulse" />
                <span style={{ fontWeight: 700, fontSize: 14 }}>Neural Engine Online</span>
              </div>
              <p style={{ fontSize: 11, lineHeight: 1.6, color: 'rgba(219,234,254,.8)', margin: 0 }}>
                Current institutional ledger is synchronized with global academic standards.
              </p>
            </div>

            {/* Institution config (if selected) */}
            {inst && (
              <div className="section-card" style={{ padding: 24 }}>
                <h4 style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 16 }}>
                  Working Days
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {inst.working_days.map(d => (
                    <span key={d} style={{
                      fontSize: 10, fontWeight: 700, background: '#dbeafe', color: '#1e40af',
                      padding: '2px 8px', letterSpacing: '.05em',
                    }}>{DAY_LABELS[d]}</span>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <span className="label-xs">Start Time</span>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{inst.start_time}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
