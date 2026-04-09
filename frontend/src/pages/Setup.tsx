import { useEffect, useState } from 'react'
import { API, type Institution, type Department, type Room, type Faculty, type Course, type Section } from '../api/client'
import toast from 'react-hot-toast'
import {
  Building2, Users, BookOpen, DoorOpen, GraduationCap,
  Plus, Trash2, Save, ChevronDown, ChevronUp, Cpu, Brain
} from 'lucide-react'
import clsx from 'clsx'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat']

// ─── Color Map (White/Blue Theme) ─────────────────────────────────────────────
const COLOUR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  brand:   { bg: 'bg-blue-50',    text: 'text-blue-600',   border: 'border-blue-200' },
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',   border: 'border-blue-200' },
  purple:  { bg: 'bg-violet-50',  text: 'text-violet-600', border: 'border-violet-200' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',  border: 'border-amber-200' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600',border: 'border-emerald-200' },
}

// ─── Shared Tailwind class strings ────────────────────────────────────────────
const card      = 'bg-white border border-gray-200 rounded-xl shadow-sm'
const cardSm    = 'bg-gray-50 border border-gray-200 rounded-lg'
const inputCls  = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition'
const selectCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition'
const labelCls  = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'
const btnPrimary= 'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg transition shadow-sm'
const btnIcon   = 'p-1.5 rounded-md hover:bg-red-50 transition'
const badgeGreen = 'inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide'
const badgeBlue  = 'inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-700 uppercase tracking-wide'
const badgeAmber = 'inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700 uppercase tracking-wide'
const badgePurple= 'inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-violet-100 text-violet-700 uppercase tracking-wide'

