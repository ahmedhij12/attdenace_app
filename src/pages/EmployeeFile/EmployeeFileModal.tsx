// src/pages/EmployeeFile/index.tsx
import React, { useEffect, useRef, useState } from 'react'
import employeeFileApi, {
  type EmployeeLite,
  type EmpLog,
  type EmpPayrollMonth,
  type EmpDeduction,
  type SalaryChange,
  bulkDeleteEmployees,
} from '@/api/employeeFiles'
import { useAuthStore } from '@/store/auth'
import { AttendanceIcon } from '@/components/AttendanceIcon'
import RoleBadge from '@/components/RoleBadge'
import { formatMinutes } from '@/features/employeeFiles/utils'
import { BRAND_OPTIONS } from '@/constants/brands';
import { exportPayslipXlsx, exportPayslipCsv } from '@/api/employeeFiles';
import { toLocalTime, toLocalDate, toIsoZ } from '../../features/employeeFiles/utils/time';


// Lazy load the Late Overrides panel (expects { empId: number; uid: string; month: string })
const LateOverridesTab = React.lazy(
  () => import('./LateOverrides')
) as React.LazyExoticComponent<
  React.ComponentType<{ empId: number; uid: string; month: string }>
>;
const SalaryHistoryTab = React.lazy(
  () => import('./SalaryHistory')
) as React.LazyExoticComponent<React.ComponentType<{ empId: number }>>;

import PayrollTab from './PayrollTab';
import DeductionsTab from './DeductionsTab';

// API Base resolver function - consistent with other API configurations
function resolveApiBase(): string {
  const env = (import.meta as any)?.env || {};
  const envApiBase = 
    env.VITE_API_BASE_URL ||
    env.VITE_API_BASE ||
    env.VITE_API_URL ||
    env.VITE_API ||
    localStorage.getItem("api_base");
    
  if (envApiBase) {
    const cleaned = String(envApiBase).trim().replace(/\/+$/g, "");
    console.log('[EmployeeFileModal] Using API base from env:', cleaned);
    return cleaned;
  }

  // Auto-detect based on environment
  const isDevelopment = env.MODE === 'development' || env.DEV === true;
  
  if (isDevelopment) {
    try {
      const currentUrl = new URL(window.location.href);
      const isLocalhost = ['localhost', '127.0.0.1'].includes(currentUrl.hostname);
      const isDevPort = ['5173', '5174', '5175', '3000'].includes(currentUrl.port);
      
      if (isLocalhost && isDevPort) {
        const apiUrl = `${currentUrl.protocol}//${currentUrl.hostname}:8000`;
        console.log('[EmployeeFileModal] Development mode: Using local backend:', apiUrl);
        return apiUrl;
      }
    } catch {
      // Fallback for SSR or other issues
    }
  }
  
  // Production fallback
  console.log('[EmployeeFileModal] Using production API');
  return "https://api.hijazionline.org";
}

const API_BASE = resolveApiBase();

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function tzParseLocal(ts?: string | Date | null): Date | null {
  if (ts == null) return null;
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;

  const s = String(ts).trim();
  if (!s) return null;

  // Respect explicit timezone/UTC markers by delegating to Date parser
  if (/[zZ]|[\+\-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    // Treat naive ISO timestamps as UTC (not Baghdad), by appending “Z”
    const isoUtc = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}Z`;
    const d = new Date(isoUtc);
    return isNaN(d.getTime()) ? null : d;
  }

  try {
    const d = new Date(s); // handles ISO with Z/offset correctly
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function tzLocalHM(ts?: string | Date | null): string {
  const d = tzParseLocal(ts);
  return d
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Baghdad' })
    : '—';
}

function tzMinutesBetween(a?: string | Date | null, b?: string | Date | null): number {
  const A = tzParseLocal(a);
  const B = tzParseLocal(b);
  if (!A || !B) return 0;
  const ms = Math.max(0, B.getTime() - A.getTime());
  return Math.round(ms / 60000);
}
function scavengePerDay(node: any): Record<string, number> {
  const out: Record<string, number> = {};
  const seen = new Set<any>();
  const isDay = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k);

  const asHours = (v: any): number => {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string') {
      const m = v.match(/^(\d+):(\d{2})$/);          // "7:30" -> 7.5
      if (m) return +m[1] + +m[2] / 60;
      const f = parseFloat(v);
      return isFinite(f) ? f : 0;
    }
    if (v && typeof v === 'object') {
      if (v.hours != null)        return asHours(v.hours);
      if (v.total_hours != null)  return asHours(v.total_hours);
    }
    return 0;
  };

  const walk = (n: any) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);

    if (!Array.isArray(n)) {
      // Map with ISO keys
      for (const k of Object.keys(n)) {
        const val = (n as any)[k];
        if (isDay(k)) out[k] = asHours(val);
      }
      // Common array shapes inside objects
      for (const k of Object.keys(n)) {
        const v = (n as any)[k];
        if (Array.isArray(v)) {
          for (const it of v) {
            const d = it?.day ?? it?.date;
            if (typeof d === 'string' && isDay(d)) {
              out[d] = asHours(it?.hours ?? it?.total_hours ?? it);
            }
          }
        }
      }
      for (const k of Object.keys(n)) walk((n as any)[k]);
    } else {
      for (const it of n) walk(it);
    }
  };

  walk(node);
  return out;
}


// ---- delete helper (uses proper API base and endpoints) ----
async function deleteEmployeeById(empId: number, hard = false): Promise<boolean> {
  const token = useAuthStore.getState().token
  if (!token) return false
  const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`

  // Use the same API_BASE that's defined in this file
  const endpoints = hard
    ? [`${API_BASE}/employees/${empId}/purge`, `${API_BASE}/api/employees/${empId}/purge`]
    : [`${API_BASE}/employees/${empId}`, `${API_BASE}/api/employees/${empId}`]

  for (const path of endpoints) {
    try {
      console.log(`Attempting to delete employee ${empId} via ${path}`)
      const r = await fetch(path, {
        method: 'DELETE',
        headers: { 
          Accept: 'application/json', 
          Authorization: auth,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
      })
      
      if (r.ok) {
        console.log(`Successfully deleted employee ${empId} via ${path}`)
        return true
      } else {
        console.log(`Delete failed for ${path}: ${r.status} ${r.statusText}`)
        // Try to read error response
        try {
          const errorText = await r.text()
          console.log(`Error response: ${errorText}`)
        } catch {}
      }
    } catch (error) {
      console.error(`Error calling ${path}:`, error)
    }
  }
  return false
}

// ---- misc helpers ----
function normalizeDateToISO(v?: string): string | undefined {
  if (!v) return undefined
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

function sanitizeEmployeePayload(input: any) {
  const employment_type = String(input.employment_type ?? input.employmentType ?? 'wages').toLowerCase()
  const isSalary = employment_type === 'salary'

  const name = String(input.name ?? '').trim()
  const branch = String(input.branch ?? '').trim()
  const department = String(input.department ?? input.dept ?? '').trim()
  const uid = String(input.uid ?? input.code ?? '').toUpperCase().trim()
  const code = String(input.code ?? '').trim()
  const join_date =
    normalizeDateToISO(input.join_date ?? input.joined_at ?? input.joinedAt ?? input.joined) || undefined

  const body: any = {
  name,
  department,
  branch,
  uid,
  code,
  employment_type: isSalary ? 'salary' : 'wages',
};

const brand = String(input.brand ?? '').trim();
if (brand) body.brand = brand;   // NEW

  const nationality = String(input.nationality ?? '').trim();
  if (nationality) body.nationality = nationality;

  if (!isSalary) body.hourly_rate = Number(input.hourly_rate ?? input.hourlyRate ?? 0)
  if (isSalary) body.salary_iqd = Number(input.salary_iqd ?? input.salary ?? 0)

  const phone = input.phone ?? input.mobile ?? ''
  if (String(phone).trim()) body.phone = String(phone).trim()
  if (join_date) body.join_date = join_date

  return body
}

type TabKey = 'overview' | 'logs' | 'payroll' | 'deductions' | 'advances' | 'salary' | 'overrides';


/* =========================
   EmployeeFileModal
   ========================= */



export default function EmployeeFileModal({  
  emp,
  onClose,
  tab,
  setTab,
  canEdit,
  role,                            
  onStatusChange,
  onMetaChange,
  branchOptions,
}: {
  emp: EmployeeLite
  onClose: () => void
  tab: TabKey
  setTab: (t: TabKey) => void
  canEdit: boolean
  role: 'admin' | 'hr' | 'accountant' | string   
  onStatusChange: (id: number, status: 'active' | 'left') => void
  onMetaChange: (id: number, patch: Partial<any>) => void
  branchOptions: string[]
}) {

  const [month, setMonth] = useState<string>(() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
});


const isAccountant = String(role || '').toLowerCase() === 'accountant';
const canEditAdv = ['admin', 'accountant'].includes(String(role || '').toLowerCase());


const tabs = isAccountant
  ? ([{ key: 'advances', label: 'Advances', icon: '💸' }] as const)
  : ([
      { key: 'overview',   label: 'Overview',       icon: '👤' },
      { key: 'logs',       label: 'Logs',           icon: '📋' },
      { key: 'payroll',    label: 'Payroll',        icon: '💰' },
      { key: 'deductions', label: 'Deductions',     icon: '📉' },

      // ⬇️ show only to admin or HR
      ...( ['admin','hr'].includes(String(role || '').toLowerCase())
          ? [{ key: 'overrides', label: 'Late Overrides', icon: '⏱️' }]
          : [] ),

      ...(String(role || '').toLowerCase() === 'admin'
          ? [{ key: 'advances', label: 'Advances', icon: '💸' }]
          : []),

      { key: 'salary',     label: 'Salary History', icon: '📈' },
    ] as const);


// Force accountant into the Advances tab (and guard if URL tried to open another)
React.useEffect(() => {
  const allowed = new Set(tabs.map(t => t.key));
  if (!allowed.has(tab)) setTab(isAccountant ? 'advances' : 'overview');
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isAccountant, role]);


  const [from, setFrom] = useState<string>(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  })
  const [to, setTo] = useState<string>(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  })

  // Deductions UI state (kept for parent component)
  const [dedLoadNonce, setDedLoadNonce] = useState(0)

  const [advs, setAdvs] = useState<any[]>([])
const [advMsg, setAdvMsg] = useState<string | null>(null)
const [advLoadNonce, setAdvLoadNonce] = useState(0)
const [addAdvDate, setAddAdvDate] = useState<string>(new Date().toISOString().slice(0,10))
const [addAdvKind, setAddAdvKind] = useState<'advance'|'repayment'>('repayment')
const [addAdvAmount, setAddAdvAmount] = useState<string>('0')
const [addAdvReason, setAddAdvReason] = useState<string>('')

const [payrollLoadNonce, setPayrollLoadNonce] = useState(0)

const [editingAdvId, setEditingAdvId] = useState<number | null>(null)
const [editAdvDate, setEditAdvDate] = useState<string>('')
const [editAdvKind, setEditAdvKind] = useState<'advance'|'repayment'>('repayment')
const [editAdvAmount, setEditAdvAmount] = useState<string>('')
const [editAdvReason, setEditAdvReason] = useState<string>('')



  const field =
  "px-2 py-1 rounded-lg border " +
  "bg-white text-slate-900 border-slate-300 " +                      // light
  "dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 " +   // dark
  "placeholder-slate-400 dark:placeholder-slate-500 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 " +
  "dark:focus:border-blue-500";


  // Data
  const [overview, setOverview] = useState<any>(null)
  const [logs, setLogs] = useState<EmpLog[] | null>(null)
  const [pay, setPay] = useState<EmpPayrollMonth | null>(null)
  const [deds, setDeds] = useState<EmpDeduction[] | null>(null)
  const [history, setHistory] = useState<SalaryChange[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // --- Edit Day (single modal to control both IN and OUT) ---
  const [showEditDay, setShowEditDay] = useState(false);
  const [dayInTime, setDayInTime] = useState<string>('');
  const [dayOutTime, setDayOutTime] = useState<string>('');
  const [dayReason, setDayReason] = useState<string>('Adjust day');
  const [dayCtx, setDayCtx] = useState<null | {
    inCorrId: number | null;
    outCorrId: number | null;
    inISO: string | null;
    outISO: string | null;
    hasIn: boolean;
    hasOut: boolean;
  }>(null);


  // Toggle status UX
  const [saving, setSaving] = useState(false)
  const token = useAuthStore((s) => s.token)
  const inFlightRef = useRef<boolean>(false)

  // EDITING (branch + employment + pay)
  const [editing, setEditing] = useState(false)
  const [editVals, setEditVals] = useState<any>(() => ({
  branch: (emp as any).branch ?? '',
  department: (emp as any).department ?? '',
  brand: (emp as any).brand ?? '',
  employment_type: (emp as any).employment_type ?? 'wages',
  hourly_rate: (emp as any).hourly_rate ?? '',
  salary_iqd: (emp as any).salary_iqd ?? '',
  code: (emp as any).code ?? '',
  uid: (emp as any).uid ?? '',
}))
// ...
useEffect(() => {
setEditVals((v: any) => ({
  ...v,
  branch:        overview?.branch        ?? (emp as any).branch        ?? '',
  department:    overview?.department    ?? (emp as any).department    ?? '',
  brand:         overview?.brand         ?? (emp as any).brand         ?? '',
  employment_type: overview?.employment_type ?? (emp as any).employment_type ?? 'wages',
  hourly_rate:   overview?.hourly_rate   ?? (emp as any).hourly_rate   ?? '',
  salary_iqd:    overview?.salary_iqd    ?? (emp as any).salary_iqd    ?? '',
  code: (overview as any)?.employee?.code ?? (emp as any).code ?? '',
  uid: (overview as any)?.employee?.uid ?? (emp as any).uid ?? '',
}))

  }, [overview, (emp as any).id])

// Open the unified "Edit Day" modal
function openEditDay(row: any) {
  // If this is an empty day, prefill with the date at 09:00 and 17:00
  if (row.isEmpty && row.emptyDate) {
    const dateStr = row.emptyDate;
    setDayInTime(`${dateStr}T09:00`);
    setDayOutTime(`${dateStr}T17:00`);
    setDayReason('Manual attendance entry');
    setDayCtx({
      inCorrId: null,
      outCorrId: null,
      inISO: null,
      outISO: null,
      hasIn: false,
      hasOut: false,
    });
  } else {
    const inLocal = row.inISO ? toLocalInputValue(row.inISO) : '';
    const outLocal = row.outISO ? toLocalInputValue(row.outISO) : '';
    setDayInTime(inLocal);
    setDayOutTime(outLocal);
    setDayReason('Adjust day');
    setDayCtx({
      inCorrId: row.inCorrId ?? null,
      outCorrId: row.outCorrId ?? null,
      inISO: row.inISO ?? null,
      outISO: row.outISO ?? null,
      hasIn: !!row.inISO,
      hasOut: !!row.outISO,
    });
  }
  setShowEditDay(true);
}

// Uses the same fallback strategy as submitEdit(), calling either Corrections or Add Checkout endpoints.
async function submitEditDay() {
  const tk = useAuthStore.getState().token;
  if (!tk) throw new Error('Unauthorized');
  const auth = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`;
  const empId = Number((emp as any).id);
  if (!empId) throw new Error('Missing employee id');
  if (!dayCtx) return;

  // Local helper mirroring submitEdit's fallback fetch sequence
  async function tryFetch(seq: Array<{url:string, method:'POST'|'PUT', body:any}>) {
    for (const s of seq) {
      try {
        const r = await fetch(s.url, {
          method: s.method,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
          credentials: 'include',
          body: s.body ? JSON.stringify(s.body) : undefined,
        });
        if (r.ok) return true;
      } catch {}
    }
    return false;
  }

  const tasks: Array<Promise<any>> = [];

  // ---- IN handling ---- (skip if unchanged device check-in)
if (dayInTime && dayInTime.trim()) {
  // Convert local time into a UTC ISO string by treating it as Baghdad (+03:00)
  const toBaghdadUtc = (t: string): string => {
    const hasSeconds = /:\d{2}(?:[:]\d{2})?$/.test(t);
    const withSeconds = hasSeconds ? t : `${t}:00`;
    return toIsoZ(`${withSeconds}+03:00`);
  };
  const inISONow = toBaghdadUtc(dayInTime.trim());

  const originalLocal = dayCtx.inISO ? toLocalInputValue(dayCtx.inISO) : null;
  // Compare the user’s entered time with the existing local time (ignore seconds)
  const sameIn = !!(
    originalLocal &&
    dayInTime &&
    dayInTime.trim().slice(0, 16) === originalLocal.slice(0, 16)
  );
  if (dayCtx.hasIn && !dayCtx.inCorrId && sameIn) {
    // IN came from device and user didn't change it → don't create any IN correction
  }  else if (dayCtx.hasIn) {
    if (dayCtx.inCorrId) {
      tasks.push(tryFetch([
        { url: `/employee_files/${empId}/logs/corrections/${dayCtx.inCorrId}`, method: 'PUT', body: { ts_in: inISONow, reason: dayReason } },
        { url: `/api/employee_files/${empId}/logs/corrections/${dayCtx.inCorrId}`, method: 'PUT', body: { ts_in: inISONow, reason: dayReason } },
      ]).then(ok => { if (!ok) throw new Error('Failed to update IN'); }));
    } else {
      const payloadIn: any = { ts_in: inISONow, reason: dayReason, dir: 'in' as const };
      if (dayCtx.inISO) payloadIn.original_ts = dayCtx.inISO;
      tasks.push(tryFetch([
        { url: `/employee_files/${empId}/logs/corrections`, method: 'POST', body: payloadIn },
        { url: `/api/employee_files/${empId}/logs/corrections`, method: 'POST', body: payloadIn },
        { url: `/employee_files/${empId}/logs/edit`, method: 'POST', body: payloadIn },
        { url: `/api/employee_files/${empId}/logs/edit`, method: 'POST', body: payloadIn },
        { url: `/logs/corrections`, method: 'POST', body: { employee_id: empId, ...payloadIn } },
        { url: `/api/logs/corrections`, method: 'POST', body: { employee_id: empId, ...payloadIn } },
      ]).then(ok => { if (!ok) throw new Error('Failed to create IN'); }));
    }
  } else {
    // No existing IN → add_checkin (unchanged)
    tasks.push((async () => {
      try {
        const r = await fetch(`${API_BASE}/employee_files/${empId}/logs/add_checkin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          credentials: "include",
          body: JSON.stringify({ in: inISONow, reason: dayReason || 'Manual check-in' }),
        });
        if (!r.ok) throw new Error('add_checkin failed');
      } catch { /* fallbacks unchanged */ }
    })());
  }
}

  // ---- OUT handling ---- (skip if unchanged device checkout)
