// src/api/employeeFiles.ts — FULL COMPAT REPLACEMENT

import type { Employee as CoreEmployee } from "./employees";
import { useAuthStore } from "@/store/auth";
import client from './client';

export type ID = string | number;

// Your page imported EmployeeLite; make it an alias of the Employee used elsewhere.
export type EmployeeLite = CoreEmployee;

export type EmpLog = {
  id?: ID;
  // normalized fields your UI uses:
  in?: string;
  out?: string | null;
  device?: string;
  hours?: number;
  // raw-ish fields from backend/proxy:
  type?: "in" | "out" | string;
  timestamp: string;
  source?: string;
  branch?: string;
  duration_minutes?: number;
  late?: boolean;
};

// --- DEDUCTIONS (employee-scoped) --------------------------------------------

export type EmpDeductionUpsert = {
  // Use either date (YYYY-MM-DD) or month (YYYY-MM) — backend supports both
  date?: string;
  month?: string;
  amount_iqd: number;
  note?: string;     // UI calls this “reason” sometimes; we normalize below
  reason?: string;   // accepted for convenience; mapped to note
};

export type EmpPayrollMonth = {
  hours_total: number;
  food_allowance: number;
  other_allowance: number;
  deductions: number;
  late_penalty: number;
  total_pay: number;
    advances?: number;
  rows: Array<{
  day: string;
  hours: number;
  // canonical
  food_allowance?: number;
  other_allowance?: number;
  deductions?: number;
  late_penalty?: number;
  // legacy/short keys used by the UI in places
  food?: number;
  other?: number;
  deduct?: number;
  late?: number;
  advance?: number;
  }>;
};

export type EmpDeduction = {
  id: ID;
  month?: string;
  reason?: string;
  amount: number;
  created_at?: string;
  created_by?: string;
};

export type SalaryChange = {
  effective_from?: string;
  employment_type?: string;
  hourly_rate?: number;
  salary_iqd?: number;
  edited_by?: string;
  edited_at?: string;
  reason?: string;
};

export type EmpAdvance = {
  id: ID
  date: string
  kind: 'advance' | 'repayment'
  amount: number
  note?: string
  created_at?: string
  created_by?: string
}

export type EmpAdvanceUpsert = {
  date: string
  kind: 'advance' | 'repayment'
  amount: number
  note?: string
}

function resolveApiBase(): string {
  const env: any = (import.meta as any).env || {};
  const viaEnv =
    env.VITE_API_BASE_URL || env.VITE_API_BASE || env.VITE_API_URL || env.VITE_API || "";
  let base = String(viaEnv || "").trim().replace(/\/+$/g, "");
  if (!base && (typeof location !== 'undefined' && (location.hostname === "localhost" || location.hostname === "127.0.0.1"))) {
    base = "http://127.0.0.1:8000";
  }
  return base;
}


const API_BASE = resolveApiBase();

function currentToken(): string | undefined {
  try {
    // prefer the auth store (works even if you didn't persist to localStorage)
    const fromStore = (useAuthStore as any)?.getState?.()?.token;
    if (fromStore) return fromStore;
  } catch {}
  try {
    // fallback to persisted storage
    return localStorage.getItem("token") || sessionStorage.getItem("token") || undefined;
  } catch {
    return undefined;
  }
}

