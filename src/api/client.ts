// src/api/client.ts
// -------------------------------------------------------------
// Attendance Admin — API client (safe replacement)
// - Preserves original shapes and method names
// - Adds `nationality` mapping (default 'non_iraqi')
// - Keeps join date aliases: send BOTH joined_at & join_date
// - Leaves everything else intact
// -------------------------------------------------------------

import { useAuthStore } from '@/store/auth'
import type { AttendanceLog, Employee, DeviceInfo } from '@/types/models'

/** Static branch list used by filters; can be extended by backend data in pages */
export const BRANCHES = ['All', 'headoffice', 'basra-tuwaysah', 'basra-olympic', 'basra-zubair', 'samawa']

/** Minimal HTTP helper already used across the app */
async function http(
  method: string,
  path: string,
  body?: any,
  query?: Record<string, string>
) {
  const { apiBase, token } = useAuthStore.getState()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    const hasBearer = /^bearer\s/i.test(token)
    headers['Authorization'] = hasBearer ? token : `Bearer ${token}`
  }

  const base = apiBase.startsWith('http')
    ? apiBase
    : window.location.origin + (apiBase.startsWith('/') ? '' : '/') + apiBase

  const url = new URL(base.replace(/\/$/, '') + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.detail || JSON.stringify(j)
    } catch {
      detail = await res.text()
    }
    throw new Error(detail || `HTTP ${res.status}`)
  }

  // try json; if fails, return text
  try {
    return await res.json()
  } catch {
    const text = await res.text()
    try { return JSON.parse(text) } catch {}
    return text // allow raw string responses (e.g., key)
  }
}

class Api {
  // -------- Auth --------
  async login(username: string, password: string) {
    const j = await http('POST', '/auth/login', { username, password })
    const token = (j?.access_token || j?.token || '').toString()
    const user = j?.user || {}
    useAuthStore.getState().setSession(token, user?.email || '', user?.role || 'admin')
    return true
  }

  async changePassword(old_password: string, new_password: string) {
    await http('POST', '/auth/change_password', { old_password, new_password })
  }

  // ADD inside class Api { ... } near other device methods
  async regenerateDeviceKey(id: number): Promise<string> {
    const res = await http('POST', `/devices/${id}/regenerate_key`)
    if (typeof res === 'string') return res
    if (res?.key) return String(res.key)
    if (res?.device_key) return String(res.device_key)
    if (res?.data?.key) return String(res.data.key)
    throw new Error('Server did not return device key')
  }

  // -------- Employees --------
  async getEmployees({ q }: { q?: string } = {}): Promise<Employee[]> {
    const data = await http('GET', '/employees', undefined, q ? { q } : undefined)
    return Array.isArray(data) ? data.map(this.empFromJson) : []
  }
  async createEmployee(e: Partial<Employee>) {
    await http('POST', '/employees', this.empToJson(e))
  }
  async updateEmployee(id: number, e: Partial<Employee>) {
    await http('PUT', `/employees/${id}`, this.empToJson(e))
  }
  async deleteEmployee(id: number) {
    await http('DELETE', `/employees/${id}`)
  }

  private empToJson(e: any) {
    // normalize the date string once (YYYY-MM-DD)
    const jd = e.joined_at ?? e.join_date ?? null

    return {
      name: e.name || '',
      department: e.department ?? null,
      branch: e.branch ?? null,
      uid: e.uid ?? null,
      code: e.code ?? null,
      address: e.address ?? null,
      phone: e.phone ?? null,
      birthdate: e.birthdate ?? null,

      // payroll (snake_case)
      employment_type: e.employment_type ?? null,
      hourly_rate: e.hourly_rate ?? null,
      salary_iqd: e.salary_iqd ?? null,

      // NEW: nationality for payroll rules
      nationality: (typeof e.nationality === 'string'
        ? e.nationality.toLowerCase()
        : (e.nationality || 'non_iraqi')),

      // date — send both to satisfy older/newer backends
      joined_at: jd,
      join_date: jd,
    }
  }

  private empFromJson(j: any): Employee {
    return {
      id: j.id,
      name: j.name,
      department: j.department ?? null,
      branch: j.branch ?? null,
      uid: j.uid ?? null,
      code: j.code ?? null,
      address: j.address ?? null,
      phone: j.phone ?? null,
      birthdate: j.birthdate ?? null,

      employment_type: j.employment_type ?? null,
      hourly_rate: j.hourly_rate ?? null,
      salary_iqd: j.salary_iqd ?? null,

      // accept multiple backend spellings
      joined_at: j.joined_at ?? j.join_date ?? j.date_joined ?? j.joining_date ?? null,

      // NEW: nationality (default non_iraqi)
      nationality: (typeof j.nationality === 'string'
        ? j.nationality.toLowerCase()
        : (j.nationality || 'non_iraqi')),
    } as Employee
  }

