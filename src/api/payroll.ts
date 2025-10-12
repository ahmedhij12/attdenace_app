// src/api/payroll.ts — FULL FILE REPLACEMENT
// Keeps your existing shapes but fixes imports, 401s, and TS errors.

import { useAuthStore } from '@/store/auth'
import { authHeader } from '@/api/client'   // ← only import authHeader. getApiBase/handle are declared locally here.

// --- base url helper (dev 5173/5174 → backend 8000) ---
function getApiBase(): string {
  const { apiBase } = useAuthStore.getState()
  if (apiBase) {
    const base = apiBase.startsWith('http')
      ? apiBase
      : window.location.origin + (apiBase.startsWith('/') ? '' : '/') + apiBase
    return base.replace(/\/+$/, '')
  }
  const env =
    (import.meta as any)?.env?.VITE_API_BASE ||
    (import.meta as any)?.env?.VITE_API_URL ||
    (import.meta as any)?.env?.VITE_API
  if (env) return String(env).replace(/\/+$/, '')

  const u = new URL(window.location.href)
  // Dev: map Vite 5173/5174 → backend 8000
  const port = (u.port === '5173' || u.port === '5174') ? '8000' : u.port
  return `${u.protocol}//${u.hostname}${port ? ':' + port : ''}`
}

// --- query helper ---
function qs(params?: Record<string, any>): string {
  const sp = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

// --- fetch handler that throws on !ok and parses JSON/text ---
async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as any
  const ctype = res.headers.get('content-type') || ''
  const isJSON = ctype.includes('application/json')
  const data = isJSON ? await res.json().catch(() => ({})) : await res.text().catch(() => '')
  if (!res.ok) {
    const message =
      (isJSON && (data as any)?.detail) || (isJSON && (data as any)?.message) || res.statusText || `HTTP ${res.status}`
    const err: any = new Error(message)
    err.status = res.status
    err.data = data
    throw err
  }
  return data as T
}

/* ----------------------- types used by Payroll page ----------------------- */

export type PayrollTotals = {
  hours: number
  food_allowance_iqd: number
  other_allowance_iqd: number
  advances_iqd: number
  deductions_iqd: number
  late_penalty_iqd: number
  allowances_iqd: number
  base_salary_iqd: number
  total_pay_iqd: number
}

export type PayrollRow = {
  uid: string
  code: string
  name: string
  branch: string
  nationality?: string
  days: Record<string, any>
  totals: PayrollTotals
  meta?: Record<string, any>
}

export type PayrollQuery = {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
  branch?: string
  employee_uid?: string
}

/* -------------------------------- payroll -------------------------------- */

export async function getPayroll(params: { from: string; to: string; branch?: string }) {
  const url = new URL(`${getApiBase()}/payroll`)
  url.searchParams.set('from', params.from)
  url.searchParams.set('to', params.to)
  if (params.branch) url.searchParams.set('branch', params.branch)

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      ...authHeader(), // ensures Authorization: Bearer <token> is sent
    },
  })

  // Normalize the server response into the UI-friendly shape the page expects.
  const arr = await handle<any[]>(res)
  return (Array.isArray(arr) ? arr : []).map((r: any) => {
    const t = r?.totals ?? {}
    return {
      uid: String(r?.uid ?? r?.meta?.uid ?? '').toUpperCase(),
      code: r?.code ?? '',
      name: r?.name ?? '',
      branch: r?.branch ?? '',
      nationality: r?.nationality ?? '',
      days: r?.days ?? {},
      totals: {
        hours: Number(t?.hours ?? 0),
        food_allowance_iqd: Number(t?.food_allowance_iqd ?? 0),
        other_allowance_iqd: Number(t?.other_allowance_iqd ?? 0),
        advances_iqd: Number(t?.advances_iqd ?? 0),
        deductions_iqd: Number(t?.deductions_iqd ?? 0),
        late_penalty_iqd: Number(t?.late_penalty_iqd ?? 0),
        allowances_iqd: Number(t?.allowances_iqd ?? 0),
        base_salary_iqd: Number(t?.base_salary_iqd ?? 0),
        total_pay_iqd: Number(t?.total_pay_iqd ?? 0),
      },
      meta: r?.meta ?? undefined,
    } as PayrollRow
  })
}