if (dayOutTime && dayOutTime.trim()) {
  const toBaghdadUtc = (t: string): string => {
    const hasSeconds = /:\d{2}(?:[:]\d{2})?$/.test(t);
    const withSeconds = hasSeconds ? t : `${t}:00`;
    return toIsoZ(`${withSeconds}+03:00`);
  };
  const outISONow = toBaghdadUtc(dayOutTime.trim());

  const outISOOrig = dayCtx.outISO ? toIsoZ(dayCtx.outISO) : null;
  // Compare the user’s entered time with the existing local time (ignore seconds)
  const sameOut = !!(
    outISOOrig &&
    dayOutTime &&
    dayOutTime.trim().slice(0, 16) === toLocalInputValue(outISOOrig).slice(0, 16)
  );

  if (dayCtx.hasOut && !dayCtx.outCorrId && sameOut) {
    // OUT came from device and user didn't change it → don't create any OUT correction
  } else if (dayCtx.hasOut) {
    if (dayCtx.outCorrId) {
      tasks.push(tryFetch([
        { url: `/employee_files/${empId}/logs/corrections/${dayCtx.outCorrId}`, method: 'PUT', body: { ts_out: outISONow, reason: dayReason } },
        { url: `/api/employee_files/${empId}/logs/corrections/${dayCtx.outCorrId}`, method: 'PUT', body: { ts_out: outISONow, reason: dayReason } },
      ]).then(ok => { if (!ok) throw new Error('Failed to update OUT'); }));
    } else {
      const payloadOut: any = { ts_out: outISONow, reason: dayReason, dir: 'out' as const };
      if (dayCtx.outISO) payloadOut.original_ts = dayCtx.outISO;
      tasks.push(tryFetch([
        { url: `/employee_files/${empId}/logs/corrections`, method: 'POST', body: payloadOut },
        { url: `/api/employee_files/${empId}/logs/corrections`, method: 'POST', body: payloadOut },
        { url: `/employee_files/${empId}/logs/edit`, method: 'POST', body: payloadOut },
        { url: `/api/employee_files/${empId}/logs/edit`, method: 'POST', body: payloadOut },
        { url: `/logs/corrections`, method: 'POST', body: { employee_id: empId, ...payloadOut } },
        { url: `/api/logs/corrections`, method: 'POST', body: { employee_id: empId, ...payloadOut } },
      ]).then(ok => { if (!ok) throw new Error('Failed to create OUT'); }));
    }
  } else {
    // No existing OUT → add_checkout (unchanged, already sending { out: ... })
    tasks.push((async () => {
      try {
        const r = await fetch(`${API_BASE}/employee_files/${empId}/logs/add_checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          credentials: "include",
          body: JSON.stringify({ out: outISONow, reason: dayReason || 'Forgot to punch out' }),
        });
        if (!r.ok) throw new Error('add_checkout failed');
      } catch {
        const payloadOut: any = { ts_out: outISONow, reason: dayReason || 'Forgot to punch out', dir: 'out' as const };
        await tryFetch([
          { url: `/employee_files/${empId}/logs/corrections`, method: 'POST', body: payloadOut },
          { url: `/api/employee_files/${empId}/logs/corrections`, method: 'POST', body: payloadOut },
          { url: `/employee_files/${empId}/logs/edit`, method: 'POST', body: payloadOut },
          { url: `/api/employee_files/${empId}/logs/edit`, method: 'POST', body: payloadOut },
          { url: `/logs/corrections`, method: 'POST', body: { employee_id: empId, ...payloadOut } },
          { url: `/api/logs/corrections`, method: 'POST', body: { employee_id: empId, ...payloadOut } },
        ]);
      }
    })());
  }
}

  await Promise.all(tasks);
  setShowEditDay(false);
  await reloadLogs();
}
async function updateEmployeeWithFallback(empId: number, fullBody: any): Promise<boolean> {
    const tk = useAuthStore.getState().token
    if (!tk) return false
    const auth = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`
    for (const path of [`/employees/${empId}`, `/api/employees/${empId}`]) {
      try {
        const r = await fetch(path, {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: auth,
          },
          credentials: 'include',
          body: JSON.stringify(fullBody),
        })
        if (r.ok) return true
      } catch {}
    }
    return false
  }

  // Date helpers (inside modal scope)
  function toIsoDateStart(v: string): string | undefined {
    if (!v) return undefined;
    const m1 = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m1) {
      // Build a UTC start-of-day timestamp; no locale shift
      return `${m1[1]}-${m1[2]}-${m1[3]}T00:00:00Z`;
    }
    const m2 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m2) {
      const [_, mm, dd, yyyy] = m2;
      const mm2 = mm.padStart(2, '0');
      const dd2 = dd.padStart(2, '0');
      return `${yyyy}-${mm2}-${dd2}T00:00:00Z`;
    }
    return undefined;
  }
  function toIsoDateEnd(v?: string): string | undefined {
    if (!v) return undefined;
    // Always append Z for end‑of‑day to avoid locale-based shifts
    return `${v}T23:59:59Z`;
  }
  function isValidDateInput(v: string): boolean {
  if (!v) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  return v >= '2000-01-01' && v <= '2100-12-31';
}


  function toLocalInputValue(ts: string) {
  const d = tzParseLocal(ts);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// --- robust local pairing for mixed arrays of sessions+events ---
function pairLogsMixedSafe(rows: any[]): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  type PunchType = 'in' | 'out';
  type Session = { in?: string; out?: string; device?: string };
  type Event = { ts: string; type: PunchType; device?: string };

  const IN_KEYS  = ['in','checkin','in_time','time_in','date_in','datetime_in','ts_in','timestamp_in','inTimestamp'];
  const OUT_KEYS = ['out','checkout','out_time','time_out','date_out','datetime_out','ts_out','timestamp_out','outTimestamp'];
  const TYPE_KEYS = ['type','event','direction','io','status','action'];
  const TS_KEYS   = ['ts','timestamp','datetime','dateTime','timeStamp'];

  const firstDefined = (obj: any, keys: string[]) => {
    for (const k of keys) if (obj && obj[k] != null) return String(obj[k]);
    return undefined;
  };
  const normType = (v: any): PunchType | undefined => {
    const s = String(v || '').toLowerCase();
    if (s.startsWith('in')) return 'in';
    if (s.startsWith('out')) return 'out';
    return undefined;
  };
  const extractDevice = (r: any): string | undefined =>
    r.device ?? r.device_name ?? r.station ?? r.branch ?? r.source ?? undefined;

  // Build explicit events first to avoid double counting
  const events: Event[] = [];
  for (const r of rows) {
    const dev = extractDevice(r);
    const inTs  = firstDefined(r, IN_KEYS);
    const outTs = firstDefined(r, OUT_KEYS);

    if (inTs)  events.push({ ts: inTs, type: 'in',  device: dev });
    if (outTs) events.push({ ts: outTs, type: 'out', device: dev });

    // Only if there are NO explicit in/out fields, consider generic timestamp + type
    if (!inTs && !outTs) {
      const t  = normType(firstDefined(r, TYPE_KEYS));
      const ts = firstDefined(r, TS_KEYS);
      if (t && ts) events.push({ ts, type: t, device: dev });
    }
  }

  // Normalize timestamps to ISO and sort ASC
  const toISO = (s: string): string | null => {
    try {
      const fixed = /T/.test(s) ? s : s.replace(' ', 'T');
      // If there’s no timezone/offset, assume UTC by appending “Z”
      const withOffset = /[zZ]|[+\-]\d{2}:?\d{2}$/.test(fixed)
        ? fixed
        : `${fixed}Z`;
      const d = new Date(withOffset);
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  };

  let norm: Event[] = [];
  for (const e of events) {
    const iso = toISO(e.ts);
    if (iso) norm.push({ ts: iso, type: e.type, device: e.device });
  }
  norm.sort((a, b) => a.ts.localeCompare(b.ts));

  // De-duplicate exact duplicates (same type + same timestamp)
  const seen = new Set<string>();
  const uniq: Event[] = [];
  for (const e of norm) {
    const key = `${e.type}|${e.ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(e);
  }

  // Pair by latest unmatched IN on the same calendar day (UTC)
  const ymd = (iso: string) => iso.slice(0, 10);
  const sessions: Session[] = [];
  let open: Session | null = null;
  for (const e of uniq) {
    if (e.type === 'in') {
      if (open) { sessions.push(open); open = null; }
      open = { in: e.ts, device: e.device };
    } else { // out
      if (open && open.in && ymd(open.in) === ymd(e.ts) && open.in <= e.ts) {
        open.out = e.ts;
        sessions.push(open);
        open = null;
      } else {
        sessions.push({ out: e.ts, device: e.device }); // stray OUT
      }
    }
  }
  if (open) sessions.push(open);

  return sessions;
}

function toYMD(v?: string | null): string | null {
  const d = tzParseLocal(v);
  if (!d) return null;
  // en-CA -> YYYY-MM-DD; force Baghdad zone
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
}

  const raw = Array.isArray(logs) ? logs : (logs as any)?.items ?? [];
  const looksPaired = raw.some(
    (r: any) =>
      r.date_in ||
      r.in ||
      r.check_in ||
      r.datetime_in ||
      r.date_out ||
      r.out ||
      r.check_out ||
      r.datetime_out ||
      typeof r.hours === 'number'
  )

  const belongsToActiveEmp = (r: any) => {
    const rId = r.employee_id ?? r.emp_id ?? r.employeeId ?? r.user_id ?? null
    if (rId != null && String(rId) === String((emp as any).id)) return true

    const rCode = r.code ?? r.emp_code ?? r.user_code ?? r.uid ?? null
    const eCode = (emp as any).code ?? (emp as any).uid ?? null
    if (rCode && eCode && String(rCode) === String(eCode)) return true

    const rName = r.employee_name ?? r.name ?? null
    if (rName && (emp as any).name && rName === (emp as any).name) return true
    return false
  }

  const rowsAll = pairLogsMixedSafe(raw);
  const hasIdField = rowsAll.some(
    (r: any) => r.employee_id != null || r.emp_id != null || r.employeeId != null || r.user_id != null
  )
  const rows = hasIdField ? rowsAll.filter(belongsToActiveEmp) : rowsAll

  // Filter by From/To locally
  const startISO = toIsoDateStart(from)
  const endISO = toIsoDateEnd(to)
  const startMs = startISO ? Date.parse(startISO) : null
  const endMs = endISO ? Date.parse(endISO) : null

  const filteredRows = rows.filter((r: any) => {
    const checkIn  = r.date_in ?? r.in ?? r.check_in ?? r.datetime_in ?? r.date ?? r.ts_in ?? null;
  const checkOut = r.date_out ?? r.out ?? r.check_out ?? r.datetime_out ?? r.ts_out ?? null;
    // Use tzParseLocal instead of Date.parse to interpret timestamps correctly.
    const toMsVal = (v: any): number | null => {
      const d = tzParseLocal(v);
      return d ? d.getTime() : null;
    };
    const ciMs = checkIn  ? toMsVal(checkIn)  : null;
    const coMs = checkOut ? toMsVal(checkOut) : null;
    if (!startMs && !endMs) return true;
    if (ciMs != null) return (!startMs || ciMs >= startMs) && (!endMs || ciMs <= endMs);
    if (coMs != null) return (!startMs || coMs >= startMs) && (!endMs || coMs <= endMs);
    return false;
  });

    
// Build the display rows for the table (compute display strings and correction ids)

// Build the display rows for the table (compute display strings and correction ids)
const logsDisplay = filteredRows.map((r: any) => {
  const checkIn  = r.date_in ?? r.in ?? r.check_in ?? r.datetime_in ?? r.date ?? r.ts_in ?? null;
  const checkOut = r.date_out ?? r.out ?? r.check_out ?? r.datetime_out ?? r.ts_out ?? null;

  const fmt = (iso: any) => tzLocalHM(iso);
  const inDisplay  = fmt(checkIn);
  const outDisplay = fmt(checkOut);

  const hasIn = !!checkIn;
  const hasOut = !!checkOut;
  const mins = hasIn && hasOut ? tzMinutesBetween(checkIn, checkOut) : null;
  const hoursDisplay = (typeof mins === 'number' && isFinite(mins)) ? formatMinutes(mins) : '—';

  const device = r.device ?? r.device_name ?? r.station ?? r.branch ?? r.source ?? null;
  const isManual =
    (typeof device === 'string' && device.toLowerCase().includes('manual')) ||
    !!r.is_manual || !!r.manual;

  // derive correction ids by matching raw items' correction_id (optional)
  const normalize = (v: any) => (v ? new Date(v).toISOString().slice(0, 19) : null);
  const targetIn = normalize(checkIn);
  const targetOut = normalize(checkOut);
  const findCorrId = (ts: string | null) => {
    if (!ts) return null;
    const hit = (Array.isArray(raw) ? raw : []).find((x: any) => {
      const t = x.timestamp ?? x.date ?? x.in ?? x.out ?? x.ts_in ?? x.ts_out ?? x.datetime_in ?? x.datetime_out;
      return t && normalize(t) === ts && (x.correction_id != null);
    });
    return hit?.correction_id ?? null;
  };
  const inCorrId = findCorrId(targetIn);
  const outCorrId = findCorrId(targetOut);

  const canEditIn = hasIn;
const canEditOut = hasOut;

  return {
    ...r,
    inISO: checkIn,
    outISO: checkOut,
    inDisplay,
    outDisplay,
    hoursDisplay,
    device,
    inCorrId,
    outCorrId,
    canEditIn,
    canEditOut,
    hasIn,
    hasOut,
  };
});

// Generate all days in the date range for calendar view
function getAllDaysInRange(fromDate: string, toDate: string): string[] {
  if (!fromDate || !toDate) return [];
  const days: string[] = [];
  const start = new Date(fromDate);
  const end = new Date(toDate);
  const current = new Date(start);

  while (current <= end) {
    days.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return days;
}

// Create calendar view with all days
const allDays = getAllDaysInRange(from, to);
const logsDisplayWithAllDays = allDays.map(dayStr => {
  // Find logs for this specific day
  const logsForDay = logsDisplay.filter((log: any) => {
    const logDate = toYMD(log.inISO ?? log.outISO ?? log.timestamp ?? log.date);
    return logDate === dayStr;
  });

  // If there are logs for this day, return them
  if (logsForDay.length > 0) {
    return logsForDay;
  }

  // Otherwise, create an empty day entry
  return [{
    id: `empty-${dayStr}`,
    inDisplay: '—',
    outDisplay: '—',
    hoursDisplay: '—',
    device: '—',
    hasIn: false,
    hasOut: false,
    isEmpty: true,
    emptyDate: dayStr,
    date_in: null,
    date_out: null,
  }];
}).flat();
// status toggle
  async function setEmployeeStatus(empId: number, next: 'active' | 'left'): Promise<boolean> {
    if (!token) throw new Error('Unauthorized')
    const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`
    const candidates = [{ body: { status: next } }, { body: { is_active: next === 'active' ? 1 : 0 } }]
    for (const path of ['/employees', '/api/employees']) {
      for (const cand of candidates) {
        try {
          const resp = await fetch(`${path}/${empId}/status`, {
            method: 'PUT',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth },
            credentials: 'include',
            body: JSON.stringify(cand.body),
          })
          if (resp.ok) return true
        } catch {}
      }
    }
    return false
  }

  const handleToggleStatus = async () => {
    if (!canEdit) return
    if (inFlightRef.current) return
    inFlightRef.current = true

    const curr: 'active' | 'left' =
      overview?.status === 'active' || overview?.status === 'left'
        ? overview.status
        : (emp as any)?.status === 'active' || (emp as any)?.status === 'left'
        ? ((emp as any).status as 'active' | 'left')
        : (emp as any)?.is_active
        ? 'active'
        : 'left'

    const next: 'active' | 'left' = curr === 'active' ? 'left' : 'active'
    const ok = window.confirm(
      next === 'left'
        ? 'Mark this employee as LEFT? They will be hidden from active rosters.'
        : 'Mark this employee as ACTIVE again?'
    )
    if (!ok) {
      inFlightRef.current = false
      return
    }

    setSaving(true)
    setErr(null)
    try {
      const success = await setEmployeeStatus(Number((emp as any).id), next)
      if (!success) throw new Error('Status update failed')
      setOverview((prev: any) => ({ ...(prev ?? {}), status: next, is_active: next === 'active' ? 1 : 0 }))
      onStatusChange(Number((emp as any).id), next)
    } catch (e: any) {
      setErr(e?.message || 'Failed to update status.')
    } finally {
      setSaving(false)
      inFlightRef.current = false
    }
  }

  // Local helper: try both employee_files and employees routes for salary history.
const fetchSalaryHistory = async (empId: number) => {
  const tk = useAuthStore.getState().token || "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (tk) headers.Authorization = tk.startsWith("Bearer ") ? tk : `Bearer ${tk}`;

  const urls = [
    `/employee_files/${empId}/salary_history`,
    `/api/employee_files/${empId}/salary_history`,
    `/employees/${empId}/salary_history`,
    `/api/employees/${empId}/salary_history`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "GET", headers, credentials: "include" });
      if (r.ok) return await r.json();
    } catch {
      // keep trying fallbacks
    }
  }
  return [];
};


  // Load tab
  useEffect(() => {
    let mounted = true
    setErr(null)
    setLoading(true)

    const run = async () => {
      try {
        if (tab === 'overview') {
          const data = await employeeFileApi.getOverview((emp as any).id)
          if (mounted) setOverview(data)
        } else if (tab === 'logs') {
  const fromISO = toIsoDateStart(from)
  const toISO = toIsoDateEnd(to)
  const data = await fetchLogsLikeLogsPage((emp as any).id, fromISO, toISO);
  setLogs(data);
} else if (tab === 'payroll') {
  try {
    setPay(null); // clear stale October while we fetch

    // ---------- auth ----------
    const tk = useAuthStore.getState().token || '';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (tk) headers.Authorization = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`;

    // ---------- month & date range ----------
    const ym = (month || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
    const [yy, mmNum] = ym.split('-', 2).map(Number);
    const lastDay = new Date(yy, mmNum, 0).getDate(); // FIX: mmNum is 1-based
    const from = `${ym}-01`;
    const to   = `${ym}-${String(lastDay).padStart(2, '0')}`;

    // Build UID for direct payroll fallbacks
    const empUid = (emp as any).uid || (emp as any).code || `EMP${String(emp.id).padStart(3, '0')}`;
    const qsMonth = new URLSearchParams({ employee_id: String((emp as any).id), month: ym }).toString();
    const qsRangeUid = new URLSearchParams({ employee_uid: String(empUid), from, to }).toString();
    const qsRangeId  = new URLSearchParams({ employee_id: String((emp as any).id), from, to }).toString();

    // Prefer the proxy that normalizes upstream → then fall back to raw /payroll
    const candidates = [
      `${API_BASE}/employee_files/payroll?${qsMonth}`,
      `/employee_files/payroll?${qsMonth}`,
      `${API_BASE}/payroll?${qsRangeUid}`,
      `/payroll?${qsRangeUid}`,



      // direct fallbacks
      `${API_BASE}/payroll?${qsRangeUid}`,
      `${API_BASE}/payroll?${qsRangeId}`,
      `${API_BASE}/payroll?employee_uid=${encodeURIComponent(String(empUid))}&month=${encodeURIComponent(ym)}`,
      `${API_BASE}/payroll?employee_id=${encodeURIComponent(String((emp as any).id))}&month=${encodeURIComponent(ym)}`,
      `/payroll?${qsRangeUid}`,
      `/payroll?${qsRangeId}`,
      `/payroll?employee_uid=${encodeURIComponent(String(empUid))}&month=${encodeURIComponent(ym)}`,
      `/payroll?employee_id=${encodeURIComponent(String((emp as any).id))}&month=${encodeURIComponent(ym)}`,
      `${API_BASE}/api/payroll?${qsRangeUid}`,
      `${API_BASE}/api/payroll?${qsRangeId}`,
      `${API_BASE}/api/payroll?employee_uid=${encodeURIComponent(String(empUid))}&month=${encodeURIComponent(ym)}`,
      `${API_BASE}/api/payroll?employee_id=${encodeURIComponent(String((emp as any).id))}&month=${encodeURIComponent(ym)}`,
      `/api/payroll?${qsRangeUid}`,
      `/api/payroll?${qsRangeId}`,
      `/api/payroll?employee_uid=${encodeURIComponent(String(empUid))}&month=${encodeURIComponent(ym)}`,
      `/api/payroll?employee_id=${encodeURIComponent(String((emp as any).id))}&month=${encodeURIComponent(ym)}`,
    ];

    // Only accept a payload if it actually matches the requested month/range
    const matchesMonth = (obj: any) => {
      const monthField =
        String(obj?.month || obj?.for_month || obj?.period || obj?.month_name || '').slice(0, 7);
      const fromField = String(obj?.from || obj?.start || obj?.date_from || '').slice(0, 10);
      const toField   = String(obj?.to   || obj?.end   || obj?.date_to   || '').slice(0, 10);

      if (monthField) return monthField === ym;
      if (fromField && toField) return fromField === from && toField === to;

      if (Array.isArray(obj?.rows)) {
        const days = obj.rows
          .map((r: any) => String(r.date || r.day || '').slice(0, 10))
          .filter(Boolean);
        return days.some((d) => d.startsWith(ym));
      }
      if (obj?.days && typeof obj.days === 'object') {
        return Object.keys(obj.days).some((k) => String(k).startsWith(ym));
      }
      return true;
    };

    let payload: any = null;
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: 'GET', headers, credentials: 'include' });
        if (r.ok) {
          const p = await r.json();
          const rec = Array.isArray(p) ? p[0] : p;
          if (rec && matchesMonth(rec)) { payload = rec; break; }
        }
      } catch {}
    }
    if (!payload) { if (mounted) setPay(null); return; }

    // ---------- your existing normalization (unchanged) ----------
    let meta = payload?.meta || payload?.employee || payload?.employee_meta || {};
const summary = payload?.totals ?? payload?.summary ?? payload;
const totals = {
  hours_total:     Number(summary.hours_total ?? summary.hours ?? summary.total_hours ?? 0),
  food_allowance:  Number(summary.food_allowance_iqd ?? summary.food_allowance ?? 0),
  other_allowance: Number(summary.other_allowance_iqd ?? summary.other_allowance ?? 0),
  deductions:      Number(summary.deductions_iqd ?? summary.deductions ?? 0),
  late_penalty:    Number(summary.late_penalty_iqd ?? summary.late_penalty ?? 0),
  total_pay:       Number(summary.total_pay_iqd ?? summary.total_pay ?? 0),
  advances:        Number(summary.advances_iqd ?? summary.advances ?? 0),
};

// NEW: if nationality/employment_type missing, fetch once from employee/overview
try {
  if (!meta?.nationality || !meta?.employment_type) {
    for (const url of [
      `/employees/${emp.id}`,
      `/api/employees/${emp.id}`,
      `/employee_files/${emp.id}/overview`,
      `/api/employee_files/${emp.id}/overview`,
    ]) {
      try {
        const r = await fetch(url, { headers, credentials: 'include' });
        if (!r.ok) continue;
        const j: any = await r.json();
        const e = j?.employee ?? j; // overview returns { employee, ... }
        meta = { ...e, ...meta };   // do NOT overwrite existing fields
        if (meta?.nationality && meta?.employment_type) break;
      } catch {}
    }
  }
} catch {}

const nationality = String(meta?.nationality || '').toLowerCase();
    
    // If backend returned totals but no per-day hours, try a precise direct fetch to /payroll (single employee)
    const hasNonzeroDays = (obj: any) => {
      const d = (obj?.days && typeof obj.days === 'object') ? obj.days
             : (obj?.days_by_date && typeof obj.days_by_date === 'object') ? obj.days_by_date
             : null;
      if (!d) return false;
      try {
        return Object.values(d).some((v: any) => Number(v) > 0);
      } catch { return false; }
    };

    let ensuredPayload = payload;
    if (!hasNonzeroDays(payload) && totals.hours_total > 0) {
      try {
        const more = [
          `${API_BASE}/payroll?${qsRangeUid}`,
          `${API_BASE}/api/payroll?${qsRangeUid}`,
          `/payroll?${qsRangeUid}`,
          `/api/payroll?${qsRangeUid}`,
        ];
        for (const u of more) {
          try {
            const r = await fetch(u, { headers, credentials: 'include' });
            if (!r.ok) continue;
            const j = await r.json();
            const pick = Array.isArray(j) ? (j.find((x: any) => String(x?.uid || x?.code || '').toUpperCase() === String(empUid).toUpperCase()) || j[0]) : j;
            if (pick && hasNonzeroDays(pick)) { ensuredPayload = pick; break; }
          } catch {}
        }
      } catch {}
    }
// ---------- try to get late penalties (ignore 404) ----------
    let lateMap: Record<string, number> = {};
    try {
      const lateCandidates = [
        `${API_BASE}/payroll/late_events?employee_id=${emp.id}&from=${from}&to=${to}`,
        `${API_BASE}/api/payroll/late_events?employee_id=${emp.id}&from=${from}&to=${to}`,
        `/payroll/late_events?employee_id=${emp.id}&from=${from}&to=${to}`,
        `/api/payroll/late_events?employee_id=${emp.id}&from=${from}&to=${to}`,
      ];
      for (const url of lateCandidates) {
        try {
          const lr = await fetch(url, { headers, credentials: 'include' });
          if (lr.ok) {
            const list = await lr.json();
            lateMap = Object.fromEntries((list || []).map((r: any) => [r.date, Number(r.final_penalty_iqd) || 0]));
            break;
          }
        } catch {}
      }
    } catch {}

    
    // ---------- advances map (sum advances - repayments per day) ----------
    let advMap: Record<string, number> = {};
    let advTotal = 0;
    try {
      const list = await employeeFileApi.getAdvances((emp as any).id, ym);
      if (Array.isArray(list)) {
        for (const a of (list as any[])) {
          const day  = String((a as any).date || '').slice(0, 10);
          if (!day) continue;
          const amt  = Number(((a as any).amount_iqd ?? (a as any).amount ?? 0)) || 0;
          const kind = String(((a as any).kind ?? (a as any).type ?? 'repayment')).toLowerCase();
          const sign = kind === 'advance' ? 1 : -1; // repayments subtract
          advMap[day] = (advMap[day] || 0) + sign * amt;
        }
      }
    } catch {}
    advTotal = Object.values(advMap).reduce((s, v) => s + (Number(v) || 0), 0);
// ---------- build rows (many shapes supported) ----------
    const et = String(meta?.employment_type || '').toLowerCase();
    const foodFor = (h: number) => {
      if (!nationality.includes('iraq')) return 0;
      if (et === 'wages')  return h >= 13 ? 4000 : (h > 0 ? 2000 : 0);
      if (et === 'salary') return h > 0 ? 2000 : 0;
      return 0;
    };

    // 1) direct shapes first
    let rows: Array<{ day: string; hours: number; food: number; other: number; advance?: number; deduct: number; late: number; }> = [];

    if (Array.isArray(ensuredPayload.daily) && ensuredPayload.daily.length) {
      rows = ensuredPayload.daily.map((d: any) => ({ 
       day: String(d.date || d.day || ''),
       hours: Number(d.hours || d.total_hours || 0),
       food: Number(d.food || d.food_allowance || foodFor(Number(d.hours || d.total_hours || 0))),
       other: Number(d.other || d.other_allowance || 0),
       advance: Number(d.advance || d.advances || 0) || (advMap[String(d.date || d.day || '')] || 0),
       deduct: Number(d.deduct || d.deductions || 0),
      late:   Number(d.late || d.late_penalty || (lateMap[String(d.date || d.day || '')] || 0)),
      }));
    } else {
      // 2) maps and scavenged day keys
      let dayMap: Record<string, number> =
  (ensuredPayload.days && typeof ensuredPayload.days === 'object') ? ensuredPayload.days :
  (ensuredPayload.days_by_date && typeof ensuredPayload.days_by_date === 'object') ? ensuredPayload.days_by_date :
  scavengePerDay(ensuredPayload);


      if (!Object.keys(dayMap).length) {
        // 3) try overview payload
        try {
          const ovPaths = [
            `/employee_files/${emp.id}/overview`,
            `/api/employee_files/${emp.id}/overview`,
          ];
          for (const p of ovPaths) {
            try {
              const r = await fetch(p, { headers, credentials: 'include' });
              if (r.ok) {
                const ov = await r.json();
                dayMap = scavengePerDay(ov);
                if (Object.keys(dayMap).length) break;
              }
            } catch {}
          }
        } catch {}
      }

      if (Object.keys(dayMap).length) {
        // compute food based on policy; other starts at 0 unless daily provides it
        const et = String(meta?.employment_type || '').toLowerCase();
        const iraqish =
          /iraq|iraqi|iqd/.test(String(meta?.nationality || meta?.country || meta?.currency || '').toLowerCase());

        const foodFor = (h: number) => {
          const hasIraqPolicy = iraqish || totals.food_allowance > 0; // fallback if totals show food
          if (!hasIraqPolicy) return 0;
          if (et === 'wages')  return h >= 13 ? 4000 : (h > 0 ? 2000 : 0);
          if (et === 'salary') return h > 0 ? 2000 : 0;
          return h > 0 ? 2000 : 0; // last-resort default
        };

        rows = Object.keys(dayMap).sort().map(day => {
          const h = Number((dayMap as any)[day] || 0);
          return { day, hours: h, food: foodFor(h), other: 0, advance: advMap[day] || 0, deduct: 0, late: lateMap[day] || 0 };
        });

        // NEW 1: if hours exist but food is all zeros while month Food total > 0, recompute food
        if (rows.some(r => r.hours > 0) && rows.every(r => (r.food || 0) === 0) && totals.food_allowance > 0) {
          rows = rows.map(r => ({ ...r, food: foodFor(r.hours) }));
        }

        // NEW 2: if month "Other" total > 0 but no per-day values were provided, apportion to worked days
        if (rows.every(r => (r.other || 0) === 0) && totals.other_allowance > 0) {
          const worked = rows.filter(r => r.hours > 0).length || rows.length;
          const per = Math.floor(totals.other_allowance / Math.max(1, worked));
          rows = rows.map(r => ({ ...r, other: r.hours > 0 ? per : 0 }));
        }

        // If totals say we have hours but rows sum to 0, drop into logs fallback (your existing guard)
        const hoursSum = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);
        if (hoursSum === 0 && totals.hours_total > 0) {
          rows = [];
        }
      }
      // 4) last resort: build from logs
      if (!rows.length) {
        try {
          const params = new URLSearchParams({
            page: '1', page_size: '10000', sort: 'asc', employee_id: String(emp.id),
            date_from: `${from}T00:00:00`, date_to: `${to}T23:59:59`,
          });
          const paths = [
            `/employee_files/logs?${params}`,
            `/api/employee_files/logs?${params}`,
            `/logs?${params}`,
            `/api/logs?${params}`,
          ];
          let items: any[] = [];
          for (const p of paths) {
            try {
              const r = await fetch(p, { headers, credentials: 'include' });
              if (r.ok) {
                const j = await r.json();
                items = Array.isArray(j?.items) ? j.items : (Array.isArray(j) ? j : []);
                break;
              }
            } catch {}
          }
          if (items.length) {
            const byDay: Record<string, number> = {};
            for (const ev of items) {
              // prefer explicit hours if present
              let h = 0;
              if (ev && (ev.hours != null || ev.duration_hours != null || ev.work_hours != null)) {
                h = Number(ev.hours ?? ev.duration_hours ?? ev.work_hours) || 0;
              } else {
                const ci = ev.date_in ?? ev.ts_in ?? ev.in ?? ev.check_in ?? ev.datetime_in ?? ev.date ?? null;
                const co = ev.date_out ?? ev.ts_out ?? ev.out ?? ev.check_out ?? ev.datetime_out ?? null;
                if (ci && co) {
                  const a = new Date(ci).getTime();
                  const b = new Date(co).getTime();
                  if (b > a) h = (b - a) / 3600000;
                }
              }
              const day = ev.date ?? ev.day ?? (ev.date_in ? String(ev.date_in).slice(0,10) : (ev.ts_in ? String(ev.ts_in).slice(0,10) : null));
              if (!day) continue;
              byDay[day] = (byDay[day] || 0) + Math.max(0, h);
            }
            rows = Object.keys(byDay).sort().map(day => {
              const h = Number(byDay[day].toFixed(2));
              return { day, hours: h, food: foodFor(h), other: 0, advance: advMap[day] || 0, deduct: 0, late: lateMap[day] || 0 };
            });
          }
        } catch {}
      }
    }

    // ---------- commit (unchanged state shape) ----------
    console.log('Payroll month requested:', ym, 'from:', from, 'to:', to);
    console.log('Payroll rows received:', rows.map(r => r.day));

    if (mounted) {
      setPay({
        rows,
        hours_total: totals.hours_total,
        food_allowance: totals.food_allowance,
        other_allowance: totals.other_allowance,
        deductions: totals.deductions,
        late_penalty: totals.late_penalty,
        advances: (advTotal || totals.advances || 0),
        total_pay: totals.total_pay,
        days: scavengePerDay(ensuredPayload),   // keep whatever we found
        meta,
      } as any);
    }
  } catch (err) {
    console.error('Failed to load payroll:', err);
    if (mounted) setPay(null);
  }
}
 else if (tab === 'deductions') {
          const efRaw: any = await employeeFileApi.getDeductions((emp as any).id, month)
          const efList: any[] = Array.isArray(efRaw) ? efRaw : efRaw?.items ?? efRaw?.data ?? []
          let normalized = (efList as any[]).map((r: any) => {
            const createdBy =
              r.created_by_name ??
              r.created_by ??
              r.user_name ??
              r.user ??
              (r.created_by_user && (r.created_by_user.name || r.created_by_user.username)) ??
              (r.createdBy && (r.createdBy.name || r.createdBy.username)) ??
              null
            const date =
              r.date ??
              r.day ??
              r.for_date ??
              r.for_day ??
              r.for_month ??
              r.month ??
              (typeof r.created_at === 'string' ? r.created_at.slice(0, 10) : null)
            return {
              id: r.id ?? r.deduction_id ?? `${date ?? ''}-${Math.random()}`,
              date,
              amount: Number(r.amount_iqd ?? r.amount ?? r.value ?? 0) || 0,
              reason: r.reason ?? r.note ?? r.description ?? null,
              created_at: r.created_at ?? r.createdAt ?? r.inserted_at ?? r.timestamp ?? r.ts ?? null,
              created_by: createdBy,
            }
          })
          const allZero = normalized.length > 0 && normalized.every((x: any) => !x.amount)
          if (normalized.length === 0 || allZero) {
            const payroll: any = await employeeFileApi.getPayroll((emp as any).id, month)
            const rows: any[] = payroll?.rows ?? []
            normalized = rows
              .filter((r: any) => Number(r.deductions) > 0)
              .map((r: any, i: number) => ({
                id: r.id ?? `${r.day}-${i}`,
                date: r.day ?? null,
                amount: Number(r.deductions) || 0,
                reason: r.reason ?? r.note ?? null,
                created_at: null,
                created_by: null,
              }))
          }
          if (mounted) setDeds(normalized as any)   
           } else if (tab === 'advances') {
            if (role === 'admin' || role === 'accountant') {
              const data = await employeeFileApi.getAdvances((emp as any).id, month);
              if (mounted) setAdvs(data);
            } else {
              if (mounted) setAdvs([]);
            }
          } else if (tab === 'salary') {
            const data = await fetchSalaryHistory((emp as any).id);
            if (mounted) setHistory(data);
          }

      } catch (e: any) {
        if (mounted) setErr(e?.message || 'Failed to load data.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    run()
    return () => {
      mounted = false
    }
  }, [tab, (emp as any).id, dedLoadNonce, advLoadNonce, payrollLoadNonce])

  // Logs loader (prefer merged view so manual IN/OUT appear)
async function fetchLogsLikeLogsPage(
  empId: number,
  fromISO?: string,
  toISO?: string
): Promise<any[]> {
  if (!token) throw new Error('Unauthorized');
  const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  const params = new URLSearchParams({
    page: '1',
    page_size: '1000',
    sort: 'desc',
    employee_id: String(empId),
  });
  if (fromISO) params.set('date_from', fromISO);
  if (toISO) params.set('date_to', toISO);

  // Prefer the merged endpoint; only fall back to raw if needed.
  const paths = [
    '/employee_files/logs',
    '/api/employee_files/logs',
    '/logs',
    '/api/logs',
  ];

  for (const path of paths) {
    try {
      const resp = await fetch(`${path}?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: auth },
        credentials: 'include',
      });
      if (resp.ok) {
        const data = await resp.json();
        return Array.isArray(data) ? data : data?.items ?? [];
      }
    } catch {}
  }
  return [];
}


const reloadLogs = async () => {
  setErr(null);
  setLoading(true);
  try {
    const fromISO = toIsoDateStart(from);
    const toISO = toIsoDateEnd(to);
    const data = await fetchLogsLikeLogsPage((emp as any).id, fromISO, toISO);
    setLogs(data);
  } catch (e: any) {
    setErr(e?.message || 'Failed to load data.');
  } finally {
    setLoading(false);
  }
};


const exportLogs = () => {
  const fromISO = toIsoDateStart(from);
  const toISO = toIsoDateEnd(to);
  const { url } = employeeFileApi.exportLogsXlsxUrl((emp as any).id, fromISO, toISO);
  window.open(url, '_blank');
};


  const currentStatus: 'active' | 'left' = (() => {
    const s1 = overview?.status
    if (s1 === 'active' || s1 === 'left') return s1
    const s2 = (emp as any)?.status
    if (s2 === 'active' || s2 === 'left') return s2
    return (emp as any)?.is_active ? 'active' : 'left'
  })()

  // ==== UI ====
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Overlay must be *below* the modal panel */}
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />

        <div className="relative z-50 w-full max-w-6xl bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg">
                  <AttendanceIcon size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{(emp as any).name}</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Code: {(emp as any).code || '—'}
                    {(emp as any).branch && ` • ${(emp as any).branch}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${
                    currentStatus === 'active'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {currentStatus === 'active' ? 'Active' : 'Left'}
                </span>

                {canEdit && (
                  <button
                    onClick={handleToggleStatus}
                    disabled={saving}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      currentStatus === 'active'
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    } ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {saving ? 'Saving...' : currentStatus === 'active' ? 'Mark as Left' : 'Mark Active'}
                  </button>
                )}

                {/* Admin-only hard delete */}
                {String(role || '').toLowerCase() === 'admin' && (
                  <button
                    type="button"
                    onClick={async () => {
                    const employeeId =
                      Number(
                        (overview as any)?.employee?.id ??
                          (overview as any)?.id ??
                          (emp as any)?.id ??
                          NaN
                      ) || undefined

                    if (!employeeId) {
                      alert('Missing employee id.')
                      return
                    }

                    const ok = window.confirm(
                      `PERMANENT DELETE

This will permanently remove the employee and all related data (logs, payroll, history).
This cannot be undone. Continue?`
                    )
                    if (!ok) return

                    const done = await deleteEmployeeById(employeeId, true)
                    if (done) {
                      onMetaChange(employeeId, { removed: true })
                      onClose()
                    } else {
                      alert('Delete failed. Server did not accept the request.')
                    }
                  }}
                       className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                    >
                      Delete Permanently
                    </button>
                  )}

                <button
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs */}
           <div className="flex gap-1 mt-4 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as TabKey)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
                  tab === t.key
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
            {/* Error */}
            {err && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-red-800 dark:text-red-200">{err}</span>
                </div>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                <span className="ml-3 text-slate-600 dark:text-slate-400">Loading...</span>
              </div>
            )}

            {/* Content */}
            {!loading && (
              <>
                {tab === 'overview' && (
                  <>
                    {/* Profile */}
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <span>👤</span> Profile Information
                      </h3>

                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Name:</span>
                          <span className="font-medium text-slate-900 dark:text-white">{(overview as any)?.employee?.name ?? (emp as any).name}</span>
                        </div>

                        {/* Branch (editable) */}
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400">Branch:</span>
                          {!editing ? (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {overview?.branch ?? (emp as any).branch ?? '—'}
                            </span>
                          ) : (
                            <select
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                              value={editVals.branch}
                              onChange={(e) => setEditVals({ ...editVals, branch: e.target.value })}
                            >
                              {branchOptions.map((b) => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Phone:</span>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {(overview as any)?.employee?.phone ?? (emp as any)?.phone ?? '—'}
                          </span>
                        </div>

                        {/* Code (editable) */}
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400">Code:</span>
                          {!editing ? (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {(overview as any)?.employee?.code ?? (emp as any)?.code ?? '—'}
                            </span>
                          ) : (
                            <input
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                              value={editVals.code}
                              onChange={(e) =>
                                setEditVals((prev: any) => ({
                                  ...(prev ?? {}),
                                  code: String(e.target.value || '').trim(),
                                }))
                              }
                              placeholder="e.g., EMP001"
                            />
                          )}
                        </div>

                        {/* UID (editable) */}
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400">UID:</span>
                          {!editing ? (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {(overview as any)?.employee?.uid ?? (emp as any)?.uid ?? '—'}
                            </span>
                          ) : (
                            <input
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                              value={editVals.uid}
                              onChange={(e) =>
                                setEditVals((prev: any) => ({
                                  ...(prev ?? {}),
                                  uid: String(e.target.value || '').toUpperCase(),   // keep uppercase
                                }))
                              }
                              placeholder="e.g., ABC123"
                            />
                          )}
                        </div>
                        {/* Position (stored in department) */}
                          <div className="flex justify-between items-center gap-3">
                            <span className="text-slate-600 dark:text-slate-400">Position:</span>
                            {!editing ? (
                              <span className="font-medium text-slate-900 dark:text-white">
                                {overview?.department ?? (emp as any).department ?? '—'}
                              </span>
                            ) : (
                              <input
                                className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                                value={editVals.department}
                                onChange={(e) => setEditVals({ ...editVals, department: e.target.value })}
                                placeholder="e.g., Cashier"
                              />
                            )}
                          </div>
                        {/* Brand (restaurant) */}
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400">Brand:</span>
                          {!editing ? (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {overview?.brand ?? (emp as any).brand ?? '—'}
                            </span>
                          ) : (
                            <select
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                              value={editVals.brand}
                              onChange={(e) => setEditVals({ ...editVals, brand: e.target.value })}
                            >
                              <option value="">—</option>
                              <option value="Awtar">Awtar</option>
                              <option value="360">360</option>
                              <option value="AA Chicken">AA Chicken</option>
                            </select>
                          )}
                        </div>
                    {/* Nationality */}
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Nationality:</span>
                      <span className="font-medium text-slate-900 dark:text-white">
                        {(overview as any)?.employee?.nationality ?? (emp as any)?.nationality ?? '—'}
                      </span>
                    </div>
                        {/* Employment type (editable) */}
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400">Employment Type:</span>
                          {!editing ? (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {overview?.employment_type ?? (emp as any).employment_type ?? '—'}
                            </span>
                          ) : (
                            <select
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                              value={editVals.employment_type}
                              onChange={(e) => setEditVals({ ...editVals, employment_type: e.target.value })}
                            >
                              <option value="wages">wages</option>
                              <option value="salary">salary</option>
                            </select>
                          )}
                        </div>

                        {/* Hourly */}
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400">Hourly Rate:</span>
                          {!editing ? (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {overview?.hourly_rate ?? (emp as any).hourly_rate ?? '—'}
                            </span>
                          ) : (
                            <input
                              type="number"
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                              value={editVals.hourly_rate}
                              onChange={(e) => setEditVals({ ...editVals, hourly_rate: e.target.value })}
                              disabled={String(editVals.employment_type) === 'salary'}
                            />
                          )}
                        </div>

                        {/* Salary */}
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400">Salary (IQD):</span>
                          {!editing ? (
                            <span className="font-medium text-slate-900 dark:text-white">
                              {overview?.salary_iqd ?? (emp as any).salary_iqd ?? '—'}
                            </span>
                          ) : (
                            <input
                              type="number"
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm w-48"
                              value={editVals.salary_iqd}
                              onChange={(e) => setEditVals({ ...editVals, salary_iqd: e.target.value })}
                              disabled={String(editVals.employment_type) === 'wages'}
                            />
                          )}
                        </div>

                        {/* Joined At */}
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Joined At:</span>
                          <span className="font-medium text-slate-900 dark:text-white">{(overview as any)?.employee?.join_date ?? (emp as any)?.join_date ?? (emp as any)?.joined_at ?? '—'}</span>
                        </div>

                        {/* Status pill */}
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-600 dark:text-slate-400">Status:</span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${
                                currentStatus === 'active'
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {currentStatus === 'active' ? 'Active' : 'Left'}
                            </span>
                          </div>
                        </div>

                        {/* Edit / Save */}
                        {canEdit && (
                          <div className="pt-3 flex justify-end gap-2">
                            {!editing ? (
                              <button
                                onClick={() => setEditing(true)}
                                className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                              >
                                Edit
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => setEditing(false)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={async () => {
                                    const curr: any =
                                      (overview && (overview as any).employee)
                                        ? (overview as any).employee
                                        : (emp as any)

                                    const base = {
                                      name: curr.name ?? '',
                                      department: String(editVals.department || curr.department || ''), // NEW
                                      branch: String(editVals.branch || curr.branch || ''),
                                      brand: String(editVals.brand || curr.brand || ''),               // NEW
                                      uid: String((editVals.uid || curr.uid || '')).toUpperCase(),
                                      code: String(editVals.code || curr.code || '').trim(),
                                      employment_type: String(editVals.employment_type || curr.employment_type || 'wages'),
                                      hourly_rate: String(editVals.employment_type || curr.employment_type) === 'wages'
                                        ? Number((editVals.hourly_rate ?? curr.hourly_rate) || 0)
                                        : undefined,
                                      salary_iqd: String(editVals.employment_type || curr.employment_type) === 'salary'
                                        ? Number((editVals.salary_iqd ?? curr.salary_iqd) || 0)
                                        : undefined,
                                      phone: curr.phone ?? undefined,
                                      join_date: curr.join_date ?? curr.joined_at ?? curr.joinedAt ?? undefined,
                                    }
                                    const body = sanitizeEmployeePayload(base)
                                    const ok = await updateEmployeeWithFallback(
                                      Number(curr.id ?? (emp as any).id),
                                      body
                                    )
                                    if (ok) {
                                      setOverview((prev: any) => ({ ...(prev ?? {}), employee: { ...(curr || {}), ...body } }))
                                      onMetaChange(Number(curr.id ?? (emp as any).id), body)
                                      setEditing(false)
                                    } else {
                                      alert('Failed to save changes.')
                                    }
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                >
                                  Save
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Period Stats */}
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6 hidden">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <span>📊</span> This Period Stats
                      </h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Total Hours:</span>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {overview?.stats?.month_hours ?? '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Late Arrivals:</span>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {overview?.stats?.late_count ?? '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Last Seen:</span>
                          <span className="font-medium text-slate-900 dark:text-white text-sm">
                            {overview?.stats?.last_seen ?? '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Logs */}
                {tab === 'logs' && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap gap-4 items-end">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">From</label>
                        <input
                          type="date"
                          min="2000-01-01"
                          max="2100-12-31"
                          className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          value={from}
                          onChange={(e) => setFrom(e.target.value)}
                          onBlur={(e) => {
                            const v = e.currentTarget.value
                            if (v && (v < '2000-01-01' || v > '2100-12-31')) setFrom('')
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">To</label>
                        <input
                          type="date"
                          min="2000-01-01"
                          max="2100-12-31"
                          className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          value={to}
                          onChange={(e) => setTo(e.target.value)}
                          onBlur={(e) => {
                            const v = e.currentTarget.value
                            if (v && (v < '2000-01-01' || v > '2100-12-31')) setTo('')
                          }}
                        />
                      </div>
                      <button
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={reloadLogs}
                        disabled={!isValidDateInput(from) || !isValidDateInput(to)}
                      >
                        Apply
                      </button>
                      <button
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                        onClick={exportLogs}
                      >
                        Export XLSX
                      </button>
                    </div>

                    <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Date
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Check-In
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Check-Out
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Device
                              </th>
                              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Hours
                              </th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
                            {logsDisplayWithAllDays.map((r: any) => {
                              const displayDate = r.isEmpty ? r.emptyDate : (toYMD(r.inISO ?? r.outISO) ?? '—');

                              return (
                                <tr
                                  key={r.id ?? `${r.inDisplay}-${r.outDisplay}-${r.device ?? ''}`}
                                  className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 ${r.isEmpty ? 'bg-slate-50/50 dark:bg-slate-800/30' : ''}`}
                                >
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">
                                    {displayDate}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                                    {r.inDisplay}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                                    {r.outDisplay}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                                    {r.device ?? r.branch ?? '—'}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-slate-900 dark:text-white">
                                    {r.hoursDisplay}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                    <button
                                      className={`px-3 py-1 rounded text-white text-sm ${r.isEmpty ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                      onClick={() => { openEditDay(r); }}
                                    >
                                      {r.isEmpty ? 'Add Attendance' : 'Edit Day'}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                            {logsDisplayWithAllDays.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                                  No logs found for the selected period
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* ---- Edit Day Modal (IN & OUT) ---- */}
                    {showEditDay && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                        <div className="w-full max-w-md rounded-xl bg-neutral-900 text-white shadow-xl p-5">
                          <div className="text-lg font-semibold mb-4">Edit Day</div>

                          <label className="block text-sm mb-1">Check-in</label>
                          <input
                            type="datetime-local"
                            className="w-full mb-3 rounded bg-neutral-800 px-3 py-2 outline-none border border-neutral-700"
                            value={dayInTime}
                            onChange={(e) => setDayInTime(e.target.value)}
                          />

                          <label className="block text-sm mb-1">Check-out</label>
                          <input
                            type="datetime-local"
                            className="w-full mb-3 rounded bg-neutral-800 px-3 py-2 outline-none border border-neutral-700"
                            value={dayOutTime}
                            onChange={(e) => setDayOutTime(e.target.value)}
                          />

                          <label className="block text-sm mb-1">Reason</label>
                          <input
                            type="text"
                            className="w-full mb-4 rounded bg-neutral-800 px-3 py-2 outline-none border border-neutral-700"
                            value={dayReason}
                            onChange={(e) => setDayReason(e.target.value)}
                            placeholder="Adjust day"
                          />

                          <div className="flex justify-end gap-2">
                            <button
                              className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600"
                              onClick={() => setShowEditDay(false)}
                            >
                              Cancel
                            </button>
                            <button
                              className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700"
                              onClick={async () => {
                                try {
                                  await submitEditDay();
                                } catch (e) {
                                  console.error(e);
                                  alert((e as any)?.message || 'Failed to save day edits');
                                }
                              }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                )}

                {/* Payroll */}
                {tab === 'payroll' && (
                  <PayrollTab
                    emp={emp}
                    month={month}
                    setMonth={setMonth}
                    pay={pay}
                    payrollLoadNonce={payrollLoadNonce}
                    setPayrollLoadNonce={setPayrollLoadNonce}
                  />
                )}

                {/* Deductions */}
                {tab === 'deductions' && (
                  <DeductionsTab
                    emp={emp}
                    month={month}
                    setMonth={setMonth}
                    canEdit={canEdit}
                    deds={deds}
                    dedLoadNonce={dedLoadNonce}
                    setDedLoadNonce={setDedLoadNonce}
                  />
                )}

                {/* Advances */}
                {tab === 'advances' && (
                  <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
                      {/* Header/controls */}
                      <div className="p-4 border-b border-slate-200 dark:border-slate-600 flex items-center gap-4">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mr-auto">Advances</h3>

                        <input
                          type="month"
                          value={month}
                          onChange={(e) => setMonth(e.target.value)}
                          className={`${field} w-48`}
                        />
                        <button
                          className="px-3 py-2 rounded-md bg-blue-600 text-white"
                          onClick={() => setAdvLoadNonce((n) => n + 1)}
                        >
                          Reload
                        </button>
                      </div>
                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Type</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Amount (IQD)</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Note</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Created By</th>
                              {canEditAdv && <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-600">

                            {/* Add row */}
                            {canEditAdv && (
                              <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                                <td className="px-6 py-3">
                                  <input
                                    type="date"
                                    className={`${field} w-40 dark:[color-scheme:dark]`}
                                    value={addAdvDate}
                                    onChange={(e) => setAddAdvDate(e.target.value)}
                                  />
                                </td>
                                <td className="px-6 py-3">
                                  <select
                                    className={`${field} pr-8 appearance-none dark:[color-scheme:dark]`}
                                    value={addAdvKind}
                                    onChange={(e) => setAddAdvKind(e.target.value as any)}
                                  >
                                    <option value="advance">Advance</option>
                                    <option value="repayment">Repayment</option>
                                  </select>
                                </td>
                                <td className="px-6 py-3 text-right">
                                  <input
                                    type="number"
                                    className={`${field} w-32 text-right font-mono`}
                                    value={addAdvAmount}
                                    onChange={(e) => setAddAdvAmount(e.target.value)}
                                  />
                                </td>
                                <td className="px-6 py-3">
                                  <input
                                    className={`${field} w-full`}
                                    value={addAdvReason}
                                    onChange={(e) => setAddAdvReason(e.target.value)}
                                    placeholder="optional note"
                                  />
                                </td>
                                <td className="px-6 py-3 text-right text-slate-400">—</td>
                                <td className="px-6 py-3 text-right">
                                  <button
                                    className="px-3 py-1 rounded-lg bg-green-600 text-white"
                                    onClick={async () => {
                                      try {
                                        await employeeFileApi.createEmpAdvance((emp as any).id, {
                                          date: addAdvDate,
                                          kind: addAdvKind,
                                          amount: Number(addAdvAmount || 0),
                                          note: addAdvReason || '',
                                        });
                                        setAddAdvAmount('0'); setAddAdvReason('');
                                        setAdvLoadNonce(n => n + 1);
                                      } catch (e: any) {
                                        alert(e?.message || 'Failed to save');
                                      }
                                    }}
                                  >
                                    Save
                                  </button>
                                </td>
                              </tr>
                            )}
                            {/* Existing rows */}
                            {(advs ?? []).map((r: any) => {
                              const editing = editingAdvId === r.id;
                              return (
                                <tr key={r.id ?? r.date}>
                                  <td className="px-6 py-3">
                                    {editing ? (
                                      <input
                                        type="date"
                                        className={`${field} w-40 dark:[color-scheme:dark]`}
                                        value={editAdvDate}
                                        onChange={(e) => setEditAdvDate(e.target.value)}
                                      />
                                    ) : <span className="font-mono">{r.date ?? '—'}</span>}
                                  </td>
                                  <td className="px-6 py-3 capitalize">
                                    {editing ? (
                                      <select
                                        className={`${field} pr-8 appearance-none dark:[color-scheme:dark]`}
                                        value={editAdvKind}
                                        onChange={(e) => setEditAdvKind(e.target.value as any)}
                                      >
                                        <option value="advance">Advance</option>
                                        <option value="repayment">Repayment</option>
                                      </select>
                                    ) : (r.kind || '—')}
                                  </td>
                                  <td className="px-6 py-3 text-right font-mono tabular-nums">
                                    {editing ? (
                                      <input
                                        type="number"
                                        className={`${field} w-32 text-right font-mono`}
                                        value={editAdvAmount}
                                        onChange={(e) => setEditAdvAmount(e.target.value)}
                                      />
                                    ) : (Number(r.amount ?? r.amount_iqd ?? 0).toLocaleString())}
                                  </td>
                                  <td className="px-6 py-3">
                                    {editing ? (
                                      <input
                                        className={`${field} w-full`}
                                        value={editAdvReason}
                                        onChange={(e) => setEditAdvReason(e.target.value)}
                                      />
                                    ) : (r.note || '')}
                                  </td>
                                  <td className="px-6 py-3 text-right">{r.created_by ?? r.created_by_name ?? ''}</td>

                                  {canEditAdv && (
                                    <td className="px-6 py-3 text-right space-x-2">
                                      {editing ? (
                                        <>
                                          <button
                                            className="px-3 py-1 rounded-lg bg-green-600 text-white"
                                            onClick={async () => {
                                              try {
                                                await employeeFileApi.updateEmpAdvance((emp as any).id, r.id, {
                                                  date: editAdvDate || r.date,
                                                  kind: editAdvKind || r.kind,
                                                  amount: Number(editAdvAmount || r.amount || 0),
                                                  note: editAdvReason ?? r.note ?? '',
                                                });
                                                setEditingAdvId(null);
                                                setAdvLoadNonce(n => n + 1);
                                              } catch (e: any) {
                                                alert(e?.message || 'Failed to update');
                                              }
                                            }}
                                          >Save</button>
                                          <button
                                            className="px-3 py-1 rounded-lg bg-slate-200 dark:bg-slate-600"
                                            onClick={() => setEditingAdvId(null)}
                                          >Cancel</button>
                                        </>
                                      ) : (
                                        <>
                                          {/* Quick repayment helper */}
                                          <button
                                            className="px-3 py-1 rounded-lg bg-amber-600 text-white"
                                            title="Record a repayment (deduct from this month's salary)"
                                            onClick={async () => {
                                              const amt = prompt('Repayment amount (IQD)?', String(r.amount || 0));
                                              if (!amt) return;
                                              try {
                                                await employeeFileApi.createEmpAdvance((emp as any).id, {
                                                  date: new Date().toISOString().slice(0,10),
                                                  kind: 'repayment',
                                                  amount: Number(amt),
                                                  note: `repay against advance#${r.id}`,
                                                });
                                                setAdvLoadNonce(n => n + 1);
                                              } catch (e: any) {
                                                alert(e?.message || 'Failed to record repayment');
                                              }
                                            }}
                                          >Repay</button>

                                          <button
                                            className="px-3 py-1 rounded-lg bg-slate-200 dark:bg-slate-600"
                                            onClick={() => {
                                              setEditingAdvId(r.id);
                                              setEditAdvDate(r.date);
                                              setEditAdvKind(r.kind || 'repayment');
                                              setEditAdvAmount(String(r.amount || 0));
                                              setEditAdvReason(r.note || '');
                                            }}
                                          >Edit</button>

                                          <button
                                            className="px-3 py-1 rounded-lg bg-red-600 text-white"
                                            onClick={async () => {
                                              const reason = prompt('Reason for delete?') || '';
                                              try {
                                                await employeeFileApi.deleteEmpAdvance((emp as any).id, r.id, reason);
                                                setAdvLoadNonce(n => n + 1);
                                              } catch (e: any) {
                                                alert(e?.message || 'Failed to delete');
                                              }
                                            }}
                                          >Delete</button>
                                        </>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}

                            {(!advs || advs.length === 0) && (
                              <tr>
                                <td colSpan={canEditAdv ? 6 : 5} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                                  No advances for selected month
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
                {/* Late Overrides */}
                  {tab === 'overrides' && (
                    <div className="space-y-6">
                      <div className="p-4">
                        {/* Reuse the shared month picker */}
                        <input
                          type="month"
                          value={month}
                          onChange={(e) => setMonth(e.target.value)}
                          className={`${field} w-48`}
                        />
                      </div>

                      <div className="p-4">
                        <React.Suspense fallback={<div className="p-6">Loading…</div>}>
                          <LateOverridesTab
                            empId={Number((emp as any).id)}
                            uid={String((emp as any).uid || (emp as any).code || '')}
                            month={month}
                          />
                        </React.Suspense>
                      </div>
                    </div>
                  )}
                {/* Salary History */}
                {tab === 'salary' && (
                  <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
                      <div className="p-4 border-b border-slate-200 dark:border-slate-600">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Salary Change History
                        </h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Effective From
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Type
                              </th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Hourly / Salary
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
                            {(history ?? []).map((h: any, i: number) => (
                              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                <td className="px-6 py-3 text-sm text-slate-900 dark:text-white">
                                  {h.effective_from ?? h.date ?? '—'}
                                </td>
                                <td className="px-6 py-3 text-sm text-slate-900 dark:text-white">
                                  {h.type ?? h.employment_type ?? '—'}
                                </td>
                                <td className="px-6 py-3 text-sm text-slate-900 dark:text-white text-right">
                                  {h.type === 'salary' || h.employment_type === 'salary'
                                    ? (h.salary_iqd ?? h.salary ?? '—')
                                    : (h.hourly_rate ?? h.rate ?? '—')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


/* =========================
   CreateEmpModal  (FULL REPLACEMENT)
   ========================= */
 export function CreateEmpModal_Old({
  onClose,
  onCreated,
  onCreate,
  branchOptions,
}: {
  onClose: () => void
  onCreated: (created: any) => void
  onCreate: (payload: any) => Promise<any>
  branchOptions: string[]
}) {
  const token = useAuthStore((s) => s.token)
  const [saving, setSaving] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [importResults, setImportResults] = React.useState<{
    success: number
    failed: number
    errors: string[]
  } | null>(null)

  // include brand + department, keep other fields unchanged
  const [vals, setVals] = React.useState<any>({
    name: '',
    branch: branchOptions[0] || '',   // Location
    brand: '',                        // NEW
    department: '',                   // NEW (Position)
    code: '',
    uid: '',
    employment_type: 'wages',
    hourly_rate: '',
    salary_iqd: '',
    phone: '',
    joined_at: '',
  })

  // keep original requirements, plus code + joined_at + phone required
  const canSave =
    !!String(vals.name || '').trim() &&
    !!String(vals.code || '').trim() &&
    !!String(vals.joined_at || '').trim() &&
    !!String(vals.branch || '').trim() &&
    !!String(vals.phone || '').trim() &&
    String(vals.phone || '').replace(/\D/g, '').length >= 10 &&
    (
      (vals.employment_type === 'wages'  && String(vals.hourly_rate || '').length > 0) ||
      (vals.employment_type === 'salary' && String(vals.salary_iqd  || '').length > 0)
    )

  // Handle Excel import
  const handleExcelImport = async (file: File) => {
    try {
      setImporting(true)
      setErr(null)
      setImportResults(null)

      // Create FormData to send file to backend
      const formData = new FormData()
      formData.append('file', file)
      formData.append('defaultBranch', branchOptions[0] || 'Main Branch')

      // Send to backend for processing
      const response = await fetch(`${API_BASE}/exports/employees/import-excel`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': token?.startsWith('Bearer ') ? token : `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Import processing failed')
      }

      // Import employees one by one using the existing onCreate function
      let success = 0
      let failed = 0
      const errors: string[] = []

      for (const emp of result.employees) {
        try {
          await onCreate(emp)
          success++
        } catch (error: any) {
          failed++
          errors.push(`${emp.name || emp.code || 'Unknown'}: ${error.message}`)
        }
      }

      setImportResults({ success, failed, errors })
      
      if (success > 0) {
        onCreated({ bulk: true, count: success })
      }

    } catch (error: any) {
      setErr(`Import failed: ${error.message}`)
    } finally {
      setImporting(false)
    }
  }



  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 max-w-2xl mx-auto mt-24 bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Create Employee File</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {err && (
          <div className="px-6 py-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-b border-red-200 dark:border-red-800">
            {err}
          </div>
        )}

        {importResults && (
          <div className="px-6 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border-b border-blue-200 dark:border-blue-800">
            <div className="font-medium">Import Results:</div>
            <div>✅ Successfully imported: {importResults.success} employees</div>
            {importResults.failed > 0 && (
              <div>
                ❌ Failed to import: {importResults.failed} employees
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm">View errors</summary>
                  <ul className="mt-1 text-xs">
                    {importResults.errors.map((error, i) => (
                      <li key={i}>• {error}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </div>
        )}

        {/* Import Section */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-600">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div>
                <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                  📊 Bulk Import Employees
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Import multiple employees from Excel file (.xlsx, .xls)
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  id="excel-import"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      handleExcelImport(file)
                    }
                    // Reset input so same file can be selected again
                    e.target.value = ''
                  }}
                />
                <label
                  htmlFor="excel-import"
                  className={`px-4 py-2 rounded-lg border-2 border-dashed transition-all duration-200 text-sm font-medium flex items-center gap-2 ${
                    importing 
                      ? 'border-slate-300 dark:border-slate-600 text-slate-400 cursor-not-allowed' 
                      : 'border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 cursor-pointer'
                  }`}
                >
                  {importing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      📁 Choose Excel File
                    </>
                  )}
                </label>
              </div>
            </div>
            
            {/* Expected Format Info */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <h5 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">Expected Excel Format:</h5>
              <div className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
                <div><strong>Required columns:</strong> EMP Code, EMP Name</div>
                <div><strong>Optional columns:</strong> UID, Mobile Number, Department/Position, Date of Join, Current Hourly Wage</div>
                <div><strong>Employment Type:</strong> "Fixd" for fixed salary, numeric value for hourly wages</div>
                <div><strong>Note:</strong> Missing salary amounts can be added later by HR</div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-sm mb-1">Name *</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.name}
                onChange={(e) => setVals({ ...vals, name: e.target.value })}
              />
            </div>

            {/* Location (Branch) */}
            <div>
              <label className="block text-sm mb-1">Location *</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.branch}
                onChange={(e) => setVals({ ...vals, branch: e.target.value })}
              >
                {branchOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Brand (awtar / 360 / aa chicken) */}
            <div>
              <label className="block text-sm mb-1">Brand</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.brand}
                onChange={(e) => setVals({ ...vals, brand: e.target.value })}
              >
                <option value="">—</option>
                <option value="awtar">Awtar</option>
                <option value="360">360</option>
                <option value="aa chicken">AA Chicken</option>
              </select>
            </div>

            {/* Position */}
            <div>
              <label className="block text-sm mb-1">Position</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.department}
                onChange={(e) => setVals({ ...vals, department: e.target.value })}
                placeholder="e.g. Cashier"
              />
            </div>

            {/* Code (required) */}
            <div>
              <label className="block text-sm mb-1">Code *</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.code}
                onChange={(e) => setVals({ ...vals, code: e.target.value })}
              />
            </div>

            {/* UID (optional) */}
            <div>
              <label className="block text-sm mb-1">UID (optional)</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.uid}
                onChange={(e) => setVals({ ...vals, uid: e.target.value })}
              />
            </div>

            {/* Employment Type */}
            <div>
              <label className="block text-sm mb-1">Employment Type *</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.employment_type}
                onChange={(e) => setVals({ ...vals, employment_type: e.target.value as 'wages' | 'salary' })}
              >
                <option value="wages">wages</option>
                <option value="salary">salary</option>
              </select>
            </div>

            {/* Hourly or Salary (conditional) */}
            {vals.employment_type === 'wages' ? (
              <div>
                <label className="block text-sm mb-1">Hourly Rate *</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                  value={vals.hourly_rate}
                  onChange={(e) => setVals({ ...vals, hourly_rate: e.target.value })}
                  placeholder="e.g. 3000"
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm mb-1">Salary (IQD) *</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                  value={vals.salary_iqd}
                  onChange={(e) => setVals({ ...vals, salary_iqd: e.target.value })}
                  placeholder="e.g. 800000"
                />
              </div>
            )}

            {/* Phone */}
            <div>
              <label className="block text-sm mb-1">Phone *</label>
              <input
                className={`w-full px-3 py-2 rounded-lg border ${
                  vals.phone && String(vals.phone).replace(/\D/g, '').length < 10 
                    ? 'border-red-500 dark:border-red-400' 
                    : 'border-slate-300 dark:border-slate-600'
                } bg-white dark:bg-slate-700`}
                value={vals.phone}
                onChange={(e) => setVals({ ...vals, phone: e.target.value })}
                placeholder="Minimum 10 digits required"
              />
              {vals.phone && String(vals.phone).replace(/\D/g, '').length < 10 && (
                <p className="text-xs text-red-500 mt-1">Phone number must be at least 10 digits</p>
              )}
            </div>

            {/* Joined At */}
            <div>
              <label className="block text-sm mb-1">Joined At *</label>
              <input
                type="date"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.joined_at}
                onChange={(e) => setVals({ ...vals, joined_at: e.target.value })}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="px-0 pb-2 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              disabled={!canSave || saving}
              onClick={async () => {
                try {
                  setErr(null)
                  setSaving(true)

                  // Build payload; backend already accepts brand/department/branch
                  const payload: any = {
                    name: vals.name.trim(),
                    branch: vals.branch.trim(),                 // Location
                    brand: vals.brand.trim() || undefined,      // NEW
                    department: vals.department.trim() || undefined, // FIXED
                    code: vals.code.trim(),
                    uid: vals.uid.trim() || undefined,
                    employment_type: vals.employment_type,
                    phone: vals.phone || undefined,
                    joined_at: vals.joined_at || undefined,
                    status: 'active',
                  }
                  if (vals.employment_type === 'wages') payload.hourly_rate = Number(vals.hourly_rate || 0)
                  else payload.salary_iqd = Number(vals.salary_iqd || 0)

                  const created = await onCreate(payload)
                  if (!created) throw new Error('Server did not return the new record')
                  onCreated(created)
                } catch (e: any) {
                  setErr(e?.message || 'Failed to create')
                } finally {
                  setSaving(false)
                }
              }}
              className={`px-4 py-2 rounded-lg text-white ${saving ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =====================================================
   Named export: CreateEmpModal
   (Restored so EmployeeFilePage can import it.)
   ===================================================== */
export function CreateEmpModal({
  open,
  onClose,
  onCreated,
  branchOptions = [],
}: {
  open: boolean
  onClose: () => void
  onCreated?: (emp: any) => void
  branchOptions?: string[]
}) {
  const token = useAuthStore((s) => s.token)
  const role = useAuthStore((s) => s.role)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [uid, setUid] = useState('')
  const [phone, setPhone] = useState('')
  const [branch, setBranch] = useState('')
  const [department, setDepartment] = useState('')
  const [brand, setBrand] = useState('')
  
  const [nationality, setNationality] = useState<string>('Iraqi')
const [employmentType, setEmploymentType] = useState<'wages' | 'salary'>('wages')
  const [hourlyRate, setHourlyRate] = useState<string>('0')
  const [salaryIqd, setSalaryIqd] = useState<string>('0')
  const [joinDate, setJoinDate] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResults, setImportResults] = useState<{
    success: number
    failed: number
    errors: string[]
  } | null>(null)

  // Bulk delete state
  const [deleting, setDeleting] = useState(false)
  const [deleteResults, setDeleteResults] = useState<{
    deleted: number
    errors: string[]
  } | null>(null)
  
  // Employee list and selection state
  const [employees, setEmployees] = useState<any[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [showEmployeeList, setShowEmployeeList] = useState(false)

  

  // Brand options with HeadOffice included
  const brandChoices = Array.from(
  new Set(
    ((Array.isArray(BRAND_OPTIONS) ? BRAND_OPTIONS : []) as string[])
      .map((s) => s.replace(/\s+/g, ' ').trim())
  )
);
if (!open) return null

  async function createEmployeeWithFallback(fullBody: any) {
    const tk = token
    if (!tk) throw new Error('Unauthorized')
    const auth = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`
    const paths = ['/employees', '/api/employees']
    for (const path of paths) {
      try {
        const r = await fetch(path, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth },
          credentials: 'include',
          body: JSON.stringify(fullBody),
        })
        if (r.ok) return await r.json()
      } catch {}
    }
    throw new Error('Server rejected create request')
  }

  const handleSave = async () => {
    try {
      setBusy(true)
      setMsg(null)
      const body = sanitizeEmployeePayload({
        name,
        code,
        uid: uid || code,
        phone,
        branch,
        department,
        nationality,
        brand,
        employment_type: employmentType,
        hourly_rate: Number(hourlyRate || 0),
        salary_iqd: Number(salaryIqd || 0),
        join_date: joinDate,
      })
      const created = await createEmployeeWithFallback(body)
      onCreated && onCreated(created)
      onClose()
    } catch (e: any) {
      setMsg(e?.message || 'Failed to create employee')
    } finally {
      setBusy(false)
    }
  }

  const handleExcelImport = async (file: File) => {
    try {
      setImporting(true)
      setMsg(null)
      setImportResults(null)

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${API_BASE}/exports/employees/import-excel`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': token?.startsWith('Bearer ') ? token : `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const result = await response.json()
      
      if (result.success) {
        setImportResults({
          success: Number(result.imported_count || 0),
          failed: Number(result.total_errors || 0),
          errors: Array.isArray(result.errors) ? result.errors : []
        })

        if (result.imported_count > 0) {
          onCreated && onCreated({ bulk: true, count: result.imported_count })
          // Refresh employee list if visible
          if (showEmployeeList) {
            loadEmployees()
          }
        }
      } else {
        throw new Error(result.message || 'Import failed')
      }

    } catch (error: any) {
      setMsg(`Import failed: ${error.message}`)
    } finally {
      setImporting(false)
    }
  }

  // Load employee list
  const loadEmployees = async () => {
    if (!token) return
    
    try {
      setLoadingEmployees(true)
      const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`
      
      const response = await fetch(`${API_BASE}/employee_files?status=active`, {
        method: 'GET',
        headers: {
          'Authorization': auth,
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const data = await response.json()
      // Filter out employees with "left" status - only show truly active employees for bulk delete
      const activeEmployees = Array.isArray(data) 
        ? data.filter(emp => emp.status !== 'left' && emp.status !== 'deleted' && emp.is_active !== 0)
        : []
      setEmployees(activeEmployees)
    } catch (error) {
      console.error('Failed to load employees:', error)
      setEmployees([])
    } finally {
      setLoadingEmployees(false)
    }
  }

  // Bulk selection handlers
  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked)
    if (checked) {
      const activeEmployees = employees.filter(emp => emp.is_active || emp.status === 'active')
      setSelectedIds(new Set(activeEmployees.map(emp => emp.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleSelectOne = (empId: number, checked: boolean) => {
    const newSelected = new Set(selectedIds)
    if (checked) {
      newSelected.add(empId)
    } else {
      newSelected.delete(empId)
      setSelectAll(false)
    }
    setSelectedIds(newSelected)
    
    // Update select all if all active items are selected
    const activeEmployees = employees.filter(emp => emp.is_active || emp.status === 'active')
    if (newSelected.size === activeEmployees.length && activeEmployees.length > 0) {
      setSelectAll(true)
    }
  }

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    
    if (!confirm(`PERMANENT DELETE

This will permanently remove ${selectedIds.size} selected employees and all their related data (logs, payroll, history).
This cannot be undone. Continue?`)) {
      return
    }

    try {
      setDeleting(true)
      setMsg(null)
      setDeleteResults(null)
      const idsArray = Array.from(selectedIds)
      
      console.log(`Starting bulk delete for ${idsArray.length} employees:`, idsArray)
      
      // Use the API function instead of direct fetch
      const result = await bulkDeleteEmployees(idsArray)
      
      console.log('Bulk delete completed successfully:', result)

      // Update local employee list by removing deleted employees
      setEmployees(prev => prev.filter(emp => !selectedIds.has(emp.id)))
      
      setDeleteResults({
        deleted: selectedIds.size,
        errors: []
      })
      
      setSelectedIds(new Set())
      setSelectAll(false)
      
      // Show success message
      setMsg(`Successfully deleted ${selectedIds.size} employees and all related data`)
      
      // Notify parent component if needed
      onCreated && onCreated({ bulk: true, count: -selectedIds.size })

    } catch (error: any) {
      console.error('Bulk delete failed:', error)
      setMsg(`Bulk delete failed: ${error.message || 'Unknown error occurred'}`)
      setDeleteResults({
        deleted: 0,
        errors: [error.message || 'Unknown error occurred']
      })
    } finally {
      setDeleting(false)
    }
  }



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl w-full max-w-xl p-6 z-10 shadow-2xl">
        <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-white flex items-center gap-2">
          <span>➕</span> Create Employee
        </h3>

        {/* Import Section */}
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-blue-900 dark:text-blue-100">📊 Bulk Import</h4>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              id="excel-import"
              disabled={importing || busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  handleExcelImport(file)
                }
                e.target.value = ''
              }}
            />
            <label
              htmlFor="excel-import"
              className={`px-3 py-1 rounded text-sm font-medium cursor-pointer transition-colors ${
                importing || busy
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {importing ? 'Importing...' : '📁 Import Excel'}
            </label>
          </div>
          <p className="text-xs text-blue-800 dark:text-blue-200">
            Import multiple employees from Excel. Required: EMP Code, EMP Name
          </p>
        </div>



        {deleteResults && (
          <div className="mb-3 px-3 py-2 rounded bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-200 border border-orange-200 dark:border-orange-800">
            🗑️ Successfully deleted {deleteResults.deleted} employees
            {deleteResults.errors.length > 0 && (
              <div className="mt-1 text-xs">
                {deleteResults.errors.length} errors occurred.
              </div>
            )}
          </div>
        )}

        {importResults && (
          <div className="mb-3 px-3 py-2 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-200 border border-green-200 dark:border-green-800">
            ✅ Successfully imported {importResults.success} employees
          </div>
        )}

        {msg && (
          <div className="mb-3 px-3 py-2 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 border border-red-200 dark:border-red-800">
            {msg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Name</span>
            <input className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={name} onChange={e=>setName(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Code</span>
            <input className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={code} onChange={e=>setCode(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">UID</span>
            <input className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={uid} onChange={e=>setUid(e.target.value)} placeholder="leave empty to use Code" />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Phone *</span>
            <input className={`w-full px-2 py-1 rounded border bg-white dark:bg-slate-700 ${
              phone && phone.replace(/\D/g, '').length < 10 
                ? 'border-red-500 dark:border-red-400' 
                : 'border-slate-300 dark:border-slate-600'
            }`}
              value={phone} onChange={e=>setPhone(e.target.value)} 
              placeholder="Min 10 digits required" />
            {phone && phone.replace(/\D/g, '').length < 10 && (
              <p className="text-xs text-red-500 mt-1">Phone must be at least 10 digits</p>
            )}
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Branch</span>
            <select className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={branch} onChange={e=>setBranch(e.target.value)}>
              <option value="">—</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Position</span>
            <input className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={department} onChange={e=>setDepartment(e.target.value)} placeholder="e.g., Cashier" />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Nationality</span>
            <input list="nationality-list" className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={nationality} onChange={(e)=>setNationality(e.target.value)} placeholder="e.g. Iraqi" />
            <datalist id="nationality-list">
              <option value="Iraqi" />
            </datalist>
          </label>
        
<label className="text-sm">
              <span className="block mb-1 text-slate-600 dark:text-slate-300">Brand</span>
              <select
                className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              >
                <option value="">—</option>
                {brandChoices.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
              </select>
            </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Joined At</span>
            <input type="date" className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={joinDate} onChange={e=>setJoinDate(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600 dark:text-slate-300">Employment Type</span>
            <select className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={employmentType} onChange={e=>setEmploymentType(e.target.value as any)}>
              <option value="wages">wages</option>
              <option value="salary">salary</option>
            </select>
          </label>
          {employmentType === 'wages' ? (
            <label className="text-sm">
              <span className="block mb-1 text-slate-600 dark:text-slate-300">Hourly Rate</span>
              <input type="number" className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={hourlyRate} onChange={e=>setHourlyRate(e.target.value)} />
            </label>
          ) : (
            <label className="text-sm">
              <span className="block mb-1 text-slate-600 dark:text-slate-300">Salary (IQD)</span>
              <input type="number" className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={salaryIqd} onChange={e=>setSalaryIqd(e.target.value)} />
            </label>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="px-3 py-2 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
            onClick={() => !busy && onClose()} disabled={busy}>
            Cancel
          </button>
          <button className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
            onClick={handleSave} disabled={busy || !name.trim() || !phone.trim() || phone.replace(/\D/g, '').length < 10}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}