  // -------- Probation alerts --------
  async getProbationDue(): Promise<{
    count: number
    items: (Employee & {
      probationDue?: boolean
      probationStatus?: string
      daysToProbation?: number
    })[]
  }> {
    const j = await http('GET', '/employees/probation_due')
    const items = Array.isArray(j?.items) ? j.items : []
    return {
      count: Number(j?.count ?? items.length),
      items: items.map((it: any) => ({
        ...this.empFromJson(it),
        probationDue: Boolean(it.probation_due),
        probationStatus: it.probation_status || undefined,
        daysToProbation:
          typeof it.days_to_probation === 'number' ? it.days_to_probation : undefined,
      })),
    }
  }

  async ackProbation(id: number) {
    await http('POST', `/employees/${id}/ack_probation`)
  }

  // -------- Devices --------
  async getDevices(): Promise<DeviceInfo[]> {
    const j = await http('GET', '/devices')
    const list = Array.isArray(j) ? j : (j?.items ?? j?.data ?? [])
    return list as DeviceInfo[]
  }

  // -------- Logs --------
  async getLogs(params: {
    from?: string
    to?: string
    branch?: string
    page?: number
    limit?: number
  }): Promise<AttendanceLog[]> {
    const q: Record<string, any> = {}
    if (params?.from) q.from = params.from
    if (params?.to) q.to = params.to
    if (params?.branch && params.branch !== 'All') q.branch = params.branch
    if (params?.page != null) q.page = String(params.page)
    if (params?.limit != null) q.limit = String(params.limit)
    const j = await http('GET', '/logs', undefined, q)
    return (Array.isArray(j) ? j : (j?.items ?? j?.data ?? [])) as AttendanceLog[]
  }

  // -------- Export (CSV/XLSX) --------
  async exportExcel(params: { from?: string; to?: string; branch?: string }) {
    return http('GET', '/exports/excel', undefined, params as any)
  }

  // -------- Dashboard stats --------
  async getDashboardStats(params: { from?: string; to?: string; branch?: string }) {
    const j = await http('GET', '/logs/stats', undefined, params as any)
    return j
  }

  // -------- Utility: parse logs client-side when needed --------
  parseLogs(items: any[]): (AttendanceLog & {
    dateText: string
    timeText: string
  })[] {
    return (items || []).map((x: any) => {
      const ts = typeof x.timestamp === 'string' ? x.timestamp : String(x.timestamp || '')
      const d = parseToLocal(ts)
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const timeText = `${hh}:${mm}`
      const dateText = d.toISOString().slice(0, 10)
      return {
        ...x,
        timeText,
        dateText,
      } as any
    })
  }
}

// ---------- helpers ----------
function toInt(v: any) {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : 0
}

function parseToLocal(s?: string) {
  if (!s) return new Date()
  // allow ISO or epoch milliseconds/seconds
  const n = Number(s)
  if (Number.isFinite(n) && s.trim() !== '') {
    return new Date(n > 1e12 ? n : n * 1000)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date() : d
}

// single exported instance used by pages
export const api = new Api()

// Canonical branch list: devices (source of truth) + server branches (if any) + employees (fallback)
// Always returns unique, trimmed names, without "All".
export async function getCanonicalBranches(): Promise<string[]> {
  const set = new Set<string>();

  // From devices
  try {
    const devs = await http('GET', '/devices');
    const list = Array.isArray(devs) ? devs : (devs?.items ?? devs?.data ?? []);
    for (const d of (list || [])) {
      const b = String(d?.branch ?? '').trim();
      if (b) set.add(b);
    }
  } catch { /* ignore */ }

  // From server branches endpoint if you have one (optional)
  try {
    const r = await http('GET', '/devices/branches');
    const list = Array.isArray(r) ? r : (r?.items ?? r?.data ?? []);
    for (const b of (list || [])) {
      const s = String(b ?? '').trim();
      if (s) set.add(s);
    }
  } catch { /* ignore */ }

  // From employees (fallback)
  try {
    const emps = await http('GET', '/employees');
    const list = Array.isArray(emps) ? emps : (emps?.items ?? emps?.data ?? emps?.employees ?? []);
    for (const e of (list || [])) {
      const b = String(e?.branch ?? '').trim();
      if (b) set.add(b);
    }
  } catch { /* ignore */ }

  // Filter out bogus items and sort for stable UI
  const out = Array.from(set).filter(Boolean);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
