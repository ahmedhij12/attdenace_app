// src/types/employee-files.ts
export interface Employee {
  id: string;
  name: string;
  code?: string;
  branch_id?: string | number;
  [k: string]: any;
}

export interface AttendanceLog {
  id?: string | number;
  timestamp?: string; // ISO
  device_id?: string | number;
  status?: string;
  [k: string]: any;
}

export interface PayrollSummary {
  month: string; // "YYYY-MM"
  total_hours?: number;
  base_salary?: number;
  wages_total?: number;
  adjustments?: any[];
  [k: string]: any;
}

export interface EmployeeOverviewDTO {
  employee: Employee;
  attendance: { last_logs: AttendanceLog[] };
  payroll?: PayrollSummary | null;
  deductions: any[];
  month: string;
}