function withAuth(init: RequestInit = {}): RequestInit {
  const t = currentToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (!(init.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  if (t) headers["Authorization"] = `Bearer ${t}`;
  return { ...init, headers };
}


async function http<T = any>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, withAuth(init));
  if (res.status === 204) return undefined as any;
  const isJSON = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJSON ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (isJSON && (data?.detail || data?.message)) || res.statusText || `HTTP ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

function qs(params: Record<string, any>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function tryHttp<T = any>(variants: string[]): Promise<T> {
  let last: any;
  for (const p of variants) {
    try {
      return await http<T>(p);
    } catch (e: any) {
      last = e;
      if (![401, 403, 404, 405].includes(e?.status)) throw e;
    }
  }
  throw last ?? new Error("All variants failed");
}

// ---------- raw fetchers (prefer proxy) ----------
async function employeesRaw(params?: any): Promise<{ items: any[] }> {
  const data = await tryHttp<any>([
    `/employee_files${qs(params || {})}`,
    `/employees${qs(params || {})}`,
    `/api/employee_files${qs(params || {})}`,
    `/api/employees${qs(params || {})}`,
  ]);
  if (Array.isArray(data)) return { items: data };
  if (data?.items && Array.isArray(data.items)) return { items: data.items };
  if (data?.data && Array.isArray(data.data)) return { items: data.data };
  if (data?.results && Array.isArray(data.results)) return { items: data.results };
  for (const v of Object.values(data || {})) if (Array.isArray(v)) return { items: v as any[] };
  return { items: [] };
}

async function logsRaw(params: any): Promise<any[]> {
  const data = await tryHttp<any>([
    `/employee_files/logs${qs(params || {})}`,
    `/logs${qs(params || {})}`,
    `/api/employee_files/logs${qs(params || {})}`,
    `/api/logs${qs(params || {})}`,
  ]);
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  for (const v of Object.values(data || {})) if (Array.isArray(v)) return v as any[];
  return [];
}

// Add this small helper (near the other helpers in this file)
function matchesMonth(obj: any, ym: string, from: string, to: string) {
  const monthField =
    String(obj?.month || obj?.for_month || obj?.period || obj?.month_name || '').slice(0, 7);
  const fromField = String(obj?.from || obj?.start || obj?.date_from || '').slice(0, 10);
  const toField   = String(obj?.to   || obj?.end   || obj?.date_to   || '').slice(0, 10);

  if (monthField) return monthField === ym;
  if (fromField && toField) return fromField === from && toField === to;

  // Fallback heuristics if the object doesn’t label the month explicitly
  if (Array.isArray(obj?.rows)) {
    const days = obj.rows
      .map((r: any) => String(r.date || r.day || '').slice(0, 10))
      .filter(Boolean);
    return days.some((d) => d.startsWith(ym));
  }
  if (obj?.days && typeof obj.days === 'object') {
    return Object.keys(obj.days).some((k) => String(k).startsWith(ym));
  }
  // Unknown shape → don’t block
  return true;
}

// FULL REPLACEMENT
async function payrollRaw(params: { employee_id: ID; month: string }): Promise<any> {
  const month = monthClamp(params.month);

  // Resolve UID (robust to different shapes)
  const ov = await tryHttp<any>([
    `/employee_files/${params.employee_id}/overview`,
    `/api/employee_files/${params.employee_id}/overview`,
    `/employees/${params.employee_id}`,
    `/api/employees/${params.employee_id}`,
  ]);
  const uid: string = String(
    ov?.employee?.uid || ov?.employee?.code || ov?.uid || ov?.code || ''
  ).toUpperCase();

  // Month -> range (m is 1..12 here)
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const mm = String(m).padStart(2, '0');
  const from = `${y}-${mm}-01`;
  const lastDay = new Date(y, m, 0).getDate(); // FIX: m is 1-based → use (y, m, 0)
  const to = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const wantMonth = `${y}-${mm}`;

  // Prefer your proxy first (it normalizes upstream quirks),
  // then try direct /payroll variants. We only ACCEPT payloads that match the requested month.
  const variants = [
    `/employee_files/payroll${qs({ employee_id: params.employee_id, month: wantMonth })}`,
    `/api/employee_files/payroll${qs({ employee_id: params.employee_id, month: wantMonth })}`,

    // Range (uid/id)
    `/payroll${qs({ employee_uid: uid, from, to })}`,
    `/api/payroll${qs({ employee_uid: uid, from, to })}`,
    `/payroll${qs({ employee_id: params.employee_id, from, to })}`,
    `/api/payroll${qs({ employee_id: params.employee_id, from, to })}`,

    // Month (uid/id)
    `/payroll${qs({ employee_uid: uid, month: wantMonth })}`,
    `/api/payroll${qs({ employee_uid: uid, month: wantMonth })}`,
    `/payroll${qs({ employee_id: params.employee_id, month: wantMonth })}`,
    `/api/payroll${qs({ employee_id: params.employee_id, month: wantMonth })}`,
  ];

  let lastErr: any = null;
  for (const url of variants) {
    try {
      const res = await http<any>(url);
      const obj = Array.isArray(res)
        ? (res.find((r: any) => String(r?.uid || r?.code).toUpperCase() === uid) ?? res[0] ?? null)
        : res;

      if (!obj) continue;
      if (!matchesMonth(obj, wantMonth, from, to)) continue; // ← only accept the right month
      return obj;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('No payroll variant succeeded');
}


async function deductionsRaw(params: { employee_id: ID; month?: string }): Promise<any[]> {
  const month = monthClamp(params.month);
  try {
    return await tryHttp<any[]>([
      `/employee_files/${params.employee_id}/deductions${qs({ month })}`,
      `/api/employee_files/${params.employee_id}/deductions${qs({ month })}`,
    ]);
  } catch (e: any) {
    if (![403, 404, 405, 422].includes(e?.status)) throw e;
  }
  return await tryHttp<any[]>([
    `/payroll/deductions${qs({ employee_id: params.employee_id, month })}`,
    `/api/payroll/deductions${qs({ employee_id: params.employee_id, month })}`,
  ]);
}

// ---------- helpers ----------
function monthClamp(m?: string) {
  if (!m) return new Date().toISOString().slice(0, 7);
  const mm = String(m);
  if (/^\d{4}-\d{2}$/.test(mm)) return mm;
  try {
    return new Date(mm).toISOString().slice(0, 7);
  } catch {
    return new Date().toISOString().slice(0, 7);
  }
}

// If backend lacks duration, estimate hours from in/out pairs (best-effort)
function estimateHours(items: EmpLog[]): number {
  // Use provided hours first
  if (typeof items[0]?.hours === "number") {
    return items.reduce((a, b) => a + (b.hours || 0), 0);
  }
  // Else from duration_minutes
  if (typeof items[0]?.duration_minutes === "number") {
    return items.reduce((a, b) => a + ((b.duration_minutes || 0) / 60), 0);
  }
  return 0;
}

// ---------- public API ----------
export async function listEmployeeFiles(params: { q?: string; include_archived?: boolean; status?: string } = {}) {
  const p = { include_archived: true, ...params }; // show archived by default
  const res = await employeesRaw(p);
  return (res.items || []) as EmployeeLite[];
}

export async function getLogs(employeeId: ID, from?: string, to?: string): Promise<EmpLog[]> {
  const raw = await logsRaw({
    employee_id: employeeId,
    date_from: from || undefined,
    date_to: to || undefined,
    page: 1,
    page_size: 1000,
    sort: "desc",
  });

  // Normalize to include .in/.out/.device/.hours so your UI compiles unchanged.
  return (raw as any[]).map((l) => {
    const hours =
      typeof l.hours === "number"
        ? l.hours
        : typeof l.duration_minutes === "number"
        ? +(l.duration_minutes / 60).toFixed(2)
        : undefined;
    return {
      id: l.id,
      in: (l.in ?? l.ts_in ?? l.check_in ?? l.date_in ?? l.datetime_in ?? null),
      out: (l.out ?? l.ts_out ?? l.check_out ?? l.date_out ?? l.datetime_out ?? null),
      device: l.device ?? l.source ?? "",
      hours,
      type: l.type,
      timestamp: l.timestamp,
      source: l.source,
      branch: l.branch,
      duration_minutes: l.duration_minutes,
      late: l.late,
    } as EmpLog;
  });
}



/** Create a deduction for a specific employee (by numeric ID). */
export async function createEmpDeduction(
  employeeId: ID,
  input: EmpDeductionUpsert
): Promise<any> {
  const body: any = { ...input };
  if (body.reason && !body.note) body.note = body.reason;
  delete body.reason;

  const candidates = [
    `/employee_files/${employeeId}/deductions`,
    `/api/employee_files/${employeeId}/deductions`,
    `/employees/${employeeId}/deductions`,
    `/api/employees/${employeeId}/deductions`,
  ];
let lastErr: any = null;
  for (const path of candidates) {
    try {
      return await http<any>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      lastErr = e;
      // continue on 404/405 for compatibility, otherwise bubble up
      if (![401, 403, 404, 405].includes(e?.status)) throw e;
    }
  }
  throw lastErr || new Error("Failed to create deduction");
}

/** Update a single deduction (requires employeeId + deductionId). */
export async function updateEmpDeduction(
  employeeId: ID,
  deductionId: ID,
  input: Partial<EmpDeductionUpsert>
): Promise<any> {
  const body: any = { ...input };
  if (body.reason && !body.note) body.note = body.reason;
  delete body.reason;

  const candidates = [
    `/employee_files/${employeeId}/deductions/${deductionId}`,
    `/api/employee_files/${employeeId}/deductions/${deductionId}`,
    `/employees/${employeeId}/deductions/${deductionId}`,
    `/api/employees/${employeeId}/deductions/${deductionId}`,
  ];

  let lastErr: any = null;
  for (const path of candidates) {
    try {
      return await http<any>(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      lastErr = e;
      if (![401, 403, 404, 405].includes(e?.status)) throw e;
    }
  }
  throw lastErr || new Error("Failed to update deduction");
}



export async function deleteEmpDeduction(
  employeeId: ID,
  deductionId: ID,
  opts?: { reason?: string }   
): Promise<void> {
  const qs = opts?.reason ? `?reason=${encodeURIComponent(opts.reason)}` : '';

  const candidates = [
    `/employee_files/${employeeId}/deductions/${deductionId}${qs}`,
    `/api/employee_files/${employeeId}/deductions/${deductionId}${qs}`,
    `/employees/${employeeId}/deductions/${deductionId}${qs}`,
    `/api/employees/${employeeId}/deductions/${deductionId}${qs}`,
  ];

  let lastErr: any = null;
  for (const path of candidates) {
    try {
      await http<void>(path, { method: "DELETE" });
      return;
    } catch (e: any) {
      lastErr = e;
      if (![401, 403, 404, 405].includes(e?.status)) throw e;
    }
  }
  throw lastErr || new Error("Failed to delete deduction");
}

export async function getAdvances(employeeId: ID, month?: string): Promise<EmpAdvance[]> {
  const q = month ? `?month=${encodeURIComponent(month)}` : ''
  const raw = await tryHttp<any[] | { items: any[] }>([
    `/employee_files/${employeeId}/advances${q}`,
    `/api/employee_files/${employeeId}/advances${q}`,
    `/employees/${employeeId}/advances${q}`,
    `/api/employees/${employeeId}/advances${q}`,
  ])
  const arr = Array.isArray(raw) ? raw : (raw?.items ?? [])
  return arr.map((x: any) => ({
    id: x.id,
    date: x.date,
    kind: String(x.kind || 'repayment').toLowerCase() as 'advance' | 'repayment',
    amount: Number(x.amount_iqd ?? x.amount ?? 0),
    note: x.note ?? x.reason ?? '',
    created_at: x.created_at ?? undefined,
    created_by: x.created_by ?? undefined,
  }))
}

export async function createEmpAdvance(employeeId: ID, input: EmpAdvanceUpsert) {
  const body = { ...input, amount_iqd: input.amount }
  const candidates = [
    `/employee_files/${employeeId}/advances`,
    `/api/employee_files/${employeeId}/advances`,
    `/employees/${employeeId}/advances`,
    `/api/employees/${employeeId}/advances`,
  ]
  let lastErr: any = null
  for (const path of candidates) {
    try {
      return await http<any>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e: any) {
      lastErr = e
      if (![401, 403, 404, 405].includes(e?.status)) throw e
    }
  }
  throw lastErr || new Error('Failed to create advance')
}

export async function updateEmpAdvance(employeeId: ID, id: ID, input: Partial<EmpAdvanceUpsert>) {
  const body: any = { ...input }
  if (body.amount !== undefined) body.amount_iqd = body.amount
  const candidates = [
    `/employee_files/${employeeId}/advances/${id}`,
    `/api/employee_files/${employeeId}/advances/${id}`,
    `/employees/${employeeId}/advances/${id}`,
    `/api/employees/${employeeId}/advances/${id}`,
  ]
  let lastErr: any = null
  for (const path of candidates) {
    try {
      return await http<any>(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e: any) {
      lastErr = e
      if (![401, 403, 404, 405].includes(e?.status)) throw e
    }
  }
  throw lastErr || new Error('Failed to update advance')
}

export async function deleteEmpAdvance(employeeId: ID, id: ID, reason?: string) {
  const q = reason ? `?reason=${encodeURIComponent(reason)}` : ''
  const candidates = [
    `/employee_files/${employeeId}/advances/${id}${q}`,
    `/api/employee_files/${employeeId}/advances/${id}${q}`,
    `/employees/${employeeId}/advances/${id}${q}`,
    `/api/employees/${employeeId}/advances/${id}${q}`,
  ]
  let lastErr: any = null
  for (const path of candidates) {
    try {
      return await http<any>(path, { method: 'DELETE' })
    } catch (e: any) {
      lastErr = e
      if (![401, 403, 404, 405].includes(e?.status)) throw e
    }
  }
  throw lastErr || new Error('Failed to delete advance')
}

// --- bulk employee operations ---
export async function bulkDeleteEmployees(employeeIds: ID[]): Promise<any> {
  const path = `/exports/employees/bulk-delete-ids`;
  const body = { employee_ids: employeeIds.map(id => Number(id)) };
  
  console.log(`Bulk delete API call - Path: ${path}, Body:`, body);
  
  try {
    const result = await http<any>(path, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    
    console.log('Bulk delete API response:', result);
    return result;
  } catch (error: any) {
    console.error('Bulk delete API failed:', error);
    console.error('Error details:', {
      status: error?.status,
      data: error?.data,
      message: error?.message
    });
    throw new Error(error?.message || 'Failed to delete selected employees');
  }
}

export async function getEmployeeOverview(employeeId: ID) {
  try {
    const data = await tryHttp<any>([
      `/employee_files/${employeeId}/overview`,
      `/api/employee_files/${employeeId}/overview`,
    ]);
    if (data && data.employee) return data;
  } catch (e: any) {
    if (![401, 403, 404, 405].includes(e?.status)) throw e;
  }

  const items = await getLogs(employeeId);
  const totalHours = estimateHours(items);
  const last = items[0];
  return {
    employee: { id: employeeId },
    attendance: { last_logs: items },
    stats: {
      month_hours: +totalHours.toFixed(2),
      late_count: items.reduce((acc, l) => acc + (l?.late ? 1 : 0), 0),
      last_seen: last?.in ?? null,
    },
  };
}

export async function getPayroll(employeeId: ID, month: string): Promise<EmpPayrollMonth> {
  const raw = await payrollRaw({ employee_id: employeeId, month });

  // rows[]: prefer array if provided; otherwise map days{} (dict) to rows[]
  const rowsSrc = raw?.rows ?? raw?.days ?? raw?.details ?? [];
  const rowsArr: any[] = Array.isArray(rowsSrc)
    ? rowsSrc
    : (raw?.days && typeof raw.days === 'object'
        ? Object.entries(raw.days)
            .map(([day, hours]) => ({ day, hours: Number(hours) || 0 }))
            .sort((a, b) => a.day.localeCompare(b.day))
        : []);

  const rows = rowsArr.map((d: any, i: number) => ({
    day: d.day ?? d.date ?? String(i + 1).padStart(2, "0"),
    hours: d.hours ?? d.h ?? d.total_hours ?? 0,
    food_allowance: d.food_allowance ?? d.food ?? 0,
    other_allowance: d.other_allowance ?? d.other ?? 0,
    deductions: d.deductions ?? d.deduct ?? 0,
    late_penalty: d.late_penalty ?? d.late ?? 0,
  }));

  // totals: handle top-level or nested 'totals'
  const tot = raw?.totals || {};
  return {
    hours_total:
      raw?.hours_total ?? raw?.hours ?? raw?.total_hours ?? tot.hours ?? 0,
    food_allowance:
      raw?.food_allowance ?? tot.food_allowance_iqd ?? 0,
    other_allowance:
      raw?.other_allowance ?? tot.other_allowance_iqd ?? 0,
    deductions:
      raw?.deductions ?? raw?.deductions_total ?? tot.deductions_iqd ?? 0,
    late_penalty:
      raw?.late_penalty ?? tot.late_penalty_iqd ?? 0,
    total_pay:
      raw?.total_pay ?? raw?.net_pay ?? tot.total_pay_iqd ?? tot.total ?? 0,
    rows,
  };
}

export async function getDeductions(employeeId: ID, month?: string): Promise<EmpDeduction[]> {
  try {
    const raw = await deductionsRaw({ employee_id: employeeId, month });
    const arr = Array.isArray(raw) ? raw : [];

    return arr.map((d: any) => {
      const createdBy =
        d.created_by_name ??
        (d.created_by_user && (d.created_by_user.display_name || d.created_by_user.name || d.created_by_user.username)) ??
        d.user_name ??
        d.user ??
        d.created_by ??
        d.createdBy ??
        null;

      return {
        id: d.id,
        month: d.month,
        reason: d.reason ?? d.label,
        amount: d.amount ?? d.value ?? 0,
        created_at: d.created_at,
        created_by: createdBy ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

export async function getSalaryHistory(employeeId: ID): Promise<SalaryChange[]> {
  const raw = await tryHttp<any[] | { items: any[] }>([
    `/employee_files/${employeeId}/salary_history`,
    `/payroll${qs({ employee_id: employeeId })}`,
    `/api/employee_files/${employeeId}/salary_history`,
    `/api/payroll${qs({ employee_id: employeeId })}`,
  ]);
  const arr = Array.isArray(raw) ? raw : raw?.items ?? [];
  return arr.map((h: any) => ({
    effective_from: h.effective_from ?? h.month,
    employment_type: h.employment_type,
    hourly_rate: h.hourly_rate,
    salary_iqd: h.salary_iqd ?? h.gross,
    edited_by: h.edited_by,
    edited_at: h.edited_at,
    reason: h.reason,
  }));
}

export function exportLogsXlsxUrl(employeeId: ID, from?: string, to?: string): { url: string } {
  const url = new URL(`${API_BASE}/exports/logs.xlsx`);
  url.searchParams.set("employee_id", String(employeeId));
  if (from) url.searchParams.set("from", from);
  if (to) url.searchParams.set("to", to);
  return { url: url.toString() };
}

const employeeFileApi = {
  // lists
  listEmployeeFiles,

  // overview/payroll
  getOverview: getEmployeeOverview,
  getPayroll,

  // deductions
  getDeductions,
  createEmpDeduction,
  updateEmpDeduction,
  deleteEmpDeduction,

  // advances
  getAdvances,
  createEmpAdvance,
  updateEmpAdvance,
  deleteEmpAdvance,

  // exports
  exportLogsXlsxUrl,

  // bulk operations
  bulkDeleteEmployees,
};

export default employeeFileApi;

// --- export: payslip ---
export async function exportPayslipXlsx(employee_id: number, month: string) {
  const base = API_BASE;
  const url = `${base}/employee_files/payslip.xlsx?employee_id=${employee_id}&month=${encodeURIComponent(month)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return await res.blob();
}

export async function exportPayslipCsv(employee_id: number, month: string) {
  const base = API_BASE;
  const url = `${base}/employee_files/payslip.csv?employee_id=${employee_id}&month=${encodeURIComponent(month)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return await res.blob();
}
