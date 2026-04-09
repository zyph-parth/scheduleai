import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 120_000,  // 2 min — solver can take time
})

export default api

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Institution {
  id: number
  name: string
  working_days: number[]
  periods_per_day: Record<string, number[]>
  break_slots: Record<string, number[]>
  period_duration_minutes: number
  start_time: string
}

export interface Department { id: number; institution_id: number; name: string }
export interface Room       { id: number; institution_id: number; name: string; capacity: number; room_type: string }
export interface Faculty    { id: number; institution_id: number; name: string; email: string; phone: string; subjects: string[]; unavailable_slots: {day:number;period:number}[]; max_consecutive_periods: number }
export interface Course     { id: number; department_id: number; name: string; code: string; theory_hours: number; practical_hours: number; credit_hours: number; is_core: boolean; requires_lab: boolean }
export interface Section    { id: number; department_id: number; name: string; student_count: number; semester: number }
export interface SectionCourse { id: number; section_id: number; course_id: number; faculty_id: number }
export interface CombinedGroup { id: number; institution_id: number; section_ids: number[]; course_id: number; faculty_id: number }

export interface Slot {
  id: number; timetable_id: number; section_id: number | null; section_ids: number[]
  course_id: number; faculty_id: number; room_id: number | null
  day: number; period: number; duration: number; slot_type: string
  is_locked: boolean; is_combined: boolean; is_modified: boolean
  course_name?: string; faculty_name?: string; room_name?: string; section_name?: string
}

export interface TimetableMeta {
  id: number; name: string; semester: string; status: string
  solve_time: number; created_at: string; slot_count: number
}

export interface Timetable extends TimetableMeta {
  slots: Slot[]
  violations: { type: string; description: string; severity: string }[]
}

export interface GenerateRequest {
  institution_id: number; name: string; semester?: string
  locked_slots?: any[]; max_solve_seconds?: number
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export const API = {
  // Institutions
  getInstitutions:      ()                => api.get<Institution[]>('/institutions').then(r=>r.data),
  createInstitution:    (d:any)           => api.post<Institution>('/institutions', d).then(r=>r.data),
  updateInstitution:    (id:number, d:any)=> api.put<Institution>(`/institutions/${id}`, d).then(r=>r.data),
  getInstitution:       (id:number)       => api.get<Institution>(`/institutions/${id}`).then(r=>r.data),

  // Departments
  getDepartments:       (inst:number)     => api.get<Department[]>('/departments', {params:{institution_id:inst}}).then(r=>r.data),
  createDepartment:     (d:any)           => api.post<Department>('/departments', d).then(r=>r.data),

  // Rooms
  getRooms:             (inst:number)     => api.get<Room[]>('/rooms', {params:{institution_id:inst}}).then(r=>r.data),
  createRoom:           (d:any)           => api.post<Room>('/rooms', d).then(r=>r.data),
  updateRoom:           (id:number, d:any)=> api.put<Room>(`/rooms/${id}`, d).then(r=>r.data),
  deleteRoom:           (id:number)       => api.delete(`/rooms/${id}`),

  // Faculty
  getFaculty:           (inst:number)     => api.get<Faculty[]>('/faculty', {params:{institution_id:inst}}).then(r=>r.data),
  createFaculty:        (d:any)           => api.post<Faculty>('/faculty', d).then(r=>r.data),
  updateFaculty:        (id:number, d:any)=> api.put<Faculty>(`/faculty/${id}`, d).then(r=>r.data),
  deleteFaculty:        (id:number)       => api.delete(`/faculty/${id}`),

  // Courses
  getCourses:           (dept:number)     => api.get<Course[]>('/courses', {params:{department_id:dept}}).then(r=>r.data),
  createCourse:         (d:any)           => api.post<Course>('/courses', d).then(r=>r.data),
  updateCourse:         (id:number, d:any)=> api.put<Course>(`/courses/${id}`, d).then(r=>r.data),
  deleteCourse:         (id:number)       => api.delete(`/courses/${id}`),

  // Sections
  getSections:          (dept:number)     => api.get<Section[]>('/sections', {params:{department_id:dept}}).then(r=>r.data),
  createSection:        (d:any)           => api.post<Section>('/sections', d).then(r=>r.data),
  deleteSection:        (id:number)       => api.delete(`/sections/${id}`),

  // SectionCourses
  getSectionCourses:    (sec:number)      => api.get<SectionCourse[]>('/section-courses', {params:{section_id:sec}}).then(r=>r.data),
  createSectionCourse:  (d:any)           => api.post<SectionCourse>('/section-courses', d).then(r=>r.data),
  deleteSectionCourse:  (id:number)       => api.delete(`/section-courses/${id}`),

  // Combined groups
  getCombinedGroups:    (inst:number)     => api.get<CombinedGroup[]>('/combined-groups', {params:{institution_id:inst}}).then(r=>r.data),
  createCombinedGroup:  (d:any)           => api.post<CombinedGroup>('/combined-groups', d).then(r=>r.data),
  deleteCombinedGroup:  (id:number)       => api.delete(`/combined-groups/${id}`),

  // Timetables
  generateTimetable:    (d:GenerateRequest) => api.post('/timetables/generate', d).then(r=>r.data),
  listTimetables:       (inst:number)       => api.get<TimetableMeta[]>('/timetables', {params:{institution_id:inst}}).then(r=>r.data),
  getTimetable:         (id:number)         => api.get<Timetable>(`/timetables/${id}`).then(r=>r.data),
  deleteTimetable:      (id:number)         => api.delete(`/timetables/${id}`),
  whatIf:               (d:any)             => api.post('/timetables/what-if', d).then(r=>r.data),
  findSubstitutes:      (ttId:number, slotId:number) => api.get(`/timetables/${ttId}/substitutes`, {params:{slot_id:slotId}}).then(r=>r.data),
  substituteSlot:       (slotId:number, d:any) => api.patch(`/slots/${slotId}/substitute`, d).then(r=>r.data),
  lockSlot:             (slotId:number)     => api.patch(`/slots/${slotId}/lock`).then(r=>r.data),
  getAnalytics:         (ttId:number)       => api.get(`/timetables/${ttId}/analytics`).then(r=>r.data),
  exportExcel:          (ttId:number)       => `/api/timetables/${ttId}/export/excel`,
  exportPdf:            (ttId:number)       => `/api/timetables/${ttId}/export/pdf`,

  // NLP
  parseConstraint:      (inst:number, text:string) =>
    api.post('/nlp/parse-constraint', {institution_id:inst, text}).then(r=>r.data),
}
