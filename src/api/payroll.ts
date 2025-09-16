// src/api/payroll.ts

export type PayrollTotals = {
  hours: number
  food_allowance_iqd: number
  other_allowance_iqd: number
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
  try {
    const s = (window as any)?.useAuthStore?.getState?.()
    const b = s?.apiBase as string | undefined
    if (b) return b.replace(/\/+$/, '')
  } catch {}
  const env = (import.meta as any)?.env?.VITE_API_URL as string | undefined
  if (env) return env.replace(/\/+$/, '')
  const url = new URL(window.location.href)
  const port = url.port === '5173' ? '8000' : url.port
  return `${url.protocol}//${url.hostname}${port ? ':' + port : ''}`
}

function tokenHeader() {
  let t: string | undefined
  try { t = (window as any)?.useAuthStore?.getState?.().token } catch {}
  t = t || localStorage.getItem('jwt') || localStorage.getItem('token') ||
      localStorage.getItem('auth_token') || localStorage.getItem('access_token') || ''
  return t ? { Authorization: /^bearer\s/i.test(t) ? t : `Bearer ${t}` } : {}
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

// ----------- Payroll -----------
export async function getPayroll(params: { from: string; to: string; branch?: string }): Promise<PayrollRow[]> {
  const q = new URLSearchParams()
  q.set('from', params.from)
  q.set('to', params.to)
  if (params.branch) q.set('branch', params.branch)

  const res = await fetch(`${getApiBase()}/payroll?${q.toString()}`, { headers: { ...tokenHeader() } })
  const arr: any[] = await handle<any[]>(res)
  return (Array.isArray(arr) ? arr : []).map(r => {
    const uid = String(r.uid || r?.meta?.uid || '').toUpperCase()
    const t = r.totals || {}
    return {
      uid,
      code: r.code ?? '',
      name: r.name ?? '',
      branch: r.branch ?? '',
      nationality: String(r.nationality ?? '').toLowerCase(),
      days: r.days || {},
      totals: {
        hours: Number(t.hours ?? 0),
        food_allowance_iqd: Number(t.food_allowance_iqd ?? 0),
        other_allowance_iqd: Number(t.other_allowance_iqd ?? 0),
        deductions_iqd: Number(t.deductions_iqd ?? 0),
        late_penalty_iqd: Number(t.late_penalty_iqd ?? 0),
        allowances_iqd: Number(t.allowances_iqd ?? 0),
        base_salary_iqd: Number(t.base_salary_iqd ?? 0),
        total_pay_iqd: Number(t.total_pay_iqd ?? 0),
      },
      meta: r.meta,
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
