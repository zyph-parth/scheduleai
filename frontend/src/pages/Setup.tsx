import { useEffect, useState } from 'react'
import { API, type Institution, type Department, type Room, type Faculty, type Course, type Section } from '../api/client'
import toast from 'react-hot-toast'
import {
  Building2, Users, BookOpen, DoorOpen, GraduationCap,
  Plus, Trash2, Save, ChevronDown, ChevronUp, Cpu, Brain
} from 'lucide-react'
import clsx from 'clsx'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat']

// ─── Collapsible Section ──────────────────────────────────────────────────────
function Panel({ title, icon: Icon, children, colour = 'brand' }: any) {
  const [open, setOpen] = useState(true)
  return (
    <div className="glass overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-1/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-lg bg-${colour}-500/20 flex items-center justify-center`}>
            <Icon className={`w-3.5 h-3.5 text-${colour}-400`} />
          </div>
          <span className="font-semibold text-slate-200 text-sm">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

// ─── NLP Constraint Box ───────────────────────────────────────────────────────
function NLPBox({ instId }: { instId: number }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const parse = async () => {
    if (!text.trim()) return
    setLoading(true)
    try {
      const r = await API.parseConstraint(instId, text)
      setResult(r)
      toast.success('Constraint parsed!')
    } catch { toast.error('Parse failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="glass p-5 border border-brand-600/20">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-brand-400" />
        <h3 className="text-sm font-semibold text-slate-200">AI Constraint Parser</h3>
        <span className="badge-purple ml-auto">NLP</span>
      </div>
      <p className="text-slate-500 text-xs mb-3">
        Type a constraint in plain English — AI will parse it into a structured rule.
      </p>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder='e.g. "Dr. Sharma cannot teach before 10am on Mondays"'
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && parse()}
        />
        <button className="btn-primary shrink-0" onClick={parse} disabled={loading}>
          {loading ? <span className="spinner w-4 h-4" /> : <Cpu className="w-4 h-4" />}
          Parse
        </button>
      </div>
      {result && (
        <div className="mt-3 p-3 rounded-xl bg-surface-1 border border-slate-700">
          <p className="text-xs text-emerald-400 font-semibold mb-1">✓ {result.description}</p>
          <pre className="text-xs text-slate-400 overflow-x-auto">
            {JSON.stringify(result.parsed, null, 2)}
          </pre>
          <p className="text-xs text-slate-500 mt-1">
            Confidence: {Math.round((result.confidence || 0.5) * 100)}%
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main Setup Page ──────────────────────────────────────────────────────────
export default function Setup() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [selInst, setSelInst]           = useState<number | null>(null)
  const [departments, setDepartments]   = useState<Department[]>([])
  const [selDept, setSelDept]           = useState<number | null>(null)
  const [rooms, setRooms]               = useState<Room[]>([])
  const [faculty, setFaculty]           = useState<Faculty[]>([])
  const [courses, setCourses]           = useState<Course[]>([])
  const [sections, setSections]         = useState<Section[]>([])

  // Form states
  const [newRoom,    setNewRoom]    = useState({ name: '', capacity: 60, room_type: 'classroom' })
  const [newFaculty, setNewFaculty] = useState({ name: '', email: '', subjects: '' })
  const [newCourse,  setNewCourse]  = useState({ name: '', code: '', theory_hours: 3, practical_hours: 0, credit_hours: 3, is_core: false, requires_lab: false })
  const [newSection, setNewSection] = useState({ name: '', student_count: 60, semester: 5 })

  useEffect(() => { API.getInstitutions().then(setInstitutions) }, [])
  useEffect(() => {
    if (!selInst) return
    API.getDepartments(selInst).then(d => { setDepartments(d); if (d.length) setSelDept(d[0].id) })
    API.getRooms(selInst).then(setRooms)
    API.getFaculty(selInst).then(setFaculty)
  }, [selInst])
  useEffect(() => {
    if (!selDept) return
    API.getCourses(selDept).then(setCourses)
    API.getSections(selDept).then(setSections)
  }, [selDept])

  const addRoom = async () => {
    if (!selInst || !newRoom.name) return toast.error('Fill in room name')
    try {
      const r = await API.createRoom({ ...newRoom, institution_id: selInst, capacity: Number(newRoom.capacity) })
      setRooms(prev => [...prev, r])
      setNewRoom({ name: '', capacity: 60, room_type: 'classroom' })
      toast.success('Room added')
    } catch { toast.error('Failed to add room') }
  }

  const addFaculty = async () => {
    if (!selInst || !newFaculty.name) return toast.error('Fill in faculty name')
    try {
      const subjects = newFaculty.subjects.split(',').map(s => s.trim()).filter(Boolean)
      const f = await API.createFaculty({ ...newFaculty, subjects, institution_id: selInst, phone: '', unavailable_slots: [], max_consecutive_periods: 3 })
      setFaculty(prev => [...prev, f])
      setNewFaculty({ name: '', email: '', subjects: '' })
      toast.success('Faculty added')
    } catch { toast.error('Failed to add faculty') }
  }

  const addCourse = async () => {
    if (!selDept || !newCourse.name) return toast.error('Fill in course name')
    try {
      const c = await API.createCourse({ ...newCourse, department_id: selDept, theory_hours: Number(newCourse.theory_hours), practical_hours: Number(newCourse.practical_hours), credit_hours: Number(newCourse.credit_hours) })
      setCourses(prev => [...prev, c])
      setNewCourse({ name: '', code: '', theory_hours: 3, practical_hours: 0, credit_hours: 3, is_core: false, requires_lab: false })
      toast.success('Course added')
    } catch { toast.error('Failed to add course') }
  }

  const addSection = async () => {
    if (!selDept || !newSection.name) return toast.error('Fill in section name')
    try {
      const s = await API.createSection({ ...newSection, department_id: selDept, student_count: Number(newSection.student_count), semester: Number(newSection.semester) })
      setSections(prev => [...prev, s])
      setNewSection({ name: '', student_count: 60, semester: 5 })
      toast.success('Section added')
    } catch { toast.error('Failed to add section') }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-50">Setup</h1>
        <p className="text-slate-400 text-sm mt-0.5">Configure your institution, rooms, faculty, courses and sections</p>
      </div>

      {/* Institution + Department selector */}
      <div className="glass p-5 flex gap-4 items-end">
        <div className="flex-1">
          <label className="label">Institution</label>
          <select className="select" value={selInst ?? ''} onChange={e => setSelInst(Number(e.target.value))}>
            <option value="" disabled>Select institution…</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="label">Department</label>
          <select className="select" value={selDept ?? ''} onChange={e => setSelDept(Number(e.target.value))}>
            <option value="" disabled>Select department…</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="text-xs text-slate-500 pb-3">
          {selInst && <span className="badge-green">Institution #{selInst}</span>}
        </div>
      </div>

      {selInst && (
        <>
          {/* NLP Box */}
          <NLPBox instId={selInst} />

          {/* Rooms */}
          <Panel title={`Rooms (${rooms.length})`} icon={DoorOpen} colour="blue">
            <div className="flex gap-2 mb-4 flex-wrap">
              <input className="input flex-1 min-w-32" placeholder="Room name" value={newRoom.name} onChange={e => setNewRoom(p=>({...p,name:e.target.value}))} />
              <input className="input w-24" type="number" placeholder="Capacity" value={newRoom.capacity} onChange={e => setNewRoom(p=>({...p,capacity:Number(e.target.value)}))} />
              <select className="select w-36" value={newRoom.room_type} onChange={e => setNewRoom(p=>({...p,room_type:e.target.value}))}>
                <option value="classroom">Classroom</option>
                <option value="lab">Lab</option>
                <option value="lecture_hall">Lecture Hall</option>
              </select>
              <button className="btn-primary shrink-0" onClick={addRoom}><Plus className="w-4 h-4"/>Add</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {rooms.map(r => (
                <div key={r.id} className="glass-sm p-3 flex items-center gap-2">
                  <div className={clsx('w-2 h-2 rounded-full shrink-0', r.room_type==='lab'?'bg-emerald-400':r.room_type==='lecture_hall'?'bg-amber-400':'bg-blue-400')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate">{r.name}</p>
                    <p className="text-[10px] text-slate-500">{r.room_type} · {r.capacity} seats</p>
                  </div>
                  <button className="btn-icon" onClick={async () => { await API.deleteRoom(r.id); setRooms(p=>p.filter(x=>x.id!==r.id)) }}>
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          {/* Faculty */}
          <Panel title={`Faculty (${faculty.length})`} icon={Users} colour="purple">
            <div className="flex gap-2 mb-4 flex-wrap">
              <input className="input flex-1 min-w-32" placeholder="Full name" value={newFaculty.name} onChange={e => setNewFaculty(p=>({...p,name:e.target.value}))} />
              <input className="input flex-1 min-w-32" placeholder="Email" value={newFaculty.email} onChange={e => setNewFaculty(p=>({...p,email:e.target.value}))} />
              <input className="input flex-1 min-w-32" placeholder="Subjects (comma-separated)" value={newFaculty.subjects} onChange={e => setNewFaculty(p=>({...p,subjects:e.target.value}))} />
              <button className="btn-primary shrink-0" onClick={addFaculty}><Plus className="w-4 h-4"/>Add</button>
            </div>
            {faculty.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Email</th><th>Subjects</th><th></th></tr></thead>
                  <tbody>
                    {faculty.map(f => (
                      <tr key={f.id}>
                        <td className="font-medium">{f.name}</td>
                        <td className="text-slate-500 text-xs">{f.email}</td>
                        <td>{(f.subjects||[]).map(s=><span key={s} className="badge-blue mr-1">{s}</span>)}</td>
                        <td>
                          <button className="btn-icon" onClick={async()=>{await API.deleteFaculty(f.id);setFaculty(p=>p.filter(x=>x.id!==f.id))}}>
                            <Trash2 className="w-3 h-3 text-red-400"/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {selDept && (
            <>
              {/* Courses */}
              <Panel title={`Courses (${courses.length})`} icon={BookOpen} colour="amber">
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <input className="input" placeholder="Course name" value={newCourse.name} onChange={e=>setNewCourse(p=>({...p,name:e.target.value}))}/>
                  <input className="input" placeholder="Code (e.g. CS501)" value={newCourse.code} onChange={e=>setNewCourse(p=>({...p,code:e.target.value}))}/>
                  <div className="flex gap-2">
                    <div className="flex-1"><label className="label">Theory hrs/wk</label><input className="input" type="number" min={0} max={8} value={newCourse.theory_hours} onChange={e=>setNewCourse(p=>({...p,theory_hours:Number(e.target.value)}))}/></div>
                    <div className="flex-1"><label className="label">Practical hrs/wk</label><input className="input" type="number" min={0} max={8} value={newCourse.practical_hours} onChange={e=>setNewCourse(p=>({...p,practical_hours:Number(e.target.value)}))}/></div>
                    <div className="flex-1"><label className="label">Credits</label><input className="input" type="number" min={1} max={6} value={newCourse.credit_hours} onChange={e=>setNewCourse(p=>({...p,credit_hours:Number(e.target.value)}))}/></div>
                  </div>
                  <div className="flex gap-4 items-center">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="rounded" checked={newCourse.is_core} onChange={e=>setNewCourse(p=>({...p,is_core:e.target.checked}))}/>
                      <span className="text-sm text-slate-300">Core subject</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="rounded" checked={newCourse.requires_lab} onChange={e=>setNewCourse(p=>({...p,requires_lab:e.target.checked}))}/>
                      <span className="text-sm text-slate-300">Requires lab</span>
                    </label>
                    <button className="btn-primary ml-auto" onClick={addCourse}><Plus className="w-4 h-4"/>Add Course</button>
                  </div>
                </div>
                {courses.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Name</th><th>Code</th><th>Theory</th><th>Practical</th><th>Core</th><th>Lab</th><th></th></tr></thead>
                      <tbody>
                        {courses.map(c => (
                          <tr key={c.id}>
                            <td className="font-medium">{c.name}</td>
                            <td className="text-slate-500 font-mono text-xs">{c.code}</td>
                            <td>{c.theory_hours}h</td>
                            <td>{c.practical_hours}h</td>
                            <td>{c.is_core?<span className="badge-green">Core</span>:'—'}</td>
                            <td>{c.requires_lab?<span className="badge-amber">Lab</span>:'—'}</td>
                            <td><button className="btn-icon" onClick={async()=>{await API.deleteCourse(c.id);setCourses(p=>p.filter(x=>x.id!==c.id))}}><Trash2 className="w-3 h-3 text-red-400"/></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              {/* Sections */}
              <Panel title={`Sections (${sections.length})`} icon={GraduationCap} colour="emerald">
                <div className="flex gap-2 mb-4 flex-wrap">
                  <input className="input flex-1" placeholder="Section name (e.g. CS-A)" value={newSection.name} onChange={e=>setNewSection(p=>({...p,name:e.target.value}))}/>
                  <input className="input w-32" type="number" placeholder="Students" value={newSection.student_count} onChange={e=>setNewSection(p=>({...p,student_count:Number(e.target.value)}))}/>
                  <input className="input w-24" type="number" placeholder="Semester" value={newSection.semester} onChange={e=>setNewSection(p=>({...p,semester:Number(e.target.value)}))}/>
                  <button className="btn-primary shrink-0" onClick={addSection}><Plus className="w-4 h-4"/>Add</button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {sections.map(s => (
                    <div key={s.id} className="glass-sm p-3">
                      <p className="font-semibold text-slate-200 text-sm">{s.name}</p>
                      <p className="text-xs text-slate-500">{s.student_count} students · Sem {s.semester}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  )
}