/* ---------------------------- adjustments CRUD ---------------------------- */

export type Adjustment = {
  id: number
  employee_uid: string
  date: string
  amount_iqd: number
  note?: string
  type?: string
}

export async function listAdjustments(params: { employee_uid?: string; month?: string }) {
  const res = await fetch(`${getApiBase()}/payroll/adjustments${qs(params)}`, {
    headers: { ...authHeader() },
  })
  return handle<Adjustment[]>(res)
}

export async function createAdjustment(body: {
  employee_uid: string
  date: string
  amount_iqd: number
  note?: string
  type?: string
}) {
  const res = await fetch(`${getApiBase()}/payroll/adjustment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
  return handle<{ id: number }>(res)
}

export async function updateAdjustment(
  id: number,
  patch: Partial<{ date: string; amount_iqd: number; note?: string; type?: string }>
) {
  const res = await fetch(`${getApiBase()}/payroll/adjustment/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(patch),
  })
  return handle<{ ok: boolean }>(res)
}

export async function deleteAdjustment(id: number) {
  const res = await fetch(`${getApiBase()}/payroll/adjustment/${id}`, {
    method: 'DELETE',
    headers: { ...authHeader() },
  })
  return handle<{ ok: boolean }>(res)
}

/* ------------------------------ deductions CRUD --------------------------- */

export type Deduction = {
  id: number
  employee_id: number
  date: string
  amount_iqd: number
  note?: string
  created_at?: string
}

export async function listDeductions(employee_id: number, month: string) {
  const res = await fetch(
    `${getApiBase()}/employee_files/${employee_id}/deductions${qs({ month })}`,
    { headers: { ...authHeader() } }
  )
  return handle<Deduction[]>(res)
}

export async function createDeduction(employee_id: number, body: Omit<Deduction, 'id'>) {
  const res = await fetch(`${getApiBase()}/employee_files/${employee_id}/deductions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
  return handle<{ id: number }>(res)
}

export async function updateDeduction(
  employee_id: number,
  id: number,
  patch: Partial<Omit<Deduction, 'id' | 'employee_id'>>
) {
  const res = await fetch(`${getApiBase()}/employee_files/${employee_id}/deductions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(patch),
  })
  return handle<{ ok: boolean }>(res)
}

export async function deleteDeduction(employee_id: number, id: number) {
  const res = await fetch(`${getApiBase()}/employee_files/${employee_id}/deductions/${id}`, {
    method: 'DELETE',
    headers: { ...authHeader() },
  })
  return handle<{ ok: boolean }>(res)
}

/* ------------------------------ late overrides ---------------------------- */

export async function listLateOverrides(params: {
  uid: string
  date_from: string
  date_to: string
}) {
  const res = await fetch(`${getApiBase()}/payroll/late_overrides${qs(params)}`, {
    headers: { ...authHeader() },
  })
  return handle<any[]>(res)
}

export async function createLateOverride(body: {
  uid: string
  date: string
  mode: 'set' | 'delta'
  amount_iqd: number
  note: string
}) {
  const res = await fetch(`${getApiBase()}/payroll/late_override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
  return handle<{ id: number }>(res)
}

export async function updateLateOverride(
  id: number,
  payload: { mode: 'set' | 'delta'; amount_iqd: number; note: string }
) {
  const res = await fetch(`${getApiBase()}/payroll/late_override/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload),
  })
  return handle<{ ok: boolean }>(res)
}

export async function deleteLateOverride(id: number, reason: string) {
  const url = new URL(`${getApiBase()}/payroll/late_override/${id}`)
  url.searchParams.set('reason', reason) // backend expects ?reason=
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { ...authHeader() },
  })
  return handle<{ ok: boolean }>(res)
}
