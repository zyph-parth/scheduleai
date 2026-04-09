import { useEffect, useState } from 'react'
import { API } from '../api/client'
import toast from 'react-hot-toast'
import {
  BarChart3, Users, DoorOpen, GraduationCap, Star,
  TrendingUp, Sun, AlertCircle
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, Cell, PieChart, Pie, Legend
} from 'recharts'

const CHART_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#ec4899','#14b8a6']

function StatCard({ label, value, sub, icon: Icon, colour = 'brand' }: any) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-2">
        <span className="stat-label">{label}</span>
        <div className={`w-7 h-7 rounded-lg bg-${colour}-500/20 flex items-center justify-center`}>
          <Icon className={`w-3.5 h-3.5 text-${colour}-400`} />
        </div>
      </div>
      <span className="stat-value">{value}</span>
      {sub && <span className="text-xs text-slate-500 mt-0.5">{sub}</span>}
    </div>
  )
}

function WellbeingBar({ name, score }: { name: string; score: number }) {
  const colour = score >= 70 ? 'bg-emerald-400' : score >= 40 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-32 truncate shrink-0">{name}</span>
      <div className="flex-1 progress-bar">
        <div className={`h-full rounded-full transition-all duration-700 ${colour}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-300 w-8 text-right">{score}</span>
    </div>
  )
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
    name: f.faculty_name.split(' ').pop(),   // Last name only for chart
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
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-brand-400" /> Analytics
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Schedule quality insights and resource utilization</p>
        </div>
        <div className="flex gap-3">
          <div>
            <label className="label">Institution</label>
            <select className="select w-44" value={selInst ?? ''} onChange={e => setSelInst(Number(e.target.value))}>
              <option value="" disabled>Select…</option>
              {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Timetable</label>
            <select className="select w-52" value={selTtId ?? ''} onChange={e => setSelTtId(Number(e.target.value))}>
              <option value="" disabled>Select…</option>
              {timetables.filter(t => t.status === 'done').map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <span className="spinner w-8 h-8" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Slots" value={data.total_slots} icon={GraduationCap} colour="brand" />
            <StatCard label="Faculty Members" value={data.faculty_load.length} icon={Users} colour="purple" />
            <StatCard label="Rooms Used" value={data.room_utilization.filter((r:any)=>r.used_periods>0).length} icon={DoorOpen} colour="blue" />
            <StatCard
              label="Core in Morning"
              value={`${data.core_subject_distribution.morning_pct}%`}
              sub={`${data.core_subject_distribution.core_in_morning} of ${data.core_subject_distribution.core_total}`}
              icon={Sun}
              colour="amber"
            />
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Faculty load chart */}
            <div className="glass p-5">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-semibold text-slate-200">Faculty Hours/Week</h3>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={facultyChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: 12 }}
                    formatter={(v: any, _: any, props: any) => [v, props.payload.full]}
                  />
                  <Bar dataKey="hours" radius={[4,4,0,0]}>
                    {facultyChartData.map((_: any, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Room utilization */}
            <div className="glass p-5">
              <div className="flex items-center gap-2 mb-4">
                <DoorOpen className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-200">Room Utilization %</h3>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={roomChartData} layout="vertical" margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
                  <XAxis type="number" domain={[0,100]} tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={60} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: 12 }}
                    formatter={(v: any) => [`${v}%`, 'Utilization']}
                  />
                  <Bar dataKey="pct" radius={[0,4,4,0]}>
                    {roomChartData.map((_: any, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Faculty wellbeing */}
            <div className="glass p-5">
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-200">Faculty Wellbeing Score</h3>
                <span className="text-xs text-slate-500 ml-1">(100 = perfectly balanced)</span>
              </div>
              <div className="space-y-3">
                {(data.wellbeing_scores || []).map((f: any) => (
                  <WellbeingBar key={f.faculty_id} name={f.faculty_name} score={f.score} />
                ))}
              </div>
            </div>

            {/* Core distribution pie */}
            <div className="glass p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sun className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-200">Core Subjects in Morning Slots</h3>
              </div>
              {corePie.some(p => p.value > 0) ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={corePie} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }: any) => `${name} ${Math.round(percent * 100)}%`}>
                      <Cell fill="#f59e0b" />
                      <Cell fill="#334155" />
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-slate-500 text-sm">No core courses found</div>
              )}
            </div>
          </div>

          {/* Section gaps */}
          {data.section_gaps.length > 0 && (
            <div className="glass p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-200">Student Free-Period Gaps per Section</h3>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {data.section_gaps.map((s: any) => (
                  <div key={s.section_id} className="glass-sm p-3 text-center">
                    <p className="text-xs font-semibold text-slate-300 mb-1">{s.section_name}</p>
                    <p className={`text-2xl font-bold ${s.total_gaps === 0 ? 'text-emerald-400' : s.total_gaps < 5 ? 'text-amber-400' : 'text-red-400'}`}>
                      {s.total_gaps}
                    </p>
                    <p className="text-[10px] text-slate-500">gaps/week</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !data && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500">
          <BarChart3 className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">Select a completed timetable to view analytics</p>
        </div>
      )}
    </div>
  )
}
