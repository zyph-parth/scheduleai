import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  API,
  type CombinedGroup,
  type Course,
  type Department,
  type Faculty,
  type Institution,
  type InstitutionPayload,
  type Room,
  type Section,
  type SectionCourse,
  getErrorMessage,
} from '../api/client'
import {
  BookOpen,
  Brain,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Cpu,
  DoorOpen,
  GraduationCap,
  Link2,
  Plus,
  Save,
  Trash2,
  Users,
} from 'lucide-react'

const DAY_OPTIONS = [
  { value: 0, short: 'Mon', label: 'Monday' },
  { value: 1, short: 'Tue', label: 'Tuesday' },
  { value: 2, short: 'Wed', label: 'Wednesday' },
  { value: 3, short: 'Thu', label: 'Thursday' },
  { value: 4, short: 'Fri', label: 'Friday' },
  { value: 5, short: 'Sat', label: 'Saturday' },
  { value: 6, short: 'Sun', label: 'Sunday' },
] as const

const card = 'bg-white border border-gray-200 rounded-xl shadow-sm'
const cardSm = 'bg-gray-50 border border-gray-200 rounded-lg'
const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition'
const selectCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition'
const labelCls = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'
const btnPrimary = 'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg transition shadow-sm disabled:opacity-60 disabled:cursor-not-allowed'
const btnSecondary = 'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition'
const btnIcon = 'p-1.5 rounded-md hover:bg-red-50 transition'
const badgeBlue = 'inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-700 uppercase tracking-wide'
const badgeGreen = 'inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide'
const badgeAmber = 'inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700 uppercase tracking-wide'
const badgePurple = 'inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full bg-violet-100 text-violet-700 uppercase tracking-wide'

type InstitutionForm = {
  name: string
  working_days: number[]
  start_time: string
  period_duration_minutes: number
  periods_by_day: Record<string, number>
  breaks_by_day: Record<string, string>
}

type FacultyForm = {
  name: string
  email: string
  phone: string
  subjects: string
  max_consecutive_periods: number
  unavailable_slots: { day: number; period: number }[]
}

function defaultInstitutionForm(): InstitutionForm {
  return {
    name: '',
    working_days: [0, 1, 2, 3, 4],
    start_time: '09:00',
    period_duration_minutes: 50,
    periods_by_day: { '0': 8, '1': 8, '2': 8, '3': 8, '4': 8, '5': 6, '6': 0 },
    breaks_by_day: { '0': '3', '1': '3', '2': '3', '3': '3', '4': '3', '5': '', '6': '' },
  }
}

function institutionToForm(inst: Institution): InstitutionForm {
  const base = defaultInstitutionForm()
  const periodsByDay = { ...base.periods_by_day }
  const breaksByDay = { ...base.breaks_by_day }

  for (const day of DAY_OPTIONS) {
    const periods = inst.periods_per_day[String(day.value)] || []
    periodsByDay[String(day.value)] = periods.length
    breaksByDay[String(day.value)] = (inst.break_slots[String(day.value)] || []).join(', ')
  }

  return {
    name: inst.name,
    working_days: [...inst.working_days].sort((a, b) => a - b),
    start_time: inst.start_time,
    period_duration_minutes: inst.period_duration_minutes,
    periods_by_day: periodsByDay,
    breaks_by_day: breaksByDay,
  }
}

