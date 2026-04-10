import { useEffect, useMemo, useState } from 'react'
import { API, getErrorMessage, type Department, type Institution, type Section, type Slot, type ViewerTimetable } from '../api/client'
import toast from 'react-hot-toast'
import { BookOpen, Clock, DoorOpen, Search, Users } from 'lucide-react'
import clsx from 'clsx'

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const TYPE_COLOUR: Record<string, string> = {
  theory: 'bg-brand-600/85',
  lab: 'bg-emerald-600/85',
  break: 'bg-amber-500/85',
}

function formatTimeRange(startTime: string, period: number, durationMinutes: number, slotDuration: number) {
  const [hour, minute] = startTime.split(':').map(Number)
  const startTotal = hour * 60 + minute + period * durationMinutes
  const endTotal = startTotal + durationMinutes * Math.max(slotDuration || 1, 1)
  const format = (value: number) => {
    const hh = Math.floor(value / 60).toString().padStart(2, '0')
    const mm = (value % 60).toString().padStart(2, '0')
    return `${hh}:${mm}`
  }
  return `${format(startTotal)} - ${format(endTotal)}`
}

export default function TeacherView() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [facultyOptions, setFacultyOptions] = useState<Array<{ id: number; name: string }>>([])
  const [selInst, setSelInst] = useState<number | null>(null)
  const [selDept, setSelDept] = useState<number | null>(null)
  const [semester, setSemester] = useState<number | null>(null)
  const [selFaculty, setSelFaculty] = useState<number | null>(null)
  const [view, setView] = useState<ViewerTimetable | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    API.getInstitutions()
      .then((data) => {
        setInstitutions(data)
        if (data.length) setSelInst(data[0].id)
      })
      .catch((error) => toast.error(getErrorMessage(error, 'Failed to load institutions')))
  }, [])

  useEffect(() => {
    setView(null)
    setSelDept(null)
    setSemester(null)
    setSelFaculty(null)
    setSections([])
    setFacultyOptions([])
    if (!selInst) {
      setDepartments([])
      return
    }
    API.getDepartments(selInst)
      .then((data) => {
        setDepartments(data)
        if (data.length) setSelDept(data[0].id)
      })
      .catch((error) => toast.error(getErrorMessage(error, 'Failed to load departments')))
  }, [selInst])

  useEffect(() => {
    setView(null)
    setSemester(null)
    setSelFaculty(null)
    setFacultyOptions([])
    if (!selInst || !selDept) {
      setSections([])
      return
    }
    API.getSections(selDept)
      .then((data) => {
        setSections(data)
        const semesters = Array.from(new Set(data.map((section) => section.semester))).sort((a, b) => a - b)
        if (semesters.length) setSemester(semesters[0])
      })
      .catch((error) => toast.error(getErrorMessage(error, 'Failed to load sections')))
  }, [selInst, selDept])

  useEffect(() => {
    setView(null)
    setSelFaculty(null)
    if (!selInst || !selDept || !semester) {
      setFacultyOptions([])
      return
    }
    API.getTeacherFacultyOptions(selInst, selDept, semester)
      .then((data) => {
        setFacultyOptions(data)
        if (data.length) setSelFaculty(data[0].id)
      })
      .catch((error) => toast.error(getErrorMessage(error, 'Failed to load teachers')))
  }, [selInst, selDept, semester])

  const semesterOptions = useMemo(
    () => Array.from(new Set(sections.map((section) => section.semester))).sort((a, b) => a - b),
    [sections],
  )

  const slotsByDay = useMemo(() => {
    const grouped = new Map<number, Slot[]>()
    for (const slot of view?.slots || []) {
      const items = grouped.get(slot.day) || []
      items.push(slot)
      grouped.set(slot.day, items)
    }
    return Array.from(grouped.entries())
      .map(([day, slots]) => [day, slots.sort((a, b) => a.period - b.period)] as const)
      .sort((a, b) => a[0] - b[0])
  }, [view])

  const submit = async () => {
    if (!selInst || !selDept || !semester || !selFaculty) {
      toast.error('Select institute, department, semester, and teacher')
      return
    }
    setLoading(true)
    try {
      const data = await API.getTeacherTimetable(selInst, selDept, semester, selFaculty)
      setView(data)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load teacher timetable'))
      setView(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Teacher View</h1>
        <p className="text-[#64748B] text-sm mt-0.5">Choose institute, department, semester, and teacher name to view the latest completed weekly timetable.</p>
      </div>

      <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
        <div>
          <label className="label-xs">Institute</label>
          <select className="select" value={selInst ?? ''} onChange={(event) => setSelInst(Number(event.target.value))}>
            <option value="" disabled>Select institute...</option>
            {institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label-xs">Department</label>
          <select className="select" value={selDept ?? ''} onChange={(event) => setSelDept(Number(event.target.value))} disabled={!departments.length}>
            <option value="" disabled>Select department...</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label-xs">Semester</label>
          <select className="select" value={semester ?? ''} onChange={(event) => setSemester(Number(event.target.value))} disabled={!semesterOptions.length}>
            <option value="" disabled>Select semester...</option>
            {semesterOptions.map((value) => <option key={value} value={value}>Semester {value}</option>)}
          </select>
        </div>
        <div>
          <label className="label-xs">Teacher Name</label>
          <select className="select" value={selFaculty ?? ''} onChange={(event) => setSelFaculty(Number(event.target.value))} disabled={!facultyOptions.length}>
            <option value="" disabled>Select teacher...</option>
            {facultyOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </div>
        <button className="btn btn-primary h-10" onClick={submit} disabled={loading}>
          <Search className="w-4 h-4" />
          {loading ? 'Loading...' : 'Submit'}
        </button>
      </div>

      {view && (
        <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm p-4 flex flex-wrap gap-3">
          <span className="badge badge-info">{view.institution_name}</span>
          <span className="badge badge-success">{view.department_name}</span>
          <span className="badge badge-warn">Semester {view.semester}</span>
          <span className="badge badge-info">{view.faculty_name}</span>
          <span className="badge badge-success">{view.timetable_name}</span>
        </div>
      )}

      {!view ? (
        <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm min-h-[300px] flex flex-col items-center justify-center text-[#64748B]">
          <Users className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Submit teacher details to view the weekly timetable.</p>
        </div>
      ) : slotsByDay.length === 0 ? (
        <div className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm min-h-[300px] flex flex-col items-center justify-center text-[#64748B]">
          <BookOpen className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">No classes found for this teacher in the selected department.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {slotsByDay.map(([day, slots]) => (
            <div key={day} className="bg-white border border-[#E4E7EF] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E4E7EF] bg-slate-50">
                <h3 className="font-semibold text-[#0F172A] text-sm">{DAY_LABELS[day] || `Day ${day}`}</h3>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {slots.map((slot) => (
                  <div key={slot.id} className={clsx('rounded-xl p-4 text-white shadow-sm', TYPE_COLOUR[slot.slot_type] || TYPE_COLOUR.theory)}>
                    <p className="font-semibold text-sm leading-tight">{slot.course_name}</p>
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-white/90">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        {formatTimeRange(view.start_time, slot.period, view.period_duration_minutes, slot.duration)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-white/90">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        {slot.section_name || 'Combined section'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-white/90">
                        <DoorOpen className="w-3.5 h-3.5 shrink-0" />
                        {slot.room_name || 'Room TBD'}
                      </div>
                    </div>
                    {slot.is_combined && (
                      <span className="mt-3 inline-block text-[10px] font-bold bg-white/20 rounded px-2 py-1">COMBINED</span>
                    )}
                    {slot.slot_type === 'lab' && (
                      <span className="mt-3 ml-2 inline-block text-[10px] font-bold bg-white/20 rounded px-2 py-1">LAB</span>
                    )}
                    {slot.slot_type === 'break' && (
                      <span className="mt-3 inline-block text-[10px] font-bold bg-white/20 rounded px-2 py-1">BREAK</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
