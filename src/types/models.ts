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
  id: number;
  name: string;
  department?: string;        // we will label this "Position" in the UI
  branch: string;             // location (unchanged)
  brand?: string | null;      // NEW: restaurant brand (Awtar | 360 | AA Chicken)
  uid?: string;
  code?: string;
  join_date?: string;
  address?: string;
  phone?: string;
  birthdate?: string;
  employment_type?: 'wages' | 'salary';
  hourly_rate?: number | null;
  salary_iqd?: number | null;
  nationality?: string;
  is_active?: number;
  status?: string;
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
