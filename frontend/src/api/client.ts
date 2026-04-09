import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 120_000,
})

export default api

export interface Institution {
  id: number
  name: string
  working_days: number[]
  periods_per_day: Record<string, number[]>
  break_slots: Record<string, number[]>
  period_duration_minutes: number
  start_time: string
}

export interface Department {
  id: number
  institution_id: number
  name: string
}

export interface Room {
  id: number
  institution_id: number
  name: string
  capacity: number
  room_type: string
}

export interface Faculty {
  id: number
  institution_id: number
  name: string
  email: string
  phone: string
  subjects: string[]
  unavailable_slots: { day: number; period: number }[]
  max_consecutive_periods: number
}

export interface Course {
  id: number
  department_id: number
  name: string
  code: string
  theory_hours: number
  practical_hours: number
  credit_hours: number
  is_core: boolean
  requires_lab: boolean
}

export interface Section {
  id: number
  department_id: number
  name: string
  student_count: number
  semester: number
}

export interface SectionCourse {
  id: number
  section_id: number
  course_id: number
  faculty_id: number
}

export interface CombinedGroup {
  id: number
  institution_id: number
  section_ids: number[]
  course_id: number
  faculty_id: number
}

export interface Slot {
  id: number
  timetable_id: number
  section_id: number | null
  section_ids: number[]
  course_id: number
  faculty_id: number
  room_id: number | null
  day: number
  period: number
  duration: number
  slot_type: string
  is_locked: boolean
  is_combined: boolean
  is_modified: boolean
  course_name?: string
  faculty_name?: string
  room_name?: string
  section_name?: string
}

export interface TimetableMeta {
  id: number
  name: string
  semester: string
  status: string
  solve_time: number
  created_at: string
  slot_count: number
}

export interface Timetable extends TimetableMeta {
  slots: Slot[]
  violations: { type: string; description: string; severity: string }[]
}

export interface InstitutionPayload {
  name: string
  working_days: number[]
  periods_per_day: Record<string, number[]>
  break_slots: Record<string, number[]>
  period_duration_minutes: number
  start_time: string
}

export interface DepartmentPayload {
  institution_id: number
  name: string
}

export interface RoomPayload {
  institution_id: number
  name: string
  capacity: number
  room_type: string
}

export interface FacultyPayload {
  institution_id: number
  name: string
  email: string
  phone: string
  subjects: string[]
  unavailable_slots: { day: number; period: number }[]
  max_consecutive_periods: number
}

export interface CoursePayload {
  department_id: number
  name: string
  code: string
  theory_hours: number
  practical_hours: number
  credit_hours: number
  is_core: boolean
  requires_lab: boolean
}

export interface SectionPayload {
  department_id: number
  name: string
  student_count: number
  semester: number
}

export interface SectionCoursePayload {
  section_id: number
  course_id: number
  faculty_id: number
}

export interface CombinedGroupPayload {
  institution_id: number
  section_ids: number[]
  course_id: number
  faculty_id: number
}

export interface GenerateRequest {
  institution_id: number
  name: string
  semester?: string
  locked_slots?: unknown[]
  max_solve_seconds?: number
}

