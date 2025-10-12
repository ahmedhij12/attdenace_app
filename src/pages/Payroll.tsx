// src/pages/Payroll.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw, Calendar, Building2 } from 'lucide-react'
import { getPayroll, type PayrollRow } from '@/api/payroll'
import { useAuthStore } from '@/store/auth'
import RoleBadge from "@/components/RoleBadge";

const pad = (n:number) => String(n).padStart(2,'0')
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const monthRange = (d = new Date()) => {
  const a = new Date(d.getFullYear(), d.getMonth(), 1)
  const b = new Date(d.getFullYear(), d.getMonth()+1, 0)
  return { from: fmt(a), to: fmt(b) }
}

export default function Payroll() {
  const role = useAuthStore(s => s.role?.toLowerCase?.() || 'manager')
  const allowed = role === 'admin' || role === 'hr'
  const [adoptedServerPeriod, setAdoptedServerPeriod] = useState(false)
  const token = useAuthStore(s => s.token || '')

  // ▼▼ Branch options state (starts with "All")
  const [branchOptions, setBranchOptions] = useState<string[]>(['All'])
  // ▲▲

  const clientDefault = monthRange()
  const [from, setFrom] = useState(clientDefault.from)
  const [to, setTo] = useState(clientDefault.to)
  const [branch, setBranch] = useState<string>('All')
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [penFile, setPenFile] = useState<File | null>(null)
  const [advFile, setAdvFile] = useState<File | null>(null)
  const [otherFile, setOtherFile] = useState<File | null>(null) // ← missing state added

  // --- De-dupe & stale-response guard (StrictMode-friendly) ---
  const inflightKeyRef = useRef<string>('')      // current (from|to|branch) being loaded
  const reqSeqRef = useRef(0)                    // increasing request sequence

  const days = useMemo(() => {
    const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00')
    const out: string[] = []
    for (let d = new Date(a); d <= b; d.setDate(d.getDate()+1)) out.push(fmt(d))
    return out
  }, [from, to])

  const summary = useMemo(() => {
    if (!rows.length) return { employees: 0, totalHours: 0, totalPay: 0, avgPay: 0 }
    const employees = rows.length
    const totalHours = rows.reduce((s, r) => s + (r.totals?.hours || 0), 0)
    const totalPay = rows.reduce((s, r) => s + (r.totals?.total_pay_iqd || 0), 0)
    const avgPay = totalPay / Math.max(1, employees)
    return { employees, totalHours, totalPay, avgPay }
  }, [rows])

  // ----------------------------
  // Branch options (solve empty)
  // ----------------------------

  function resolveApiBase(): string {
    const env: any = (import.meta as any)?.env || {};
    const v =
      env.VITE_API_BASE_URL ??
      env.VITE_API_URL ??
      (window as any)?.VITE_API_BASE_URL ??
      (window as any)?.VITE_API_URL ??
      '';
    if (typeof v === 'string' && v) return v.replace(/\/+$/, '');
    try {
      const u = new URL(window.location.href);
      // In dev, map Vite ports to API port 8000. Adjust if your API runs elsewhere.
      const devPorts = new Set(['5173', '5174', '5175', '5137']);
      const port = devPorts.has(u.port) ? '8000' : u.port;
      return `${u.protocol}//${u.hostname}${port ? ':' + port : ''}`;
    } catch {
      return '';
    }
  }

  // 1) Primary source: GET /branches (with auth). Runs once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Resolve API base
        const API_BASE: string = (() => {
          const env = (import.meta as any)?.env || {};
          const v =
            env.VITE_API_BASE_URL ??
            env.VITE_API_URL ??
            (window as any)?.VITE_API_BASE_URL ??
            (window as any)?.VITE_API_URL ??
            '';
          if (typeof v === 'string' && v) return v.replace(/\/+$/, '');
          try {
            const u = new URL(window.location.href);
            const devPorts = new Set(['5173', '5174', '5175', '5137']);
            const port = devPorts.has(u.port) ? '8000' : u.port;
            return `${u.protocol}//${u.hostname}${port ? ':' + port : ''}`;
          } catch {
            return '';
          }
        })();

        if (!API_BASE) return;

        // Auth header
        if (!token) return; // don't call until token exists (prevents 401s)
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

        // Always keep the sentinel as "All" (UI renders it as "All branches")
        let branchOpts: string[] = ['All'];

        // Try /branches first
        try {
          const res = await fetch(`${API_BASE}/branches`, {
            headers,
            method: 'GET',
          });

          if (res.status === 401 || res.status === 403) {
            // Fallback: derive from /auth/me for scoped roles (e.g., Manager)
            const meRes = await fetch(`${API_BASE}/auth/me`, {
              headers,
              method: 'GET',
            });
            if (meRes.ok) {
              const me: any = await meRes.json();
              const allowedRaw: unknown[] = Array.isArray(me?.allowed_branches)
                ? me.allowed_branches
                : (me?.branch ? [me.branch] : []);
              const names = (allowedRaw as unknown[]).map((b: unknown) => {
                if (typeof b === 'string') return b;
                const name = (b as any)?.name ?? (b as any)?.branch ?? '';
                return typeof name === 'string' ? name : '';
              }).filter((s): s is string => Boolean(s));
              if (names.length) {
                branchOpts = ['All', ...Array.from(new Set(names))];
              }
            }
          } else if (res.ok) {
            const data: unknown = await res.json();
            const list: unknown[] = Array.isArray(data)
              ? data as unknown[]
              : (Array.isArray((data as any)?.items) ? (data as any).items : []);
            const names = list.map((b: unknown) => {
              if (typeof b === 'string') return b;
              const name = (b as any)?.name ?? (b as any)?.branch ?? '';
              return typeof name === 'string' ? name : '';
            }).filter((s): s is string => Boolean(s));
            if (names.length) {
              branchOpts = ['All', ...Array.from(new Set(names))];
            }
          }
        } catch {
          // Network/CORS hiccup → keep default
        }

        if (!cancelled) setBranchOptions(branchOpts);
      } catch {
        // swallow — we'll try fallback #2
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 2) Fallback: derive unique branch names from loaded rows (first successful load)
  useEffect(() => {
    if (branchOptions.length > 1) return     // already populated
    if (!rows.length) return
    const derived = Array.from(new Set(rows.map(r => String(r.branch || '').trim()).filter(Boolean))).sort()
    if (derived.length) setBranchOptions(['All', ...derived])
  }, [rows, branchOptions.length])

  // Ensure the current selection exists; if not (e.g., list loaded later), fall back to All
  useEffect(() => {
    if (branch && !branchOptions.includes(branch)) setBranch('All')
  }, [branchOptions])

  async function load() {
    const key = `${from}|${to}|${branch}`

    // If we already have an identical request in-flight, skip.
    if (inflightKeyRef.current === key) return
    inflightKeyRef.current = key

    // Sequence for this particular invocation; used to ignore stale responses.
    const mySeq = ++reqSeqRef.current

    try {
      setLoading(true); setError(null)

      const data = await getPayroll({
        from,
        to,
        branch: branch === "All" ? undefined : branch,
      })

      // If another newer request started/finished, ignore this response.
      if (reqSeqRef.current !== mySeq) return

      // Adopt server period once (from first row meta.period)
      if (!adoptedServerPeriod && data?.length && (data[0] as any)?.meta?.period) {
        const p = (data[0] as any).meta.period
        const srvFrom = p?.from, srvTo = p?.to
        if ((srvFrom && srvFrom !== from) || (srvTo && srvTo !== to)) {
          inflightKeyRef.current = '' // let next run proceed
          setFrom(srvFrom ?? from)
          setTo(srvTo ?? to)
          setAdoptedServerPeriod(true)
          return
        }
        setAdoptedServerPeriod(true)
      }

      setRows(data)
    } catch (e:any) {
      if (reqSeqRef.current !== mySeq) return // stale failure; ignore
      const msg = (e?.message || '').toLowerCase()
      if (msg.includes('not found') || msg.includes('404')) { setRows([]); setError(null) }
      else { setError(e?.message || 'Failed to load payroll'); setRows([]) }
    } finally {
      if (reqSeqRef.current === mySeq) {
        // only the active request clears its marker
        inflightKeyRef.current = ''
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (allowed) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branch, adoptedServerPeriod, allowed])

  function exportCSV() {
    const header = [
      'Code','Name','Branch','Nationality', ...days,
      'Total Hours','Food Allowance','Other Allowance','Advances','Deductions','Late Coming','Base Salary','Total Pay'
    ]
    const lines = [header.join(',')]
    for (const r of rows) {
      const base = [r.code ?? '', r.name, r.branch, r.nationality]
      const dayVals = days.map(d => String(r.days?.[d] ?? 0))
      const t = r.totals || ({} as any)
      const tail = [
        t.hours ?? 0,
        t.food_allowance_iqd ?? 0,
        t.other_allowance_iqd ?? 0,
        (t as any).advances_iqd ?? 0,      // ← read-only; shows 0 if API doesn't send it
        t.deductions_iqd ?? 0,
        t.late_penalty_iqd ?? 0,
        t.base_salary_iqd ?? 0,
        t.total_pay_iqd ?? 0
      ].map(String)
      lines.push([...base, ...dayVals, ...tail].map(v => (/[,\n"]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v)).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `payroll_${from}_to_${to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }
  
  const exportPayslipsXLSX = async () => {
    try {
      const API_BASE = resolveApiBase();
      const token = useAuthStore.getState().token || '';
      if (!token) { alert('Please sign in again'); return; }

      const qs = new URLSearchParams({ from, to, ...(branch && branch !== 'All' ? { branch } : {}) }).toString();
      const exportUrl = `${API_BASE}/exports/payslips.xlsx?${qs}`;

      let res: Response;
      const hasUploads = !!(penFile || advFile || otherFile);

      if (hasUploads) {
        const fd = new FormData();
        if (penFile)  fd.append('penalties', penFile);
        if (advFile)  fd.append('advances', advFile);
        if (otherFile) fd.append('other_allowance', otherFile)
        res = await fetch(exportUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
          credentials: 'include'
        });
      } else {
        res = await fetch(exportUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
      }

      if (!res.ok) {
        const ct = res.headers.get('content-type') || ''
        const body = ct.includes('json') ? JSON.stringify(await res.json()) : await res.text()
        alert(`Export failed (${res.status}): ${body.slice(0, 600)}`)
        return
      }

      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('spreadsheetml')) {
        const body = await res.text()
        alert(`Export returned non-xlsx content-type (${ct}).
First bytes:
${body.slice(0, 600)}`)
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `payslips_${from}_to_${to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export XLSX failed', e)
      alert(String(e))
    }
  }

  if (!allowed) {
    return (
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Payroll</h1>
            <p className="text-muted-foreground mt-1">Employee payroll management</p>
          </div>
          <div className="flex items-center gap-3">
            <RoleBadge />
          </div>
        </div>
        
        {/* Access Denied */}
        <div className="rounded-2xl bg-zinc-900/5 dark:bg-zinc-800 p-6 shadow-sm card border border-border/50">
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">Access Denied</h3>
              <p className="text-muted-foreground mt-1">This page is only accessible to Admin and HR roles.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payroll</h1>
          <p className="text-muted-foreground mt-1">Employee payroll reporting</p>
        </div>
        <div className="flex items-center gap-3">
          <RoleBadge />
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard 
          title="Employees" 
          value={summary.employees} 
          subtitle={`${branch !== 'All' ? branch : 'All branches'}`} 
        />
        <StatCard 
          title="Total Hours" 
          value={summary.totalHours.toLocaleString()} 
          subtitle={`${days.length} days period`} 
        />
        <StatCard 
          title="Total Payroll" 
          value={`${summary.totalPay.toLocaleString()}`}
          subtitle="IQD"
          status={summary.totalPay > 0 ? "success" : undefined}
        />
        <StatCard 
          title="Average Pay" 
          value={`${Math.round(summary.avgPay).toLocaleString()}`}
          subtitle="IQD per employee" 
        />
      </div>

      {/* Filters Card */}
      <div className="rounded-2xl bg-zinc-900/5 dark:bg-zinc-800 p-6 shadow-sm card border border-border/50 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <h3 className="font-semibold text-lg">Payroll Filters</h3>
            </div>
            <p className="text-sm text-muted-foreground">Configure date range and branch for payroll calculation</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <Field label="From Date" icon={<Calendar className="w-4 h-4" />}>
            <input
              type="date"
              value={from}
              onChange={e => { setAdoptedServerPeriod(true); setFrom(e.target.value) }}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-border text-foreground rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm hover:border-blue-300"
            />
          </Field>
          <Field label="To Date" icon={<Calendar className="w-4 h-4" />}>
            <input
              type="date"
              value={to}
              onChange={e => { setAdoptedServerPeriod(true); setTo(e.target.value) }}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-border text-foreground rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm hover:border-blue-300"
            />
          </Field>

          <Field label="Branch" icon={<Building2 className="w-4 h-4" />}>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-border text-foreground rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm min-w-[160px] hover:border-blue-300"
            >
              {branchOptions.map((b) => (
                <option key={b} value={b}>
                  {b === "All" ? "All branches" : b}
                </option>
              ))}
            </select>
          </Field>

          {/* Optional on-the-fly imports */}
          <div className="flex items-center gap-3">
            <label className="text-xs opacity-80">Penalties Excel
              <input type="file" accept=".xlsx" onChange={e=>setPenFile(e.target.files?.[0]||null)} className="block text-xs" />
            </label>
            <label className="text-xs opacity-80">Advances Excel
              <input type="file" accept=".xlsx" onChange={e=>setAdvFile(e.target.files?.[0]||null)} className="block text-xs" />
            </label>
            {/* Other Allowance Excel */}
            <label className="text-xs opacity-80">Other Allowance Excel
              <input type="file" accept=".xlsx,.xls,.csv" onChange={e => setOtherFile(e.target.files?.[0] || null)} className="block text-xs" />
            </label>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={load} 
              disabled={loading} 
              className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none transition-all duration-200 text-sm inline-flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Loading...' : 'Reload'}
            </button>
            <button 
              onClick={exportCSV} 
              disabled={!rows.length} 
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none transition-all duration-200 text-sm inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button 
              onClick={exportPayslipsXLSX} 
              disabled={!rows.length} 
              className="px-5 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none transition-all duration-200 text-sm inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export Payslips (XLSX)
            </button>
          </div>
        </div>
      </div>

      {/* Payroll Table */}
      <div className="rounded-2xl bg-zinc-900/5 dark:bg-zinc-800 p-6 shadow-sm card border border-border/50 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <h3 className="font-semibold text-lg">Payroll Report</h3>
            </div>
            <p className="text-sm text-muted-foreground">Detailed breakdown of employee hours and compensation</p>
          </div>
          {rows.length > 0 && (
            <div className="text-right text-sm text-muted-foreground">
              {rows.length} employees • {days.length} days
            </div>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 border-b-2 border-slate-200 dark:border-slate-600">
                <Th sticky className="bg-white dark:bg-slate-900 shadow-sm border-r border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-1">
                    <span className="text-xs">👤</span>
                    <span>Code</span>
                  </div>
                </Th>
                <Th sticky className="bg-white dark:bg-slate-900 shadow-sm border-r border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-1">
                    <span className="text-xs">📝</span>
                    <span>Employee Name</span>
                  </div>
                </Th>
                <Th>
                  <div className="flex items-center gap-1">
                    <span className="text-xs">🏢</span>
                    <span>Branch</span>
                  </div>
                </Th>
                <Th>
                  <div className="flex items-center gap-1">
                    <span className="text-xs">🌍</span>
                    <span>Nationality</span>
                  </div>
                </Th>
                {days.map(d => (
                  <Th key={d} center className="min-w-[60px] bg-blue-50 dark:bg-blue-900/20">
                    <div className="flex flex-col items-center">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{d.slice(-2)}</span>
                      <span className="text-[10px] text-blue-500 dark:text-blue-300">Day</span>
                    </div>
                  </Th>
                ))}
                <Th center className="bg-green-50 dark:bg-green-900/20 border-l-2 border-green-200 dark:border-green-700">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">⏰</span>
                    <span className="font-semibold text-green-700 dark:text-green-300">Total Hours</span>
                  </div>
                </Th>
                <Th center className="bg-yellow-50 dark:bg-yellow-900/20">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">🍽️</span>
                    <span className="text-yellow-700 dark:text-yellow-300">Food Allow.</span>
                  </div>
                </Th>
                <Th center className="bg-purple-50 dark:bg-purple-900/20">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">💰</span>
                    <span className="text-purple-700 dark:text-purple-300">Other Allow.</span>
                  </div>
                </Th>
                <Th center className="bg-orange-50 dark:bg-orange-900/20">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">💳</span>
                    <span className="text-orange-700 dark:text-orange-300">Advances</span>
                  </div>
                </Th>
                <Th center className="bg-red-50 dark:bg-red-900/20">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">➖</span>
                    <span className="text-red-700 dark:text-red-300">Deductions</span>
                  </div>
                </Th>
                <Th center className="bg-pink-50 dark:bg-pink-900/20">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">⏱️</span>
                    <span className="text-pink-700 dark:text-pink-300">Late Penalty</span>
                  </div>
                </Th>
                <Th center className="bg-indigo-50 dark:bg-indigo-900/20">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">💼</span>
                    <span className="text-indigo-700 dark:text-indigo-300">Base Salary</span>
                  </div>
                </Th>
                <Th center className="bg-emerald-50 dark:bg-emerald-900/20 border-l-2 border-emerald-200 dark:border-emerald-700">
                  <div className="flex flex-col items-center">
                    <span className="text-xs">💎</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">TOTAL PAY</span>
                  </div>
                </Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13 + days.length} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
                      <p className="text-muted-foreground">Loading payroll data...</p>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={13 + days.length} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-muted-foreground">No payroll data found</p>
                        <p className="text-sm text-muted-foreground mt-1">Try adjusting the date range or branch filter</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const t = (r.totals || {}) as any
                  return (
                    <tr key={i} className="hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 transition-all duration-200 border-b border-slate-100 dark:border-slate-800">
                      <Td sticky className="font-mono text-xs bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                          <span className="font-bold text-slate-700 dark:text-slate-300">{r.code ?? ''}</span>
                        </div>
                      </Td>
                      <Td sticky className="font-medium bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                            {r.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{r.name}</span>
                        </div>
                      </Td>
                      <Td className="text-slate-600 dark:text-slate-400">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {r.branch}
                        </span>
                      </Td>
                      <Td className="capitalize text-slate-600 dark:text-slate-400">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {r.nationality}
                        </span>
                      </Td>
                      {days.map(d => (
                        <Td key={d} center className="font-mono tabular-nums bg-blue-50/30 dark:bg-blue-900/10">
                          <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-medium ${
                            (r.days?.[d] || 0) > 0 
                              ? 'bg-gradient-to-br from-green-400 to-emerald-500 text-white shadow-sm font-bold' 
                              : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                          }`}>{r.days?.[d] ?? 0}</span>
                        </Td>
                      ))}
                      <Td center className="font-mono tabular-nums font-bold bg-green-50/30 dark:bg-green-900/10 border-l-2 border-green-200 dark:border-green-700">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-sm">
                          {t.hours ?? 0}h
                        </span>
                      </Td>
                      <Td center className="font-mono tabular-nums bg-yellow-50/30 dark:bg-yellow-900/10">
                        <span className="text-yellow-700 dark:text-yellow-300 font-semibold">
                          {(t.food_allowance_iqd ?? 0).toLocaleString()}
                        </span>
                      </Td>
                      <Td center className="font-mono tabular-nums bg-purple-50/30 dark:bg-purple-900/10">
                        <span className="text-purple-700 dark:text-purple-300 font-semibold">
                          {(t.other_allowance_iqd ?? 0).toLocaleString()}
                        </span>
                      </Td>
                      <Td center className="font-mono tabular-nums bg-orange-50/30 dark:bg-orange-900/10">
                        <span className="text-orange-700 dark:text-orange-300 font-semibold">
                          {(t.advances_iqd ?? 0).toLocaleString()}
                        </span>
                      </Td>
                      <Td center className="font-mono tabular-nums bg-red-50/30 dark:bg-red-900/10">
                        <span className="text-red-700 dark:text-red-300 font-semibold">
                          {(t.deductions_iqd ?? 0).toLocaleString()}
                        </span>
                      </Td>
                      <Td center className="font-mono tabular-nums bg-pink-50/30 dark:bg-pink-900/10">
                        <span className="text-pink-700 dark:text-pink-300 font-semibold">
                          {(t.late_penalty_iqd ?? 0).toLocaleString()}
                        </span>
                      </Td>
                      <Td center className="font-mono tabular-nums bg-indigo-50/30 dark:bg-indigo-900/10">
                        <span className="text-indigo-700 dark:text-indigo-300 font-semibold">
                          {(t.base_salary_iqd ?? 0).toLocaleString()}
                        </span>
                      </Td>
                      <Td center className="font-semibold font-mono tabular-nums bg-emerald-50/30 dark:bg-emerald-900/10 border-l-2 border-emerald-200 dark:border-emerald-700">
                        <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-bold bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg">
                          💰 {(t.total_pay_iqd ?? 0).toLocaleString()} IQD
                        </span>
                      </Td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-medium text-foreground">
        {icon}{label}
      </label>
      {children}
    </div>
  )
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  status 
}: { 
  title: string; 
  value: React.ReactNode; 
  subtitle?: string; 
  status?: "success" | "warning" | "error"
}) {
  const statusColors = {
    success: "border-green-200 dark:border-green-800",
    warning: "border-yellow-200 dark:border-yellow-800", 
    error: "border-red-200 dark:border-red-800",
  };

  return (
    <div className={`rounded-2xl bg-zinc-900/5 dark:bg-zinc-800 p-6 shadow-sm card border hover:shadow-md transition-shadow ${
      status ? statusColors[status] : "border-border/50"
    }`}>
      <div className="text-sm text-muted-foreground font-medium">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
    </div>
  )
}

function Th({ children, center, sticky, className = '' }: { children: React.ReactNode; center?: boolean; sticky?: boolean; className?: string }) {
  return (
    <th className={`px-4 py-4 whitespace-nowrap font-bold text-slate-700 dark:text-slate-300 text-xs uppercase tracking-wide ${sticky ? 'sticky left-0 z-20' : ''} ${center ? 'text-center' : 'text-left'} ${className}`} style={sticky ? { minWidth: 180 } : undefined}>{children}</th>
  )
}

function Td({ children, center, sticky, className = '', colSpan }: { children: React.ReactNode; center?: boolean; sticky?: boolean; className?: string; colSpan?: number }) {
  return (
    <td className={`px-4 py-4 ${sticky ? 'sticky left-0 z-10' : ''} ${center ? 'text-center' : ''} ${className}`} style={sticky ? { minWidth: 200 } : undefined} colSpan={colSpan}>{children}</td>
  )
}
