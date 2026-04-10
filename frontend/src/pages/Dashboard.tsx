import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  CalendarDays,
  GraduationCap,
  Gauge,
  Plus,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  Trash2,
} from 'lucide-react'
import { API, type Department, type Institution, type Section, type TimetableMeta } from '../api/client'

const STATUS_STYLES: Record<string, { label: string; background: string; color: string }> = {
  done: { label: 'Ready', background: '#dcfce7', color: '#166534' },
  optimal: { label: 'Ready', background: '#dcfce7', color: '#166534' },
  feasible: { label: 'Feasible', background: '#dbeafe', color: '#1d4ed8' },
  infeasible: { label: 'Error', background: '#fee2e2', color: '#b91c1c' },
  error: { label: 'Error', background: '#fee2e2', color: '#b91c1c' },
  pending: { label: 'Draft', background: '#e2e8f0', color: '#475569' },
  generating: { label: 'Generating', background: '#fef3c7', color: '#b45309' },
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const fontImport = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Inter:wght@400;500;600;700&display=swap');
`

function formatCreatedAt(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [timetables, setTimetables] = useState<TimetableMeta[]>([])
  const [selInst, setSelInst] = useState<number | null>(null)
  const [selDept, setSelDept] = useState<number | null>(null)
  const [selSemester, setSelSemester] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [ttName, setTtName] = useState('')

  const loadInstitutions = async () => {
    try {
      const data = await API.getInstitutions()
      setInstitutions(data)
      if (data.length && !selInst) setSelInst(data[0].id)
    } catch {
      toast.error('Failed to load institutions')
    }
  }

  const loadTimetables = async (instId: number) => {
    try {
      setTimetables(await API.listTimetables(instId))
    } catch {
      toast.error('Failed to load timetables')
    }
  }

  const loadDepartments = async (instId: number) => {
    try {
      const data = await API.getDepartments(instId)
      setDepartments(data)
      setSelDept((current) => (
        current && data.some((item) => item.id === current) ? current : data[0]?.id ?? null
      ))
    } catch {
      toast.error('Failed to load departments')
    }
  }

  const loadSections = async (deptId: number) => {
    try {
      const data = await API.getSections(deptId)
      setSections(data)
      const semesters = Array.from(new Set(data.map((item) => item.semester))).sort((a, b) => a - b)
      setSelSemester((current) => (
        current && semesters.includes(current) ? current : semesters[0] ?? null
      ))
    } catch {
      toast.error('Failed to load sections')
    }
  }

  useEffect(() => {
    loadInstitutions()
  }, [])

  useEffect(() => {
    if (selInst) loadTimetables(selInst)
  }, [selInst])

  useEffect(() => {
    if (!selInst) {
      setDepartments([])
      setSections([])
      setSelDept(null)
      setSelSemester(null)
      return
    }
    loadDepartments(selInst)
  }, [selInst])

  useEffect(() => {
    if (!selDept) {
      setSections([])
      setSelSemester(null)
      return
    }
    loadSections(selDept)
  }, [selDept])

  const generate = async () => {
    if (!selInst) {
      toast.error('Select an institution')
      return
    }
    if (!selDept) {
      toast.error('Select a branch/department')
      return
    }
    if (!selSemester) {
      toast.error('Select a semester')
      return
    }

    setGenerating(true)
    const loadingToast = toast.loading('Generating timetable... this can take up to 60s')

    try {
      const res = await API.generateTimetable({
        institution_id: selInst,
        department_id: selDept,
        name: ttName || 'Untitled Timetable',
        semester: selSemester,
        max_solve_seconds: 60,
      })
      await loadTimetables(selInst)

      toast.dismiss(loadingToast)

      if (['done', 'optimal', 'feasible'].includes(res.status)) {
        toast.success(`Generated ${res.num_slots} slots in ${res.solve_time}s`)
        setTtName('')
      } else {
        toast.error(`Solver returned: ${res.status}`)
      }
    } catch (error: any) {
      toast.dismiss(loadingToast)
      toast.error(error?.response?.data?.detail || 'Generation failed')
    } finally {
      setGenerating(false)
    }
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

  const inst = institutions.find((item) => item.id === selInst)
  const selectedDepartment = departments.find((item) => item.id === selDept)
  const semesterOptions = Array.from(new Set(sections.map((item) => item.semester))).sort((a, b) => a - b)
  const visibleTimetables = timetables.filter((item) => {
    if (selDept && item.department_id !== selDept) return false
    if (selSemester && item.semester_number !== selSemester) return false
    return true
  })
  const successfulTimetables = visibleTimetables.filter((item) =>
    ['done', 'optimal', 'feasible'].includes(item.status)
  )
  const conflictFreePct = visibleTimetables.length
    ? `${((successfulTimetables.length / visibleTimetables.length) * 100).toFixed(1)}%`
    : '--'
  const avgSolve = visibleTimetables.length
    ? `${(visibleTimetables.reduce((sum, item) => sum + item.solve_time, 0) / visibleTimetables.length).toFixed(1)}s`
    : '--'
  const fastestSolve = visibleTimetables.length
    ? `${Math.min(...visibleTimetables.map((item) => item.solve_time)).toFixed(1)}s`
    : '--'
  const latestTimetable = visibleTimetables[0]

  const stats = [
    {
      label: 'Timetables',
      value: visibleTimetables.length.toString(),
      note: latestTimetable ? `Latest: ${latestTimetable.name}` : 'No output yet',
      icon: CalendarDays,
    },
    {
      label: 'Conflict-free',
      value: conflictFreePct,
      note: `${successfulTimetables.length} successful runs`,
      icon: ShieldCheck,
    },
    {
      label: 'Average solve',
      value: avgSolve,
      note: `Fastest run: ${fastestSolve}`,
      icon: TimerReset,
    },
    {
      label: 'Working days',
      value: inst ? String(inst.working_days.length) : '--',
      note: inst ? `${inst.start_time} start time` : 'Choose an institution',
      icon: Gauge,
    },
  ]

  return (
    <>
      <style>{fontImport}{`
        .dashboard-page {
          font-family: 'Inter', sans-serif;
          color: #172033;
          min-height: 100vh;
          padding: 32px;
          
        }

        .dashboard-page h1,
        .dashboard-page h2,
        .dashboard-page h3,
        .dashboard-page h4 {
          font-family: 'Manrope', sans-serif;
        }

        .dashboard-shell {
          max-width: 1380px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .dash-card {
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(213, 222, 236, 0.9);
          border-radius: 14px;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
          backdrop-filter: blur(10px);
        }

        .dash-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(340px, 0.9fr);
          overflow: hidden;
        }

        .dash-hero-copy {
          padding: 34px;
          position: relative;
          background: #ffffff;
        }

        .dash-title {
          margin: 0 0 10px;
          font-size: 40px;
          line-height: 1.05;
          letter-spacing: -0.04em;
        }

        .dash-subtitle {
          max-width: 640px;
          margin: 0;
          color: #52607a;
          font-size: 15px;
          line-height: 1.75;
        }

        .dash-chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 26px;
        }

        .dash-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 11px 14px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(211, 221, 235, 0.95);
          color: #24324a;
          font-size: 13px;
          font-weight: 600;
        }

        .dash-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 28px;
        }

        .dash-button-primary,
        .dash-button-secondary,
        .dash-icon-button {
          border: none;
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease, border-color 0.18s ease;
        }

        .dash-button-primary:hover,
        .dash-button-secondary:hover,
        .dash-icon-button:hover {
          transform: translateY(-1px);
        }

        .dash-button-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          border-radius: 12px;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          color: #ffffff;
          font-size: 14px;
          font-weight: 700;
          box-shadow: 0 16px 30px rgba(37, 99, 235, 0.22);
        }

        .dash-button-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .dash-button-secondary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(211, 221, 235, 0.95);
          color: #24324a;
          font-size: 14px;
          font-weight: 700;
        }

        .dash-button-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .dash-hero-panel {
          padding: 26px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .dash-mini-card {
          padding: 18px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.72);
          border: 1px solid rgba(223, 230, 240, 0.72);
        }

        .dash-mini-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #8090aa;
          margin-bottom: 10px;
        }

        .dash-mini-value {
          font-size: 26px;
          font-weight: 800;
          line-height: 1;
          color: #172033;
          margin: 0 0 8px;
        }

        .dash-mini-note {
          margin: 0;
          color: #66758f;
          font-size: 13px;
          line-height: 1.5;
        }

        .dash-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 18px;
        }

        .dash-stat-card {
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .dash-stat-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .dash-stat-icon {
          width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(13, 148, 136, 0.12));
          color: #1d4ed8;
        }

        .dash-stat-label {
          margin: 0;
          color: #7b8ba6;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .dash-stat-value {
          margin: 0;
          font-size: 34px;
          line-height: 1;
          font-weight: 800;
          color: #172033;
        }

        .dash-stat-note {
          margin: 0;
          color: #5d6c86;
          font-size: 13px;
          line-height: 1.5;
        }

        .dash-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.75fr);
          gap: 24px;
          align-items: start;
        }

        .dash-stack {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .dash-section {
          padding: 24px;
        }

        .dash-section-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }

        .dash-section-title {
          margin: 0;
          font-size: 22px;
          letter-spacing: -0.02em;
        }

        .dash-section-text {
          margin: 8px 0 0;
          color: #66758f;
          font-size: 14px;
          line-height: 1.65;
        }

        .dash-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 18px;
        }

        .dash-field-label {
          display: block;
          margin-bottom: 8px;
          color: #8090aa;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .dash-input,
        .dash-select {
          width: 100%;
          min-height: 52px;
          padding: 14px 16px;
          border-radius: 10px;
          border: 1px solid #d6dfec;
          background: #f9fbff;
          color: #172033;
          font-size: 15px;
          outline: none;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .dash-input::placeholder {
          color: #94a3b8;
        }

        .dash-input:focus,
        .dash-select:focus {
          border-color: #3b82f6;
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12);
        }

        .dash-form-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding-top: 18px;
          border-top: 1px solid rgba(226, 232, 240, 0.9);
        }

        .dash-helper {
          margin: 0;
          color: #66758f;
          font-size: 13px;
          line-height: 1.55;
        }

        .dash-table-wrap {
          overflow-x: auto;
        }

        .dash-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 720px;
        }

        .dash-table thead th {
          padding: 0 0 14px;
          border-bottom: 1px solid #e7edf6;
          color: #8090aa;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-align: left;
        }

        .dash-table thead th:last-child {
          text-align: right;
        }

        .dash-table tbody tr {
          cursor: pointer;
          transition: background 0.16s ease;
        }

        .dash-table tbody tr:hover {
          background: rgba(248, 250, 255, 0.9);
        }

        .dash-table tbody td {
          padding: 18px 0;
          border-bottom: 1px solid #eef2f7;
          color: #334155;
          font-size: 14px;
          vertical-align: middle;
        }

        .dash-table tbody td:last-child {
          text-align: right;
        }

        .dash-status {
          display: inline-flex;
          align-items: center;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
        }

        .dash-table-name {
          font-weight: 700;
          color: #172033;
          margin: 0 0 4px;
        }

        .dash-table-meta {
          margin: 0;
          color: #8090aa;
          font-size: 12px;
        }

        .dash-empty {
          padding: 42px 20px;
          text-align: center;
          border: 1px dashed #d6dfec;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(249, 251, 255, 0.95), rgba(255, 255, 255, 0.92));
        }

        .dash-empty-title {
          margin: 14px 0 6px;
          font-size: 18px;
          font-weight: 800;
          color: #172033;
        }

        .dash-empty-text {
          margin: 0;
          color: #66758f;
          font-size: 14px;
          line-height: 1.6;
        }

        .dash-side-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .dash-side-item {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 18px;
          border-radius: 12px;
          background: #f8fbff;
          border: 1px solid #e6edf7;
        }

        .dash-side-key {
          display: block;
          margin-bottom: 6px;
          color: #8090aa;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .dash-side-value {
          margin: 0;
          color: #172033;
          font-size: 15px;
          font-weight: 700;
          line-height: 1.4;
        }

        .dash-day-list {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .dash-day-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 54px;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(37, 99, 235, 0.10);
          color: #1d4ed8;
          font-size: 12px;
          font-weight: 700;
        }

        .dash-icon-button {
          width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          background: #ffffff;
          border: 1px solid #d6dfec;
          color: #5b6b85;
        }

        .dash-icon-button.danger:hover {
          background: #fef2f2;
          border-color: #fecaca;
          color: #dc2626;
        }

        .dash-rotate {
          animation: dash-spin 1s linear infinite;
        }

        @keyframes dash-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .dash-hero,
          .dash-stats-grid {
            grid-template-columns: 1fr 1fr;
          }

          .dash-main-grid {
            grid-template-columns: 1fr;
          }

          .dash-hero {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 860px) {
          .dashboard-page {
            padding: 18px;
          }

          .dash-title {
            font-size: 32px;
          }

          .dash-stats-grid,
          .dash-form-grid {
            grid-template-columns: 1fr;
          }

          .dash-section,
          .dash-hero-copy,
          .dash-hero-panel {
            padding: 20px;
          }

          .dash-form-footer,
          .dash-section-header {
            flex-direction: column;
            align-items: stretch;
          }
        }
      `}</style>

      <div className="dashboard-page">
        <div className="dashboard-shell">
          <section className="dash-card dash-hero">
            <div className="dash-hero-copy">
              <h1 className="dash-title">A cleaner command center for timetable generation</h1>
              <p className="dash-subtitle">
                Build, review, and regenerate schedules from one place. The layout is intentionally
                simpler now, with the key actions and system health surfaced first instead of buried
                in disconnected boxes.
              </p>

              <div className="dash-chip-row">
                <div className="dash-chip">
                  <ShieldCheck size={16} />
                  {inst ? `${inst.name}` : 'No institution selected'}
                </div>
                <div className="dash-chip">
                  <GraduationCap size={16} />
                  {selectedDepartment ? selectedDepartment.name : 'Select a branch'}
                </div>
                <div className="dash-chip">
                  <CalendarDays size={16} />
                  {selSemester ? `Semester ${selSemester}` : 'Select a semester'}
                </div>
              </div>

              <div className="dash-actions">
                <button className="dash-button-primary" onClick={() => navigate('/setup')}>
                  <Plus size={18} />
                  New setup
                </button>
                <button
                  className="dash-button-secondary"
                  onClick={() => selInst && loadTimetables(selInst)}
                  disabled={!selInst}
                >
                  <RefreshCw size={18} />
                  Refresh data
                </button>
              </div>
            </div>

            <aside className="dash-hero-panel">
              <div className="dash-mini-card">
                <div className="dash-mini-label">Selected institution</div>
                <p className="dash-mini-value">{inst?.name ?? 'No institution'}</p>
                <p className="dash-mini-note">
                  {inst
                    ? `${inst.start_time} start time with ${inst.period_duration_minutes} minute slots`
                    : 'Create an institution setup to unlock generation controls.'}
                </p>
              </div>

              <div className="dash-mini-card">
                <div className="dash-mini-label">Latest result</div>
                <p className="dash-mini-value">{latestTimetable?.name ?? 'Nothing generated yet'}</p>
                <p className="dash-mini-note">
                  {latestTimetable
                    ? `Created on ${formatCreatedAt(latestTimetable.created_at)}`
                    : 'Your next generated timetable will appear here.'}
                </p>
              </div>
            </aside>
          </section>

          <section className="dash-stats-grid">
            {stats.map(({ label, value, note, icon: Icon }) => (
              <article key={label} className="dash-card dash-stat-card">
                <div className="dash-stat-top">
                  <p className="dash-stat-label">{label}</p>
                  <span className="dash-stat-icon">
                    <Icon size={18} />
                  </span>
                </div>
                <p className="dash-stat-value">{value}</p>
                <p className="dash-stat-note">{note}</p>
              </article>
            ))}
          </section>

          <section className="dash-main-grid">
            <div className="dash-stack">
              <article className="dash-card dash-section">
                <div className="dash-section-header">
                  <div>
                    <h2 className="dash-section-title">Generate a new timetable</h2>
                    <p className="dash-section-text">
                      Pick the institution, branch, and semester you want to solve, then give the
                      run a clear name before launching the solver.
                    </p>
                  </div>
                </div>

                <div className="dash-form-grid">
                  <div>
                    <label className="dash-field-label">Institution</label>
                    <select
                      className="dash-select"
                      value={selInst ?? ''}
                      onChange={(e) => setSelInst(Number(e.target.value))}
                    >
                      <option value="" disabled>
                        Select institution
                      </option>
                      {institutions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="dash-field-label">Branch / Department</label>
                    <select
                      className="dash-select"
                      value={selDept ?? ''}
                      onChange={(e) => setSelDept(Number(e.target.value))}
                      disabled={!departments.length}
                    >
                      <option value="" disabled>
                        Select branch
                      </option>
                      {departments.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="dash-field-label">Semester</label>
                    <select
                      className="dash-select"
                      value={selSemester ?? ''}
                      onChange={(e) => setSelSemester(Number(e.target.value))}
                      disabled={!semesterOptions.length}
                    >
                      <option value="" disabled>
                        Select semester
                      </option>
                      {semesterOptions.map((item) => (
                        <option key={item} value={item}>
                          Semester {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="dash-field-label">Timetable name</label>
                    <input
                      className="dash-input"
                      placeholder="Semester 1 core schedule"
                      value={ttName}
                      onChange={(e) => setTtName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="dash-form-footer">
                  <p className="dash-helper">
                    Generation is now scoped to one institution, one branch, and one semester. That
                    keeps the setup intent and the generated timetable aligned.
                  </p>

                  <button
                    className="dash-button-primary"
                    onClick={generate}
                    disabled={generating || !selInst || !selDept || !selSemester}
                  >
                    {generating ? (
                      <>
                        <RefreshCw size={18} className="dash-rotate" />
                        Generating...
                      </>
                    ) : (
                      <>
                        Generate timetable
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </div>
              </article>

              <article className="dash-card dash-section">
                <div className="dash-section-header">
                  <div>
                    <h2 className="dash-section-title">Generated timetables</h2>
                    <p className="dash-section-text">
                      Recent timetable runs for the selected branch and semester. Tap any row to open the
                      detailed timetable view.
                    </p>
                  </div>

                  <button
                    className="dash-icon-button"
                    onClick={() => selInst && loadTimetables(selInst)}
                    disabled={!selInst}
                    aria-label="Refresh timetable list"
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>

                {visibleTimetables.length === 0 ? (
                  <div className="dash-empty">
                    <CalendarDays size={34} color="#94a3b8" />
                    <div className="dash-empty-title">No timetables for this scope yet</div>
                    <p className="dash-empty-text">
                      Generate a run for the selected branch and semester, and it will show up here
                      with status, date, and quick actions.
                    </p>
                  </div>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Status</th>
                          <th>Solve time</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTimetables.map((tt) => {
                          const status = STATUS_STYLES[tt.status] || {
                            label: tt.status,
                            background: '#e2e8f0',
                            color: '#475569',
                          }

                          return (
                            <tr
                              key={tt.id}
                              onClick={() => navigate('/timetable', { state: { ttId: tt.id } })}
                            >
                              <td>
                                <p className="dash-table-name">{tt.name}</p>
                                <p className="dash-table-meta">
                                  {tt.scope_label ?? (inst?.name ?? 'Institution')} - {tt.slot_count} slots
                                </p>
                              </td>
                              <td>
                                <span
                                  className="dash-status"
                                  style={{ background: status.background, color: status.color }}
                                >
                                  {status.label}
                                </span>
                              </td>
                              <td>{tt.solve_time.toFixed(1)}s</td>
                              <td>{formatCreatedAt(tt.created_at)}</td>
                              <td>
                                <div
                                  style={{
                                    display: 'inline-flex',
                                    justifyContent: 'flex-end',
                                    gap: 10,
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <button
                                    className="dash-icon-button"
                                    onClick={() =>
                                      navigate('/timetable', { state: { ttId: tt.id } })
                                    }
                                    aria-label={`Open ${tt.name}`}
                                  >
                                    <ArrowRight size={18} />
                                  </button>
                                  <button
                                    className="dash-icon-button danger"
                                    onClick={() => deleteTt(tt.id)}
                                    aria-label={`Delete ${tt.name}`}
                                  >
                                    <Trash2 size={18} />
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
              </article>
            </div>

            <div className="dash-stack">
              <article className="dash-card dash-section">
                <div className="dash-section-header">
                  <div>
                    <h3 className="dash-section-title">Active constraints</h3>
                    <p className="dash-section-text">
                      A quick read of the current operating rules driving the solver.
                    </p>
                  </div>
                </div>

                <div className="dash-side-list">
                  <div className="dash-side-item">
                    <div>
                      <span className="dash-side-key">Slot duration</span>
                      <p className="dash-side-value">
                        {inst?.period_duration_minutes ?? 50} minutes
                      </p>
                    </div>
                  </div>
                  <div className="dash-side-item">
                    <div>
                      <span className="dash-side-key">Conflict policy</span>
                      <p className="dash-side-value">Zero overlap tolerance</p>
                    </div>
                  </div>
                  <div className="dash-side-item">
                    <div>
                      <span className="dash-side-key">Calendar start</span>
                      <p className="dash-side-value">{inst?.start_time ?? '--'}</p>
                    </div>
                  </div>
                  <div className="dash-side-item">
                    <div>
                      <span className="dash-side-key">System mode</span>
                      <p className="dash-side-value">Balanced schedule optimization</p>
                    </div>
                  </div>
                </div>
              </article>

              {inst && (
                <article className="dash-card dash-section">
                  <div className="dash-section-header">
                    <div>
                      <h3 className="dash-section-title">Working week</h3>
                      <p className="dash-section-text">
                        The active calendar currently applied to this institution.
                      </p>
                    </div>
                  </div>

                  <div className="dash-day-list">
                    {inst.working_days.map((day) => (
                      <span key={day} className="dash-day-pill">
                        {DAY_LABELS[day]}
                      </span>
                    ))}
                  </div>
                </article>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