// ─── Collapsible Panel ────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, children, colour = 'brand' }: any) {
  const [open, setOpen] = useState(true)
  const cm = COLOUR_MAP[colour] || COLOUR_MAP.brand
  return (
    <div className={card + ' overflow-hidden'}>
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-lg ${cm.bg} border ${cm.border} flex items-center justify-center`}>
            <Icon className={`w-3.5 h-3.5 ${cm.text}`} />
          </div>
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400" />
          : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div className="pt-4">{children}</div>
        </div>
      )}
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
    <div className={`${card} p-5 border-blue-200 bg-blue-50/40`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center">
          <Brain className="w-3.5 h-3.5 text-blue-600" />
        </div>
        <h3 className="text-sm font-semibold text-gray-800">AI Constraint Parser</h3>
        <span className={badgePurple + ' ml-auto'}>NLP</span>
      </div>
      <p className="text-gray-500 text-xs mb-3">
        Type a constraint in plain English — AI will parse it into a structured rule.
      </p>
      <div className="flex gap-2">
        <input
          className={inputCls + ' flex-1'}
          placeholder='e.g. "Dr. Sharma cannot teach before 10am on Mondays"'
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && parse()}
        />
        <button className={btnPrimary + ' shrink-0'} onClick={parse} disabled={loading}>
          {loading
            ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Cpu className="w-4 h-4" />}
          Parse
        </button>
      </div>
      {result && (
        <div className="mt-3 p-3 rounded-xl bg-white border border-gray-200 shadow-sm">
          <p className="text-xs text-emerald-600 font-semibold mb-1">✓ {result.description}</p>
          <pre className="text-xs text-gray-500 overflow-x-auto">
            {JSON.stringify(result.parsed, null, 2)}
          </pre>
          <p className="text-xs text-gray-400 mt-1">
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
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
        <p className="text-gray-500 text-sm mt-0.5">Configure your institution, rooms, faculty, courses and sections</p>
      </div>

      {/* Institution + Department Selector */}
      <div className={`${card} p-5`}>
        <div className="flex gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-48">
            <label className={labelCls}>Institution</label>
            <select className={selectCls} value={selInst ?? ''} onChange={e => setSelInst(Number(e.target.value))}>
              <option value="" disabled>Select institution…</option>
              {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-48">
            <label className={labelCls}>Department</label>
            <select className={selectCls} value={selDept ?? ''} onChange={e => setSelDept(Number(e.target.value))}>
              <option value="" disabled>Select department…</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {selInst && (
            <div className="pb-0.5">
              <span className={badgeBlue}>Institution #{selInst}</span>
            </div>
          )}
        </div>
      </div>

      {selInst && (
        <>
          {/* NLP Box */}
          <NLPBox instId={selInst} />

          {/* Rooms */}
          <Panel title={`Rooms (${rooms.length})`} icon={DoorOpen} colour="blue">
            <div className="flex gap-2 mb-4 flex-wrap">
              <input className={inputCls + ' flex-1 min-w-32'} placeholder="Room name" value={newRoom.name} onChange={e => setNewRoom(p=>({...p,name:e.target.value}))} />
              <input className={inputCls + ' w-28'} type="number" placeholder="Capacity" value={newRoom.capacity} onChange={e => setNewRoom(p=>({...p,capacity:Number(e.target.value)}))} />
              <select className={selectCls + ' w-36'} value={newRoom.room_type} onChange={e => setNewRoom(p=>({...p,room_type:e.target.value}))}>
                <option value="classroom">Classroom</option>
                <option value="lab">Lab</option>
                <option value="lecture_hall">Lecture Hall</option>
              </select>
              <button className={btnPrimary + ' shrink-0'} onClick={addRoom}>
                <Plus className="w-4 h-4"/>Add
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {rooms.map(r => (
                <div key={r.id} className={`${cardSm} p-3 flex items-center gap-2`}>
                  <div className={clsx('w-2 h-2 rounded-full shrink-0',
                    r.room_type==='lab' ? 'bg-emerald-500' :
                    r.room_type==='lecture_hall' ? 'bg-amber-500' : 'bg-blue-500'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{r.name}</p>
                    <p className="text-[10px] text-gray-500 capitalize">{r.room_type} · {r.capacity} seats</p>
                  </div>
                  <button className={btnIcon} onClick={async () => { await API.deleteRoom(r.id); setRooms(p=>p.filter(x=>x.id!==r.id)) }}>
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          {/* Faculty */}
          <Panel title={`Faculty (${faculty.length})`} icon={Users} colour="purple">
            <div className="flex gap-2 mb-4 flex-wrap">
              <input className={inputCls + ' flex-1 min-w-32'} placeholder="Full name" value={newFaculty.name} onChange={e => setNewFaculty(p=>({...p,name:e.target.value}))} />
              <input className={inputCls + ' flex-1 min-w-32'} placeholder="Email" value={newFaculty.email} onChange={e => setNewFaculty(p=>({...p,email:e.target.value}))} />
              <input className={inputCls + ' flex-1 min-w-32'} placeholder="Subjects (comma-separated)" value={newFaculty.subjects} onChange={e => setNewFaculty(p=>({...p,subjects:e.target.value}))} />
              <button className={btnPrimary + ' shrink-0'} onClick={addFaculty}>
                <Plus className="w-4 h-4"/>Add
              </button>
            </div>
            {faculty.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Subjects</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {faculty.map(f => (
                      <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{f.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{f.email}</td>
                        <td className="px-4 py-3">{(f.subjects||[]).map(s=><span key={s} className={badgeBlue + ' mr-1'}>{s}</span>)}</td>
                        <td className="px-4 py-3">
                          <button className={btnIcon} onClick={async()=>{await API.deleteFaculty(f.id);setFaculty(p=>p.filter(x=>x.id!==f.id))}}>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className={labelCls}>Course Name</label>
                    <input className={inputCls} placeholder="e.g. Data Structures" value={newCourse.name} onChange={e=>setNewCourse(p=>({...p,name:e.target.value}))}/>
                  </div>
                  <div>
                    <label className={labelCls}>Course Code</label>
                    <input className={inputCls} placeholder="e.g. CS501" value={newCourse.code} onChange={e=>setNewCourse(p=>({...p,code:e.target.value}))}/>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className={labelCls}>Theory hrs/wk</label>
                      <input className={inputCls} type="number" min={0} max={8} value={newCourse.theory_hours} onChange={e=>setNewCourse(p=>({...p,theory_hours:Number(e.target.value)}))}/>
                    </div>
                    <div className="flex-1">
                      <label className={labelCls}>Practical hrs/wk</label>
                      <input className={inputCls} type="number" min={0} max={8} value={newCourse.practical_hours} onChange={e=>setNewCourse(p=>({...p,practical_hours:Number(e.target.value)}))}/>
                    </div>
                    <div className="flex-1">
                      <label className={labelCls}>Credits</label>
                      <input className={inputCls} type="number" min={1} max={6} value={newCourse.credit_hours} onChange={e=>setNewCourse(p=>({...p,credit_hours:Number(e.target.value)}))}/>
                    </div>
                  </div>
                  <div className="flex gap-5 items-end pb-0.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={newCourse.is_core}
                        onChange={e=>setNewCourse(p=>({...p,is_core:e.target.checked}))}
                      />
                      <span className="text-sm text-gray-700">Core subject</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={newCourse.requires_lab}
                        onChange={e=>setNewCourse(p=>({...p,requires_lab:e.target.checked}))}
                      />
                      <span className="text-sm text-gray-700">Requires lab</span>
                    </label>
                    <button className={btnPrimary + ' ml-auto'} onClick={addCourse}>
                      <Plus className="w-4 h-4"/>Add Course
                    </button>
                  </div>
                </div>
                {courses.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          {['Name','Code','Theory','Practical','Core','Lab',''].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {courses.map(c => (
                          <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                            <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.code}</td>
                            <td className="px-4 py-3 text-gray-700">{c.theory_hours}h</td>
                            <td className="px-4 py-3 text-gray-700">{c.practical_hours}h</td>
                            <td className="px-4 py-3">{c.is_core ? <span className={badgeGreen}>Core</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3">{c.requires_lab ? <span className={badgeAmber}>Lab</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3">
                              <button className={btnIcon} onClick={async()=>{await API.deleteCourse(c.id);setCourses(p=>p.filter(x=>x.id!==c.id))}}>
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

              {/* Sections */}
              <Panel title={`Sections (${sections.length})`} icon={GraduationCap} colour="emerald">
                <div className="flex gap-2 mb-4 flex-wrap">
                  <input className={inputCls + ' flex-1'} placeholder="Section name (e.g. CS-A)" value={newSection.name} onChange={e=>setNewSection(p=>({...p,name:e.target.value}))}/>
                  <input className={inputCls + ' w-32'} type="number" placeholder="Students" value={newSection.student_count} onChange={e=>setNewSection(p=>({...p,student_count:Number(e.target.value)}))}/>
                  <input className={inputCls + ' w-24'} type="number" placeholder="Semester" value={newSection.semester} onChange={e=>setNewSection(p=>({...p,semester:Number(e.target.value)}))}/>
                  <button className={btnPrimary + ' shrink-0'} onClick={addSection}>
                    <Plus className="w-4 h-4"/>Add
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {sections.map(s => (
                    <div key={s.id} className={`${cardSm} p-3`}>
                      <p className="font-semibold text-gray-800 text-sm">{s.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.student_count} students · Sem {s.semester}</p>
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