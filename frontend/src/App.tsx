import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import {
  LayoutDashboard, CalendarDays, Settings, BarChart3,
  Zap, Users, ChevronRight, GraduationCap
} from 'lucide-react'
import clsx from 'clsx'
import Dashboard   from './pages/Dashboard'
import Setup       from './pages/Setup'
import Timetable   from './pages/Timetable'
import WhatIf      from './pages/WhatIf'
import Analytics   from './pages/Analytics'
import StudentView from './pages/StudentView'
import TeacherView from './pages/TeacherView'
import logo from './assets/scheduleai-logo.svg'

const NAV = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/setup',     icon: Settings,        label: 'Setup'       },
  { to: '/timetable', icon: CalendarDays,    label: 'Timetable'   },
  { to: '/what-if',   icon: Zap,             label: 'What-If'     },
  { to: '/analytics', icon: BarChart3,       label: 'Analytics'   },
  { to: '/student',   icon: GraduationCap,   label: 'Student View' },
  { to: '/teacher',   icon: Users,           label: 'Teacher View' },
]

function Sidebar() {
  const loc = useLocation()

  return (
    <aside className="app-sidebar">
      {/* Logo */}
      <div className="app-sidebar-brand">
        <div className="app-sidebar-logo">
          <img src={logo} alt="ScheduleAI logo" className="app-sidebar-logo-image" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-100">ScheduleAI</p>
          <p className="text-[10px] text-slate-500">Timetable Intelligence</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="app-sidebar-nav">
        {NAV.map(({ to, icon: Icon, label }) => {
          const active = to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)
          return (
            <NavLink key={to} to={to}
              className={clsx('nav-item', active && 'active')}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
              {active && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="app-sidebar-footer">
        <div className="app-sidebar-footer-card">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1">Problem J</p>
          <p className="text-xs text-slate-300 font-semibold">Smart Campus 2026</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Team Mavericks</p>
        </div>
      </div>
    </aside>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        {children}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e293b', color: '#e2e8f0',
            border: '1px solid #334155', borderRadius: '12px',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#1e293b' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#1e293b' } },
        }}
      />
      <Routes>
        <Route path="*" element={
          <Layout>
            <Routes>
              <Route path="/"          element={<Dashboard />}   />
              <Route path="/setup"     element={<Setup />}       />
              <Route path="/timetable" element={<Timetable />}   />
              <Route path="/what-if"   element={<WhatIf />}      />
              <Route path="/analytics" element={<Analytics />}   />
              <Route path="/student"   element={<StudentView />} />
              <Route path="/teacher"   element={<TeacherView />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </BrowserRouter>
  )
}
