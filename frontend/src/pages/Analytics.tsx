import { useEffect, useState } from 'react'
import { API } from '../api/client'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'

const CHART_COLORS = ['#0053db','#16a34a','#d97706','#dc2626','#0891b2','#7c3aed','#db2777','#0d9488']

const fontImport = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap');
`

function StatCard({ label, value, sub, icon }: { label: string; value: any; sub?: string; icon: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid rgba(169,180,185,.3)',
      padding: 24, display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', minHeight: 120,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.1em', margin: 0 }}>
          {label}
        </p>
        <span className="ms" style={{ fontSize: 18, color: '#0053db', opacity: .7 }}>{icon}</span>
      </div>
      <div>
        <span style={{ fontSize: 30, fontWeight: 800, fontFamily: 'Manrope, sans-serif', color: '#0f172a' }}>{value}</span>
        {sub && <p style={{ fontSize: 10, color: '#94a3b8', margin: '2px 0 0', fontWeight: 600 }}>{sub}</p>}
      </div>
    </div>
  )
}

function WellbeingBar({ name, score }: { name: string; score: number }) {
  const color = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#dc2626'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 12, color: '#64748b', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 0 }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, transition: 'width .7s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', width: 32, textAlign: 'right' }}>{score}</span>
    </div>
  )
}

const SectionCard = ({ children, title, icon }: { children: React.ReactNode; title: string; icon: string }) => (
  <div style={{ background: '#fff', border: '1px solid rgba(169,180,185,.3)' }}>
    <div style={{ padding: '14px 24px', borderBottom: '1px solid #f1f5f9', background: 'rgba(248,250,252,.5)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="ms" style={{ fontSize: 18, color: '#0053db' }}>{icon}</span>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, fontFamily: 'Manrope, sans-serif' }}>{title}</h3>
    </div>
    <div style={{ padding: 24 }}>{children}</div>
  </div>
)

const tooltipStyle = {
  contentStyle: {
    background: '#fff', border: '1px solid rgba(169,180,185,.3)',
    borderRadius: 0, fontSize: 12, fontFamily: 'Inter, sans-serif',
    color: '#0f172a', boxShadow: '0 2px 8px rgba(0,0,0,.08)',
  },
  labelStyle: { fontWeight: 700, color: '#0f172a' },
}

export default function Analytics() {
  const [institutions, setInstitutions] = useState<any[]>([])
  const [timetables,   setTimetables]   = useState<any[]>([])
  const [selInst,      setSelInst]      = useState<number | null>(null)
  const [selTtId,      setSelTtId]      = useState<number | null>(null)
  const [data,         setData]         = useState<any>(null)
  const [loading,      setLoading]      = useState(false)

  useEffect(() => {
    API.getInstitutions().then(d => { setInstitutions(d); if (d.length) setSelInst(d[0].id) })
  }, [])
  useEffect(() => {
    if (!selInst) return
    API.listTimetables(selInst).then(tt => {
      setTimetables(tt)
      const done = tt.find((t: any) => t.status === 'done')
      if (done) setSelTtId(done.id)
    })
  }, [selInst])
  useEffect(() => {
    if (!selTtId) return
    setLoading(true)
    API.getAnalytics(selTtId)
      .then(setData)
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false))
  }, [selTtId])

  const facultyChartData = (data?.faculty_load || []).map((f: any) => ({
    name: f.faculty_name.split(' ').pop(),
    hours: f.hours_per_week,
    full: f.faculty_name,
  }))

  const roomChartData = (data?.room_utilization || []).map((r: any) => ({
    name: r.room_name,
    pct: r.utilization_pct,
    used: r.used_periods,
  }))

  const coreData = data?.core_subject_distribution
  const corePie = coreData ? [
    { name: 'Morning', value: coreData.core_in_morning },
    { name: 'Other',   value: coreData.core_total - coreData.core_in_morning },
  ] : []

  return (
    <>
      <style>{fontImport}{`
        .ana-root { font-family: 'Inter', sans-serif; color: #2a3439; }
        .ana-root h1, .ana-root h2, .ana-root h3, .ana-root h4 { font-family: 'Manrope', sans-serif; }
        .ms { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal;
              font-size: 20px; line-height: 1; letter-spacing: normal; text-transform: none;
              display: inline-block; white-space: nowrap; -webkit-font-feature-settings: 'liga';
              font-feature-settings: 'liga'; -webkit-font-smoothing: antialiased; }
        .input-field { border: 1px solid rgba(169,180,185,.5); padding: 10px 16px; font-size: 13px;
                       font-family: 'Inter', sans-serif; outline: none; background: #fff; }
        .input-field:focus { border-color: #0053db; }
        .label-xs { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;
                    letter-spacing: .1em; margin-bottom: 6px; display: block; }
        .gap-card { background: #f8fafc; border: 1px solid rgba(169,180,185,.2); padding: 16px; text-align: center; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { animation: spin 1s linear infinite; display: inline-block; }
      `}</style>

      <div className="ana-root" style={{ background: '#f7f9fb', minHeight: '100vh', padding: 32 }}>

        {/* ── Page header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="ms" style={{ fontSize: 28, color: '#0053db' }}>bar_chart</span>
              Analytics
            </h1>
            <p style={{ color: '#64748b', fontWeight: 500, marginTop: 4, fontSize: 14 }}>
              Schedule quality insights and resource utilization
            </p>
          </div>

          {/* Selectors */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div>
              <span className="label-xs">Institution</span>
              <select
                className="input-field"
                style={{ width: 180 }}
                value={selInst ?? ''}
                onChange={e => setSelInst(Number(e.target.value))}
              >
                <option value="" disabled>Select…</option>
                {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <span className="label-xs">Timetable</span>
              <select
                className="input-field"
                style={{ width: 220 }}
                value={selTtId ?? ''}
                onChange={e => setSelTtId(Number(e.target.value))}
              >
                <option value="" disabled>Select…</option>
                {timetables.filter((t: any) => t.status === 'done').map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <span className="ms spinner" style={{ fontSize: 36, color: '#0053db' }}>refresh</span>
          </div>
        )}

        {/* ── Data ── */}
        {!loading && data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
              <StatCard label="Total Slots"      value={data.total_slots}                              icon="calendar_month" />
              <StatCard label="Faculty Members"  value={data.faculty_load.length}                      icon="group" />
              <StatCard label="Rooms Used"       value={data.room_utilization.filter((r: any) => r.used_periods > 0).length} icon="meeting_room" />
              <StatCard
                label="Core in Morning"
                value={`${data.core_subject_distribution.morning_pct}%`}
                sub={`${data.core_subject_distribution.core_in_morning} of ${data.core_subject_distribution.core_total} core subjects`}
                icon="wb_sunny"
              />
            </div>

            {/* Charts row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>

              <SectionCard title="Faculty Hours / Week" icon="group">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={facultyChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'Inter' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'Inter' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: any, _: any, props: any) => [v + ' hrs', props.payload.full]}
                    />
                    <Bar dataKey="hours" radius={[2, 2, 0, 0]}>
                      {facultyChartData.map((_: any, i: number) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>

              <SectionCard title="Room Utilization %" icon="meeting_room">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={roomChartData} layout="vertical" margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'Inter' }} axisLine={false} tickLine={false} unit="%" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'Inter' }} width={64} axisLine={false} tickLine={false} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: any) => [`${v}%`, 'Utilization']}
                    />
                    <Bar dataKey="pct" radius={[0, 2, 2, 0]}>
                      {roomChartData.map((_: any, i: number) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>
            </div>

            {/* Charts row 2 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>

              <SectionCard title="Faculty Wellbeing Score" icon="star">
                <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16, marginTop: -8 }}>100 = perfectly balanced schedule</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {(data.wellbeing_scores || []).map((f: any) => (
                    <WellbeingBar key={f.faculty_id} name={f.faculty_name} score={f.score} />
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Core Subjects in Morning Slots" icon="wb_sunny">
                {corePie.some((p: any) => p.value > 0) ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={corePie}
                        cx="50%" cy="50%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} ${Math.round(percent * 100)}%`}
                        labelLine={{ stroke: '#cbd5e1' }}
                      >
                        <Cell fill="#0053db" />
                        <Cell fill="#e2e8f0" />
                      </Pie>
                      <Tooltip {...tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: '#94a3b8', fontSize: 13 }}>
                    No core courses found
                  </div>
                )}
              </SectionCard>
            </div>

            {/* Section gaps */}
            {data.section_gaps?.length > 0 && (
              <SectionCard title="Student Free-Period Gaps per Section" icon="warning">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                  {data.section_gaps.map((s: any) => {
                    const color = s.total_gaps === 0 ? '#16a34a' : s.total_gaps < 5 ? '#d97706' : '#dc2626'
                    return (
                      <div key={s.section_id} className="gap-card">
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>{s.section_name}</p>
                        <p style={{ fontSize: 28, fontWeight: 800, color, fontFamily: 'Manrope, sans-serif', margin: 0 }}>{s.total_gaps}</p>
                        <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em' }}>
                          gaps / week
                        </p>
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
            )}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !data && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '96px 0', color: '#94a3b8' }}>
            <span className="ms" style={{ fontSize: 48, opacity: .25, display: 'block', marginBottom: 12 }}>bar_chart</span>
            <p style={{ fontSize: 14, margin: 0 }}>Select a completed timetable to view analytics</p>
          </div>
        )}
      </div>
    </>
  )
}