function buildInstitutionPayload(form: InstitutionForm): InstitutionPayload {
  const workingDays = [...form.working_days].sort((a, b) => a - b)
  const periods_per_day: Record<string, number[]> = {}
  const break_slots: Record<string, number[]> = {}

  for (const day of workingDays) {
    const key = String(day)
    const count = Math.max(Number(form.periods_by_day[key] || 0), 0)
    periods_per_day[key] = Array.from({ length: count }, (_, index) => index)
    break_slots[key] = (form.breaks_by_day[key] || '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value, index, arr) => Number.isInteger(value) && value >= 0 && value < count && arr.indexOf(value) === index)
      .sort((a, b) => a - b)
  }

  return {
    name: form.name.trim(),
    working_days: workingDays,
    periods_per_day,
    break_slots,
    period_duration_minutes: Number(form.period_duration_minutes),
    start_time: form.start_time,
  }
}

function toggleNumber(values: number[], target: number) {
  return values.includes(target)
    ? values.filter((value) => value !== target)
    : [...values, target].sort((a, b) => a - b)
}

function toggleUnavailableSlot(
  slots: { day: number; period: number }[],
  target: { day: number; period: number },
) {
  const exists = slots.some((slot) => slot.day === target.day && slot.period === target.period)
  if (exists) {
    return slots.filter((slot) => !(slot.day === target.day && slot.period === target.period))
  }
  return [...slots, target].sort((a, b) => (a.day - b.day) || (a.period - b.period))
}

function getPeriodList(inst?: Institution | null, day?: number) {
  if (!inst || day === undefined) return []
  return inst.periods_per_day[String(day)] || []
}

function Panel({
  title,
  icon: Icon,
  children,
  colour = 'blue',
  openByDefault = true,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  children: ReactNode
  colour?: 'blue' | 'purple' | 'amber' | 'green'
  openByDefault?: boolean
}) {
  const [open, setOpen] = useState(openByDefault)
  const styles = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    purple: 'bg-violet-50 text-violet-600 border-violet-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  }[colour]

  return (
    <div className={`${card} overflow-hidden`}>
      <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors" onClick={() => setOpen((value) => !value)}>
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${styles}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100"><div className="pt-4">{children}</div></div>}
    </div>
  )
}

function AvailabilityGrid({
  institution,
  value,
  onToggle,
}: {
  institution: Institution
  value: { day: number; period: number }[]
  onToggle: (slot: { day: number; period: number }) => void
}) {
  const workingDays = institution.working_days || []
  const maxPeriods = Math.max(0, ...workingDays.map((day) => getPeriodList(institution, day).length))

  if (!workingDays.length || maxPeriods === 0) {
    return <p className="text-xs text-gray-500">Configure the institution schedule first.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Day</th>
            {Array.from({ length: maxPeriods }, (_, index) => <th key={index} className="px-2 py-2 text-center font-semibold text-gray-500 uppercase tracking-wide">P{index}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {workingDays.map((day) => {
            const validPeriods = new Set(getPeriodList(institution, day))
            return (
              <tr key={day}>
                <td className="px-3 py-2 font-medium text-gray-700">{DAY_OPTIONS.find((item) => item.value === day)?.short}</td>
                {Array.from({ length: maxPeriods }, (_, period) => {
                  const active = value.some((slot) => slot.day === day && slot.period === period)
                  const enabled = validPeriods.has(period)
                  return (
                    <td key={`${day}-${period}`} className="px-2 py-2 text-center">
                      <button
                        type="button"
                        disabled={!enabled}
                        onClick={() => enabled && onToggle({ day, period })}
                        className={clsx(
                          'w-7 h-7 rounded-md border text-[10px] font-semibold transition',
                          !enabled && 'bg-gray-100 border-gray-200 text-gray-300 cursor-not-allowed',
                          enabled && !active && 'bg-white border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600',
                          enabled && active && 'bg-blue-600 border-blue-600 text-white',
                        )}
                      >
                        {period}
                      </button>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NLPBox({ institutionId }: { institutionId: number }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const parse = async () => {
    if (!text.trim()) return
    setLoading(true)
    try {
      const parsed = await API.parseConstraint(institutionId, text)
      setResult(parsed)
      toast.success('Constraint parsed successfully')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to parse constraint'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`${card} p-5 border-blue-200 bg-blue-50/40`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center">
          <Brain className="w-3.5 h-3.5 text-blue-600" />
        </div>
        <h3 className="text-sm font-semibold text-gray-800">AI Constraint Parser</h3>
        <span className={`${badgePurple} ml-auto`}>NLP</span>
      </div>
      <p className="text-gray-500 text-xs mb-3">Parse natural-language constraints using the selected institution&apos;s faculty, courses, and timing rules.</p>
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder='e.g. "Dr. Sharma cannot teach before 10:30 on Mondays"' value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && parse()} />
        <button className={`${btnPrimary} shrink-0`} onClick={parse} disabled={loading}>
          {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Cpu className="w-4 h-4" />}
          Parse
        </button>
      </div>
      {result && (
        <div className="mt-3 p-3 rounded-xl bg-white border border-gray-200 shadow-sm">
          <p className="text-xs text-emerald-600 font-semibold mb-1">{result.description}</p>
          <pre className="text-xs text-gray-500 overflow-x-auto">{JSON.stringify(result.parsed, null, 2)}</pre>
          <p className="text-xs text-gray-400 mt-1">Confidence: {Math.round((result.confidence || 0.5) * 100)}%</p>
        </div>
      )}
    </div>
  )
}

export default function Setup() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [faculty, setFaculty] = useState<Faculty[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [sectionCourses, setSectionCourses] = useState<SectionCourse[]>([])
  const [combinedGroups, setCombinedGroups] = useState<CombinedGroup[]>([])

  const [selInst, setSelInst] = useState<number | null>(null)
  const [selDept, setSelDept] = useState<number | null>(null)

  const [institutionForm, setInstitutionForm] = useState<InstitutionForm>(defaultInstitutionForm())
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [newRoom, setNewRoom] = useState({ name: '', capacity: 60, room_type: 'classroom' })
  const [newFaculty, setNewFaculty] = useState<FacultyForm>({
    name: '',
    email: '',
    phone: '',
    subjects: '',
    max_consecutive_periods: 3,
    unavailable_slots: [],
  })
  const [newCourse, setNewCourse] = useState({
    name: '',
    code: '',
    theory_hours: 3,
    practical_hours: 0,
    credit_hours: 3,
    is_core: false,
    requires_lab: false,
  })
  const [newSection, setNewSection] = useState({ name: '', student_count: 60, semester: 1 })
  const [newAssignment, setNewAssignment] = useState({ section_id: 0, course_id: 0, faculty_id: 0 })
  const [newCombinedGroup, setNewCombinedGroup] = useState({ section_ids: [] as number[], course_id: 0, faculty_id: 0 })

  const selectedInstitution = useMemo(
    () => institutions.find((institution) => institution.id === selInst) ?? null,
    [institutions, selInst],
  )
  const selectedDepartment = useMemo(
    () => departments.find((department) => department.id === selDept) ?? null,
    [departments, selDept],
  )

  const sectionMap = useMemo(() => Object.fromEntries(sections.map((section) => [section.id, section])), [sections])
  const courseMap = useMemo(() => Object.fromEntries(courses.map((course) => [course.id, course])), [courses])
  const facultyMap = useMemo(() => Object.fromEntries(faculty.map((member) => [member.id, member])), [faculty])

  const visibleCombinedGroups = useMemo(() => {
    const sectionIds = new Set(sections.map((section) => section.id))
    return combinedGroups.filter((group) => group.section_ids.some((id) => sectionIds.has(id)))
  }, [combinedGroups, sections])

  const institutionSummary = useMemo(() => {
    if (!selectedInstitution) return []
    return DAY_OPTIONS
      .filter((day) => selectedInstitution.working_days.includes(day.value))
      .map((day) => ({
        day: day.short,
        periods: getPeriodList(selectedInstitution, day.value).length,
        breaks: (selectedInstitution.break_slots[String(day.value)] || []).join(', '),
      }))
  }, [selectedInstitution])

  const loadInstitutions = async (preferredId?: number | null) => {
    const data = await API.getInstitutions()
    setInstitutions(data)

    const nextId =
      (preferredId && data.some((item) => item.id === preferredId) && preferredId) ||
      (selInst && data.some((item) => item.id === selInst) && selInst) ||
      data[0]?.id ||
      null

    setSelInst(nextId)
  }

  const loadInstitutionWorkspace = async (institutionId: number, preferredDepartmentId?: number | null) => {
    const [departmentData, roomData, facultyData, groupData] = await Promise.all([
      API.getDepartments(institutionId),
      API.getRooms(institutionId),
      API.getFaculty(institutionId),
      API.getCombinedGroups(institutionId),
    ])

    setDepartments(departmentData)
    setRooms(roomData)
    setFaculty(facultyData)
    setCombinedGroups(groupData)

    const nextDepartmentId =
      (preferredDepartmentId && departmentData.some((item) => item.id === preferredDepartmentId) && preferredDepartmentId) ||
      (selDept && departmentData.some((item) => item.id === selDept) && selDept) ||
      departmentData[0]?.id ||
      null

    setSelDept(nextDepartmentId)
  }

  const loadDepartmentWorkspace = async (departmentId: number) => {
    const [courseData, sectionData] = await Promise.all([API.getCourses(departmentId), API.getSections(departmentId)])
    setCourses(courseData)
    setSections(sectionData)
    const assignmentLists = await Promise.all(sectionData.map((section) => API.getSectionCourses(section.id)))
    setSectionCourses(assignmentLists.flat())
  }

  useEffect(() => {
    loadInstitutions().catch((error) => toast.error(getErrorMessage(error, 'Unable to load institutions')))
  }, [])

  useEffect(() => {
    if (!selInst) {
      setDepartments([])
      setRooms([])
      setFaculty([])
      setCombinedGroups([])
      setSelDept(null)
      return
    }
    loadInstitutionWorkspace(selInst).catch((error) => toast.error(getErrorMessage(error, 'Unable to load institution data')))
  }, [selInst])

  useEffect(() => {
    if (!selDept) {
      setCourses([])
      setSections([])
      setSectionCourses([])
      return
    }
    loadDepartmentWorkspace(selDept).catch((error) => toast.error(getErrorMessage(error, 'Unable to load department data')))
  }, [selDept])

  useEffect(() => {
    setInstitutionForm(selectedInstitution ? institutionToForm(selectedInstitution) : defaultInstitutionForm())
  }, [selectedInstitution])

  useEffect(() => {
    if (!selectedInstitution) {
      setNewFaculty((current) => ({ ...current, unavailable_slots: [] }))
      return
    }
    const allowed = new Set(
      selectedInstitution.working_days.flatMap((day) =>
        getPeriodList(selectedInstitution, day).map((period) => `${day}-${period}`),
      ),
    )
    setNewFaculty((current) => ({
      ...current,
      unavailable_slots: current.unavailable_slots.filter((slot) => allowed.has(`${slot.day}-${slot.period}`)),
    }))
  }, [selectedInstitution])

  useEffect(() => {
    if (!sections.length) {
      setNewAssignment({ section_id: 0, course_id: 0, faculty_id: 0 })
      setNewCombinedGroup({ section_ids: [], course_id: 0, faculty_id: 0 })
      return
    }

    setNewAssignment((current) => ({
      section_id: current.section_id && sections.some((section) => section.id === current.section_id) ? current.section_id : sections[0].id,
      course_id: current.course_id && courses.some((course) => course.id === current.course_id) ? current.course_id : courses[0]?.id || 0,
      faculty_id: current.faculty_id && faculty.some((member) => member.id === current.faculty_id) ? current.faculty_id : faculty[0]?.id || 0,
    }))

    setNewCombinedGroup((current) => ({
      section_ids: current.section_ids.filter((id) => sections.some((section) => section.id === id)),
      course_id: current.course_id && courses.some((course) => course.id === current.course_id) ? current.course_id : courses[0]?.id || 0,
      faculty_id: current.faculty_id && faculty.some((member) => member.id === current.faculty_id) ? current.faculty_id : faculty[0]?.id || 0,
    }))
  }, [courses, faculty, sections])

  const createInstitution = async () => {
    try {
      const created = await API.createInstitution(buildInstitutionPayload(institutionForm))
      toast.success('Institution created')
      await loadInstitutions(created.id)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to create institution'))
    }
  }

  const saveInstitution = async () => {
    if (!selInst) return
    try {
      const updated = await API.updateInstitution(selInst, buildInstitutionPayload(institutionForm))
      toast.success('Institution schedule updated')
      await loadInstitutions(updated.id)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to update institution'))
    }
  }

  const addDepartment = async () => {
    if (!selInst || !newDepartmentName.trim()) {
      toast.error('Enter a department name first')
      return
    }
    try {
      const created = await API.createDepartment({ institution_id: selInst, name: newDepartmentName.trim() })
      setNewDepartmentName('')
      toast.success('Department added')
      await loadInstitutionWorkspace(selInst, created.id)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add department'))
    }
  }

  const addRoom = async () => {
    if (!selInst || !newRoom.name.trim()) {
      toast.error('Enter a room name first')
      return
    }
    try {
      await API.createRoom({ institution_id: selInst, name: newRoom.name.trim(), capacity: Number(newRoom.capacity), room_type: newRoom.room_type })
      setNewRoom({ name: '', capacity: 60, room_type: 'classroom' })
      toast.success('Room added')
      await loadInstitutionWorkspace(selInst, selDept)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add room'))
    }
  }

  const addFaculty = async () => {
    if (!selInst || !newFaculty.name.trim()) {
      toast.error('Enter a faculty name first')
      return
    }
    try {
      await API.createFaculty({
        institution_id: selInst,
        name: newFaculty.name.trim(),
        email: newFaculty.email.trim(),
        phone: newFaculty.phone.trim(),
        subjects: newFaculty.subjects.split(',').map((value) => value.trim()).filter(Boolean),
        unavailable_slots: newFaculty.unavailable_slots,
        max_consecutive_periods: Number(newFaculty.max_consecutive_periods),
      })
      setNewFaculty({ name: '', email: '', phone: '', subjects: '', max_consecutive_periods: 3, unavailable_slots: [] })
      toast.success('Faculty added')
      await loadInstitutionWorkspace(selInst, selDept)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add faculty'))
    }
  }

  const addCourse = async () => {
    if (!selDept || !newCourse.name.trim()) {
      toast.error('Enter a course name first')
      return
    }
    try {
      await API.createCourse({
        department_id: selDept,
        name: newCourse.name.trim(),
        code: newCourse.code.trim(),
        theory_hours: Number(newCourse.theory_hours),
        practical_hours: Number(newCourse.practical_hours),
        credit_hours: Number(newCourse.credit_hours),
        is_core: newCourse.is_core,
        requires_lab: newCourse.requires_lab,
      })
      setNewCourse({ name: '', code: '', theory_hours: 3, practical_hours: 0, credit_hours: 3, is_core: false, requires_lab: false })
      toast.success('Course added')
      await loadDepartmentWorkspace(selDept)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add course'))
    }
  }

  const addSection = async () => {
    if (!selDept || !newSection.name.trim()) {
      toast.error('Enter a section name first')
      return
    }
    try {
      await API.createSection({
        department_id: selDept,
        name: newSection.name.trim(),
        student_count: Number(newSection.student_count),
        semester: Number(newSection.semester),
      })
      setNewSection({ name: '', student_count: 60, semester: 1 })
      toast.success('Section added')
      await Promise.all([loadInstitutionWorkspace(selInst!, selDept), loadDepartmentWorkspace(selDept)])
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add section'))
    }
  }

  const addAssignment = async () => {
    if (!newAssignment.section_id || !newAssignment.course_id || !newAssignment.faculty_id) {
      toast.error('Choose section, course, and faculty first')
      return
    }
    try {
      await API.createSectionCourse(newAssignment)
      toast.success('Section-course assignment added')
      await loadDepartmentWorkspace(selDept!)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add assignment'))
    }
  }

  const addCombinedGroup = async () => {
    if (!selInst) return
    if (newCombinedGroup.section_ids.length < 2 || !newCombinedGroup.course_id || !newCombinedGroup.faculty_id) {
      toast.error('Select at least two sections, one course, and one faculty member')
      return
    }
    try {
      await API.createCombinedGroup({
        institution_id: selInst,
        section_ids: newCombinedGroup.section_ids,
        course_id: newCombinedGroup.course_id,
        faculty_id: newCombinedGroup.faculty_id,
      })
      setNewCombinedGroup({ section_ids: [], course_id: courses[0]?.id || 0, faculty_id: faculty[0]?.id || 0 })
      toast.success('Combined group added')
      await loadInstitutionWorkspace(selInst, selDept)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add combined group'))
    }
  }

  const confirmAndRun = async (message: string, action: () => Promise<void>) => {
    if (!window.confirm(message)) return
    try {
      await action()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Build your institution from scratch: schedule settings, departments, faculty, rooms, courses, sections, assignments, and combined groups.
        </p>
      </div>

      <Panel title="Institution Setup" icon={Building2} colour="blue">
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr,0.8fr] gap-5">
          <div className="space-y-4">
            <div className={`${cardSm} p-4`}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className={labelCls}>Institution</label>
                  <select className={selectCls} value={selInst ?? ''} onChange={(event) => setSelInst(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">Create a new institution…</option>
                    {institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <button className={`${btnSecondary} w-full justify-center`} onClick={() => { setSelInst(null); setInstitutionForm(defaultInstitutionForm()) }}>
                    New Institution
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3">
                <label className={labelCls}>Institution Name</label>
                <input className={inputCls} value={institutionForm.name} onChange={(event) => setInstitutionForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Sunshine Engineering College" />
              </div>
              <div>
                <label className={labelCls}>Start Time</label>
                <input className={inputCls} type="time" value={institutionForm.start_time} onChange={(event) => setInstitutionForm((current) => ({ ...current, start_time: event.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Period Duration</label>
                <input className={inputCls} type="number" min={1} value={institutionForm.period_duration_minutes} onChange={(event) => setInstitutionForm((current) => ({ ...current, period_duration_minutes: Number(event.target.value) }))} />
              </div>
              <div className="flex items-end">
                <div className="text-xs text-gray-500">Use period indexes like `3` for breaks. Labs automatically use 2 consecutive periods.</div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Working Days</label>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => setInstitutionForm((current) => ({ ...current, working_days: toggleNumber(current.working_days, day.value) }))}
                    className={clsx(
                      'px-3 py-2 rounded-lg border text-sm font-medium transition',
                      institutionForm.working_days.includes(day.value)
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600',
                    )}
                  >
                    {day.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {DAY_OPTIONS.map((day) => {
                const key = String(day.value)
                const enabled = institutionForm.working_days.includes(day.value)
                return (
                  <div key={day.value} className={`${cardSm} p-3 ${!enabled ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-800">{day.label}</span>
                      {enabled ? <span className={badgeBlue}>Active</span> : <span className={badgeAmber}>Off</span>}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Periods</label>
                        <input className={inputCls} type="number" min={0} value={institutionForm.periods_by_day[key]} onChange={(event) => setInstitutionForm((current) => ({ ...current, periods_by_day: { ...current.periods_by_day, [key]: Number(event.target.value) } }))} disabled={!enabled} />
                      </div>
                      <div>
                        <label className={labelCls}>Break Periods</label>
                        <input className={inputCls} value={institutionForm.breaks_by_day[key]} onChange={(event) => setInstitutionForm((current) => ({ ...current, breaks_by_day: { ...current.breaks_by_day, [key]: event.target.value } }))} placeholder="e.g. 3, 6" disabled={!enabled} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={createInstitution}><Plus className="w-4 h-4" />Create Institution</button>
              <button className={btnSecondary} onClick={saveInstitution} disabled={!selInst}><Save className="w-4 h-4" />Save Selected Institution</button>
            </div>
          </div>

          <div className={`${cardSm} p-4 space-y-4`}>
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-800">Current Schedule Summary</h3>
            </div>
            {selectedInstitution ? (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-900">{selectedInstitution.name}</p>
                  <p className="text-xs text-gray-500">Starts at {selectedInstitution.start_time} • {selectedInstitution.period_duration_minutes} min/period</p>
                </div>
                <div className="space-y-2">
                  {institutionSummary.map((item) => (
                    <div key={item.day} className="flex items-center justify-between rounded-lg bg-white border border-gray-200 px-3 py-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-800">{item.day}</p>
                        <p className="text-[11px] text-gray-500">{item.periods} periods</p>
                      </div>
                      <span className={item.breaks ? badgeAmber : badgeGreen}>{item.breaks ? `Breaks ${item.breaks}` : 'No breaks'}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className={`${card} p-3 text-center`}><p className="text-lg font-bold text-gray-900">{departments.length}</p><p className="text-xs text-gray-500">Departments</p></div>
                  <div className={`${card} p-3 text-center`}><p className="text-lg font-bold text-gray-900">{faculty.length}</p><p className="text-xs text-gray-500">Faculty</p></div>
                  <div className={`${card} p-3 text-center`}><p className="text-lg font-bold text-gray-900">{rooms.length}</p><p className="text-xs text-gray-500">Rooms</p></div>
                  <div className={`${card} p-3 text-center`}><p className="text-lg font-bold text-gray-900">{combinedGroups.length}</p><p className="text-xs text-gray-500">Combined Groups</p></div>
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-500">Create your first institution here. Once saved, the rest of the setup panels become available for that institution.</div>
            )}
          </div>
        </div>
      </Panel>

      {selInst && <NLPBox institutionId={selInst} />}

      {selInst && (
        <Panel title={`Departments (${departments.length})`} icon={Building2} colour="purple">
          <div className="grid grid-cols-1 lg:grid-cols-[0.8fr,1.2fr] gap-5">
            <div className={`${cardSm} p-4 space-y-3`}>
              <div>
                <label className={labelCls}>Add Department</label>
                <div className="flex gap-2">
                  <input className={`${inputCls} flex-1`} value={newDepartmentName} onChange={(event) => setNewDepartmentName(event.target.value)} placeholder="e.g. Computer Science" />
                  <button className={btnPrimary} onClick={addDepartment}><Plus className="w-4 h-4" />Add</button>
                </div>
              </div>
              <div>
                <label className={labelCls}>Selected Department</label>
                <select className={selectCls} value={selDept ?? ''} onChange={(event) => setSelDept(event.target.value ? Number(event.target.value) : null)}>
                  <option value="">Choose a department…</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {departments.map((department) => (
                <div key={department.id} className={`${cardSm} p-3 flex items-center gap-2`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{department.name}</p>
                    <p className="text-[11px] text-gray-500">Department #{department.id}</p>
                  </div>
                  {selectedDepartment?.id === department.id && <span className={badgeBlue}>Selected</span>}
                  <button
                    className={btnIcon}
                    onClick={() => confirmAndRun(`Delete department "${department.name}"?`, async () => {
                      await API.deleteDepartment(department.id)
                      toast.success('Department deleted')
                      await loadInstitutionWorkspace(selInst, selectedDepartment?.id === department.id ? null : selectedDepartment?.id)
                    })}
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {selInst && (
        <Panel title={`Rooms (${rooms.length})`} icon={DoorOpen} colour="blue">
          <div className="flex gap-2 mb-4 flex-wrap">
            <input className={`${inputCls} flex-1 min-w-40`} placeholder="Room name" value={newRoom.name} onChange={(event) => setNewRoom((current) => ({ ...current, name: event.target.value }))} />
            <input className={`${inputCls} w-28`} type="number" min={1} value={newRoom.capacity} onChange={(event) => setNewRoom((current) => ({ ...current, capacity: Number(event.target.value) }))} />
            <select className={`${selectCls} w-40`} value={newRoom.room_type} onChange={(event) => setNewRoom((current) => ({ ...current, room_type: event.target.value }))}>
              <option value="classroom">Classroom</option>
              <option value="lab">Lab</option>
              <option value="lecture_hall">Lecture Hall</option>
            </select>
            <button className={`${btnPrimary} shrink-0`} onClick={addRoom}><Plus className="w-4 h-4" />Add Room</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {rooms.map((room) => (
              <div key={room.id} className={`${cardSm} p-3 flex items-center gap-2`}>
                <div className={clsx('w-2 h-2 rounded-full shrink-0', room.room_type === 'lab' ? 'bg-emerald-500' : room.room_type === 'lecture_hall' ? 'bg-amber-500' : 'bg-blue-500')} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{room.name}</p>
                  <p className="text-[10px] text-gray-500 capitalize">{room.room_type} • {room.capacity} seats</p>
                </div>
                <button
                  className={btnIcon}
                  onClick={() => confirmAndRun(`Delete room "${room.name}"?`, async () => {
                    await API.deleteRoom(room.id)
                    toast.success('Room deleted')
                    await loadInstitutionWorkspace(selInst, selectedDepartment?.id)
                  })}
                >
                  <Trash2 className="w-3 h-3 text-red-400" />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {selInst && selectedInstitution && (
        <Panel title={`Faculty (${faculty.length})`} icon={Users} colour="purple">
          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-5">
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Full Name</label>
                  <input className={inputCls} value={newFaculty.name} onChange={(event) => setNewFaculty((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Dr. Priya Sharma" />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input className={inputCls} value={newFaculty.email} onChange={(event) => setNewFaculty((current) => ({ ...current, email: event.target.value }))} placeholder="faculty@college.edu" />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input className={inputCls} value={newFaculty.phone} onChange={(event) => setNewFaculty((current) => ({ ...current, phone: event.target.value }))} placeholder="Optional" />
                </div>
                <div>
                  <label className={labelCls}>Max Consecutive Periods</label>
                  <input className={inputCls} type="number" min={1} value={newFaculty.max_consecutive_periods} onChange={(event) => setNewFaculty((current) => ({ ...current, max_consecutive_periods: Number(event.target.value) }))} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Subjects</label>
                  <input className={inputCls} value={newFaculty.subjects} onChange={(event) => setNewFaculty((current) => ({ ...current, subjects: event.target.value }))} placeholder="Comma-separated subjects, e.g. DBMS, Operating Systems" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls}>Unavailable Slots</label>
                  <span className={badgeBlue}>{newFaculty.unavailable_slots.length} blocked</span>
                </div>
                <AvailabilityGrid institution={selectedInstitution} value={newFaculty.unavailable_slots} onToggle={(slot) => setNewFaculty((current) => ({ ...current, unavailable_slots: toggleUnavailableSlot(current.unavailable_slots, slot) }))} />
              </div>

              <button className={btnPrimary} onClick={addFaculty}><Plus className="w-4 h-4" />Add Faculty</button>
            </div>

            <div className="space-y-2">
              {faculty.map((member) => (
                <div key={member.id} className={`${cardSm} p-3`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
                      <p className="text-[11px] text-gray-500 truncate">{member.email || 'No email provided'}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">Max consecutive: {member.max_consecutive_periods} • Unavailable: {member.unavailable_slots.length}</p>
                    </div>
                    <button
                      className={btnIcon}
                      onClick={() => confirmAndRun(`Delete faculty "${member.name}"?`, async () => {
                        await API.deleteFaculty(member.id)
                        toast.success('Faculty deleted')
                        await loadInstitutionWorkspace(selInst, selectedDepartment?.id)
                      })}
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(member.subjects || []).map((subject) => <span key={subject} className={badgePurple}>{subject}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {selDept && (
        <>
          <Panel title={`Courses (${courses.length})`} icon={BookOpen} colour="amber">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
              <div><label className={labelCls}>Course Name</label><input className={inputCls} value={newCourse.name} onChange={(event) => setNewCourse((current) => ({ ...current, name: event.target.value }))} /></div>
              <div><label className={labelCls}>Course Code</label><input className={inputCls} value={newCourse.code} onChange={(event) => setNewCourse((current) => ({ ...current, code: event.target.value }))} /></div>
              <div><label className={labelCls}>Credit Hours</label><input className={inputCls} type="number" min={0} value={newCourse.credit_hours} onChange={(event) => setNewCourse((current) => ({ ...current, credit_hours: Number(event.target.value) }))} /></div>
              <div><label className={labelCls}>Theory Hours</label><input className={inputCls} type="number" min={0} value={newCourse.theory_hours} onChange={(event) => setNewCourse((current) => ({ ...current, theory_hours: Number(event.target.value) }))} /></div>
              <div><label className={labelCls}>Practical Hours</label><input className={inputCls} type="number" min={0} value={newCourse.practical_hours} onChange={(event) => setNewCourse((current) => ({ ...current, practical_hours: Number(event.target.value) }))} /></div>
              <div className="flex items-end"><button className={`${btnPrimary} w-full justify-center`} onClick={addCourse}><Plus className="w-4 h-4" />Add Course</button></div>
            </div>

            <div className="flex flex-wrap gap-5 mb-4">
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newCourse.is_core} onChange={(event) => setNewCourse((current) => ({ ...current, is_core: event.target.checked }))} /><span className="text-sm text-gray-700">Core subject</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newCourse.requires_lab} onChange={(event) => setNewCourse((current) => ({ ...current, requires_lab: event.target.checked }))} /><span className="text-sm text-gray-700">Requires lab</span></label>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">{['Name', 'Code', 'Theory', 'Practical', 'Flags', ''].map((header) => <th key={header} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{header}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {courses.map((course) => (
                    <tr key={course.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{course.name}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{course.code || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{course.theory_hours}h</td>
                      <td className="px-4 py-3 text-gray-700">{course.practical_hours}h</td>
                      <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{course.is_core && <span className={badgeGreen}>Core</span>}{course.requires_lab && <span className={badgeAmber}>Lab</span>}{!course.is_core && !course.requires_lab && <span className="text-gray-300">—</span>}</div></td>
                      <td className="px-4 py-3">
                        <button className={btnIcon} onClick={() => confirmAndRun(`Delete course "${course.name}"?`, async () => { await API.deleteCourse(course.id); toast.success('Course deleted'); await loadDepartmentWorkspace(selDept) })}>
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title={`Sections (${sections.length})`} icon={GraduationCap} colour="green">
            <div className="flex gap-2 mb-4 flex-wrap">
              <input className={`${inputCls} flex-1 min-w-40`} placeholder="Section name" value={newSection.name} onChange={(event) => setNewSection((current) => ({ ...current, name: event.target.value }))} />
              <input className={`${inputCls} w-32`} type="number" min={1} placeholder="Students" value={newSection.student_count} onChange={(event) => setNewSection((current) => ({ ...current, student_count: Number(event.target.value) }))} />
              <input className={`${inputCls} w-24`} type="number" min={1} placeholder="Semester" value={newSection.semester} onChange={(event) => setNewSection((current) => ({ ...current, semester: Number(event.target.value) }))} />
              <button className={`${btnPrimary} shrink-0`} onClick={addSection}><Plus className="w-4 h-4" />Add Section</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {sections.map((section) => (
                <div key={section.id} className={`${cardSm} p-3 flex items-center justify-between gap-3`}>
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{section.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{section.student_count} students • Sem {section.semester}</p>
                  </div>
                  <button className={btnIcon} onClick={() => confirmAndRun(`Delete section "${section.name}"?`, async () => { await API.deleteSection(section.id); toast.success('Section deleted'); await Promise.all([loadInstitutionWorkspace(selInst!, selDept), loadDepartmentWorkspace(selDept)]) })}>
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={`Section-Course Assignments (${sectionCourses.length})`} icon={Link2} colour="blue">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <div><label className={labelCls}>Section</label><select className={selectCls} value={newAssignment.section_id} onChange={(event) => setNewAssignment((current) => ({ ...current, section_id: Number(event.target.value) }))}><option value={0}>Select section…</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></div>
              <div><label className={labelCls}>Course</label><select className={selectCls} value={newAssignment.course_id} onChange={(event) => setNewAssignment((current) => ({ ...current, course_id: Number(event.target.value) }))}><option value={0}>Select course…</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></div>
              <div><label className={labelCls}>Faculty</label><select className={selectCls} value={newAssignment.faculty_id} onChange={(event) => setNewAssignment((current) => ({ ...current, faculty_id: Number(event.target.value) }))}><option value={0}>Select faculty…</option>{faculty.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>
              <div className="flex items-end"><button className={`${btnPrimary} w-full justify-center`} onClick={addAssignment}><Plus className="w-4 h-4" />Add Assignment</button></div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-200">{['Section', 'Course', 'Faculty', ''].map((header) => <th key={header} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{header}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {sectionCourses.map((assignment) => (
                    <tr key={assignment.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-800">{sectionMap[assignment.section_id]?.name || `Section ${assignment.section_id}`}</td>
                      <td className="px-4 py-3 text-gray-800">{courseMap[assignment.course_id]?.name || `Course ${assignment.course_id}`}</td>
                      <td className="px-4 py-3 text-gray-800">{facultyMap[assignment.faculty_id]?.name || `Faculty ${assignment.faculty_id}`}</td>
                      <td className="px-4 py-3">
                        <button className={btnIcon} onClick={() => confirmAndRun('Delete this assignment?', async () => { await API.deleteSectionCourse(assignment.id); toast.success('Assignment deleted'); await loadDepartmentWorkspace(selDept) })}>
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title={`Combined Groups (${visibleCombinedGroups.length})`} icon={CalendarDays} colour="purple">
            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr,1.1fr] gap-5">
              <div className={`${cardSm} p-4 space-y-3`}>
                <div>
                  <label className={labelCls}>Sections</label>
                  <div className="grid grid-cols-2 gap-2">
                    {sections.map((section) => (
                      <label key={section.id} className={`${card} p-2 flex items-center gap-2 cursor-pointer`}>
                        <input type="checkbox" checked={newCombinedGroup.section_ids.includes(section.id)} onChange={() => setNewCombinedGroup((current) => ({ ...current, section_ids: toggleNumber(current.section_ids, section.id) }))} />
                        <span className="text-sm text-gray-700">{section.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div><label className={labelCls}>Shared Course</label><select className={selectCls} value={newCombinedGroup.course_id} onChange={(event) => setNewCombinedGroup((current) => ({ ...current, course_id: Number(event.target.value) }))}><option value={0}>Select course…</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></div>
                <div><label className={labelCls}>Faculty</label><select className={selectCls} value={newCombinedGroup.faculty_id} onChange={(event) => setNewCombinedGroup((current) => ({ ...current, faculty_id: Number(event.target.value) }))}><option value={0}>Select faculty…</option>{faculty.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>
                <button className={btnPrimary} onClick={addCombinedGroup}><Plus className="w-4 h-4" />Add Combined Group</button>
              </div>

              <div className="space-y-2">
                {visibleCombinedGroups.map((group) => (
                  <div key={group.id} className={`${cardSm} p-3`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{courseMap[group.course_id]?.name || `Course ${group.course_id}`}</p>
                        <p className="text-[11px] text-gray-500">Faculty: {facultyMap[group.faculty_id]?.name || `Faculty ${group.faculty_id}`}</p>
                      </div>
                      <button className={btnIcon} onClick={() => confirmAndRun('Delete this combined group?', async () => { await API.deleteCombinedGroup(group.id); toast.success('Combined group deleted'); await loadInstitutionWorkspace(selInst!, selDept) })}>
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {group.section_ids.map((sectionId) => <span key={sectionId} className={badgeBlue}>{sectionMap[sectionId]?.name || `Section ${sectionId}`}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