export function getErrorMessage(error: unknown, fallback = 'Something went wrong') {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string' && detail.trim()) return detail
    if (Array.isArray(detail) && detail.length) {
      return detail.map((item: unknown) => JSON.stringify(item)).join(', ')
    }
    if (typeof error.message === 'string' && error.message.trim()) return error.message
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export const API = {
  getInstitutions: () =>
    api.get<Institution[]>('/institutions').then((r) => r.data),
  createInstitution: (data: InstitutionPayload) =>
    api.post<Institution>('/institutions', data).then((r) => r.data),
  getInstitution: (id: number) =>
    api.get<Institution>(`/institutions/${id}`).then((r) => r.data),
  updateInstitution: (id: number, data: InstitutionPayload) =>
    api.put<Institution>(`/institutions/${id}`, data).then((r) => r.data),

  getDepartments: (institutionId: number) =>
    api.get<Department[]>('/departments', { params: { institution_id: institutionId } }).then((r) => r.data),
  createDepartment: (data: DepartmentPayload) =>
    api.post<Department>('/departments', data).then((r) => r.data),
  updateDepartment: (id: number, data: DepartmentPayload) =>
    api.put<Department>(`/departments/${id}`, data).then((r) => r.data),
  deleteDepartment: (id: number) =>
    api.delete(`/departments/${id}`),

  getRooms: (institutionId: number) =>
    api.get<Room[]>('/rooms', { params: { institution_id: institutionId } }).then((r) => r.data),
  createRoom: (data: RoomPayload) =>
    api.post<Room>('/rooms', data).then((r) => r.data),
  updateRoom: (id: number, data: RoomPayload) =>
    api.put<Room>(`/rooms/${id}`, data).then((r) => r.data),
  deleteRoom: (id: number) =>
    api.delete(`/rooms/${id}`),

  getFaculty: (institutionId: number) =>
    api.get<Faculty[]>('/faculty', { params: { institution_id: institutionId } }).then((r) => r.data),
  createFaculty: (data: FacultyPayload) =>
    api.post<Faculty>('/faculty', data).then((r) => r.data),
  updateFaculty: (id: number, data: FacultyPayload) =>
    api.put<Faculty>(`/faculty/${id}`, data).then((r) => r.data),
  deleteFaculty: (id: number) =>
    api.delete(`/faculty/${id}`),

  getCourses: (departmentId: number) =>
    api.get<Course[]>('/courses', { params: { department_id: departmentId } }).then((r) => r.data),
  createCourse: (data: CoursePayload) =>
    api.post<Course>('/courses', data).then((r) => r.data),
  updateCourse: (id: number, data: CoursePayload) =>
    api.put<Course>(`/courses/${id}`, data).then((r) => r.data),
  deleteCourse: (id: number) =>
    api.delete(`/courses/${id}`),

  getSections: (departmentId: number) =>
    api.get<Section[]>('/sections', { params: { department_id: departmentId } }).then((r) => r.data),
  createSection: (data: SectionPayload) =>
    api.post<Section>('/sections', data).then((r) => r.data),
  updateSection: (id: number, data: SectionPayload) =>
    api.put<Section>(`/sections/${id}`, data).then((r) => r.data),
  deleteSection: (id: number) =>
    api.delete(`/sections/${id}`),

  getSectionCourses: (sectionId: number) =>
    api.get<SectionCourse[]>('/section-courses', { params: { section_id: sectionId } }).then((r) => r.data),
  createSectionCourse: (data: SectionCoursePayload) =>
    api.post<SectionCourse>('/section-courses', data).then((r) => r.data),
  deleteSectionCourse: (id: number) =>
    api.delete(`/section-courses/${id}`),

  getCombinedGroups: (institutionId: number) =>
    api.get<CombinedGroup[]>('/combined-groups', { params: { institution_id: institutionId } }).then((r) => r.data),
  createCombinedGroup: (data: CombinedGroupPayload) =>
    api.post<CombinedGroup>('/combined-groups', data).then((r) => r.data),
  deleteCombinedGroup: (id: number) =>
    api.delete(`/combined-groups/${id}`),

  generateTimetable: (data: GenerateRequest) =>
    api.post('/timetables/generate', data).then((r) => r.data),
  listTimetables: (institutionId: number) =>
    api.get<TimetableMeta[]>('/timetables', { params: { institution_id: institutionId } }).then((r) => r.data),
  getTimetable: (id: number) =>
    api.get<Timetable>(`/timetables/${id}`).then((r) => r.data),
  deleteTimetable: (id: number) =>
    api.delete(`/timetables/${id}`),
  whatIf: (data: unknown) =>
    api.post('/timetables/what-if', data).then((r) => r.data),
  findSubstitutes: (timetableId: number, slotId: number) =>
    api.get(`/timetables/${timetableId}/substitutes`, { params: { slot_id: slotId } }).then((r) => r.data),
  substituteSlot: (slotId: number, data: unknown) =>
    api.patch(`/slots/${slotId}/substitute`, data).then((r) => r.data),
  lockSlot: (slotId: number) =>
    api.patch(`/slots/${slotId}/lock`).then((r) => r.data),
  getAnalytics: (timetableId: number) =>
    api.get(`/timetables/${timetableId}/analytics`).then((r) => r.data),
  exportExcel: (timetableId: number) =>
    `/api/timetables/${timetableId}/export/excel`,
  exportPdf: (timetableId: number) =>
    `/api/timetables/${timetableId}/export/pdf`,

  parseConstraint: (institutionId: number, text: string) =>
    api.post('/nlp/parse-constraint', { institution_id: institutionId, text }).then((r) => r.data),
}
