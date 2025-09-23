// src/api/payroll.ts
import { useAuthStore } from '@/store/auth'

export type PayrollTotals = {
  hours: number
  food_allowance_iqd: number
  other_allowance_iqd: number
  advances_iqd: number        // NEW
  deductions_iqd: number
  late_penalty_iqd: number
  allowances_iqd: number
  base_salary_iqd: number
  total_pay_iqd: number
}

export type PayrollRow = {
  uid: string
  code?: string
  name: string
  branch: string
  nationality: string
  days: Record<string, number>
  totals: PayrollTotals
  meta?: any
}

export type OtherAdjustment = {
  id: number
  uid: string
  date_from: string
  date_to: string
  amount_iqd: number
  note?: string
  created_at?: string
}

export type Deduction = {
  id: number
  uid: string
  date: string
  amount_iqd: number
  note?: string
  created_at?: string
}

function getApiBase(): string {
  const { apiBase } = useAuthStore.getState()
  if (apiBase) {
    const base = apiBase.startsWith('http')
      ? apiBase
      : window.location.origin + (apiBase.startsWith('/') ? '' : '/') + apiBase
    return base.replace(/\/+$/, '')
  }
  const env = (import.meta as any)?.env?.VITE_API_URL as string | undefined
  if (env) return env.replace(/\/+$/, '')
  const url = new URL(window.location.href)
  const port = url.port === '5173' ? '8000' : url.port
  return `${url.protocol}//${url.hostname}${port ? ':' + port : ''}`
}

function tokenHeader() {
  const { token } = useAuthStore.getState()
  if (!token) return {}
  const auth = /^bearer\s/i.test(token) ? token : `Bearer ${token}`
  return { Authorization: auth }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let text = ''
    try { text = await res.text() } catch {}
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as unknown as T
  try { return await res.json() } catch { return undefined as unknown as T }
}

// ----------- Payroll -----------
export async function getPayroll(params: { from: string; to: string; branch?: string }): Promise<PayrollRow[]> {
  const q = new URLSearchParams()
  q.set('from', params.from)
  q.set('to', params.to)
  const b = (params.branch || '').trim()
  // ✅ critical: never send branch=All
  if (b && b.toLowerCase() !== 'all') q.set('branch', b)

  const res = await fetch(`${getApiBase()}/payroll?${q.toString()}`, { headers: { ...tokenHeader() } })
  const arr: any[] = await handle<any[]>(res)
  return (Array.isArray(arr) ? arr : []).map((r: any) => {
    const uid = String(r?.uid ?? r?.meta?.uid ?? '').toUpperCase()
    const t = r?.totals ?? {}
    return {
      uid,
      code: r?.code ?? '',
      name: r?.name ?? '',
      branch: r?.branch ?? '',
      nationality: String(r?.nationality ?? '').toLowerCase(),
      days: r?.days ?? {},
      totals: {
  hours: Number(t?.hours ?? 0),
  food_allowance_iqd: Number(t?.food_allowance_iqd ?? 0),
  other_allowance_iqd: Number(t?.other_allowance_iqd ?? 0),
  advances_iqd: Number(t?.advances_iqd ?? 0),      // NEW
  deductions_iqd: Number(t?.deductions_iqd ?? 0),
  late_penalty_iqd: Number(t?.late_penalty_iqd ?? 0),
  allowances_iqd: Number(t?.allowances_iqd ?? 0),
  base_salary_iqd: Number(t?.base_salary_iqd ?? 0),
  total_pay_iqd: Number(t?.total_pay_iqd ?? 0),
},

      meta: r?.meta,
    }
  })
}

// ----------- Other Allowances (Adjustments) -----------
export async function listAdjustments(uid: string, from: string, to: string): Promise<OtherAdjustment[]> {
  const q = new URLSearchParams({ uid, from, to })
  const res = await fetch(`${getApiBase()}/payroll/adjustments?${q.toString()}`, { headers: { ...tokenHeader() } })
  return handle<OtherAdjustment[]>(res)
}

export async function createAdjustment(data: { uid: string; from: string; to: string; amount_iqd: number; note?: string }) {
  const res = await fetch(`${getApiBase()}/payroll/adjustment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tokenHeader() },
    body: JSON.stringify(data),
  })
  return handle<any>(res)
}

export async function updateAdjustment(id: number, data: Partial<{ amount_iqd: number; note: string; from: string; to: string }>) {
  const res = await fetch(`${getApiBase()}/payroll/adjustment/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...tokenHeader() },
    body: JSON.stringify(data),
  })
  return handle<any>(res)
}

export async function deleteAdjustment(id: number) {
  const res = await fetch(`${getApiBase()}/payroll/adjustment/${id}`, {
    method: 'DELETE',
    headers: { ...tokenHeader() },
  })
  return handle<any>(res)
}

// ----------- Deductions -----------
export async function listDeductions(uid: string, from: string, to: string): Promise<Deduction[]> {
  const q = new URLSearchParams({ uid, from, to })
  const res = await fetch(`${getApiBase()}/payroll/deductions?${q.toString()}`, { headers: { ...tokenHeader() } })
  return handle<Deduction[]>(res)
}

export async function createDeduction(data: { uid: string; date: string; amount_iqd: number; note?: string }) {
  const res = await fetch(`${getApiBase()}/payroll/deduction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tokenHeader() },
    body: JSON.stringify(data),
  })
  return handle<any>(res)
}

export async function updateDeduction(id: number, data: Partial<{ date: string; amount_iqd: number; note: string }>) {
  const res = await fetch(`${getApiBase()}/payroll/deduction/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...tokenHeader() },
    body: JSON.stringify(data),
  })
  return handle<any>(res)
}

export async function deleteDeduction(id: number) {
  const res = await fetch(`${getApiBase()}/payroll/deduction/${id}`, {
    method: 'DELETE',
    headers: { ...tokenHeader() },
  })
  return handle<any>(res)
}
