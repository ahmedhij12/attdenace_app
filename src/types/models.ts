export type AttendanceLog = {
  id: number
  name: string
  uid: string
  branch: string
  event: string
  at: string | Date
  code: string
  deviceName: string
  deviceBranch: string
  timeText: string // HH:mm
  dateText: string // dd-MM
}

export interface Employee {
  id: number
  name: string
  department: string
  branch: string
  uid: string
  code?: string | null
  join_date?: string | null
  address?: string | null
  phone?: string | null
  birthdate?: string | null
  employment_type?: 'wages' | 'salary' | null
  hourly_rate?: number | null
  salary_iqd?: number | null
  // NEW ↓
  nationality?: 'iraqi' | 'non_iraqi'
}

export type DeviceInfo = {
  id: number
  name: string
  key?: string
  branch: string
  type: string
  online: boolean
  port: string
  ip: string
  status?: string
  firmware?: string
  lastSeen?: string | null
}
