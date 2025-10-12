// src/pages/Employees.tsx
import React, { useEffect, useState } from 'react'
import { api, BRANCHES } from '@/api/client'
import type { Employee } from '@/types/models'
import { useAuthStore } from '@/store/auth'
import RoleBadge from "@/components/RoleBadge";
import { listEmployees } from '@/api/employees'
import { BRAND_OPTIONS } from '@/constants/brands';
import { formatLocalDate } from "@/features/employeeFiles/utils/time";

type Me = { username: string; email: string; role: 'admin'|'manager'|string; allowed_branches: any[] }

/** Small global nudge for native controls when dark mode is active */
function DarkFormFix() {
  return (
    <style>{`
      .dark select,
      .dark option,
      .dark input[type="date"],
      .dark input[type="time"],
      .dark input[list] { color-scheme: dark; }
      .dark ::placeholder { color: rgb(156 163 175 / 0.85); }
    `}</style>
  )
}

export default function Employees() {
  const theme = useAuthStore(s => s.theme)

  const [rows, setRows] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)

  const [q, setQ] = useState('')
  const [branchList, setBranchList] = useState<string[]>([])
  const [branchFilter, setBranchFilter] = useState<string>('All')

  // NEW: Brand filter (client-side only; no backend changes)
  const BRAND_OPTIONS = ['All Brands', 'Awtar', '360', 'AA Chicken', 'CallCenter'] as const
  type BrandFilter = typeof BRAND_OPTIONS[number]
  const [brandFilter, setBrandFilter] = useState<BrandFilter>('All Brands')

  // role/scope
  const [me, setMe] = useState<Me|null>(null)
  const isManager = (me?.role || '').toLowerCase() === 'manager'
  const allowedBranchesRaw = me?.allowed_branches ?? []
  const isAccountant = (me?.role || '').toLowerCase() === 'accountant'

  // ---------- infra ----------
  function getApiBase(): string {
    try {
      const s = (useAuthStore as any)?.getState?.()
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
    try { t = (useAuthStore as any)?.getState?.().token } catch {}
    t = t || localStorage.getItem('jwt') || localStorage.getItem('token') ||
        localStorage.getItem('auth_token') || localStorage.getItem('access_token') || ''
    return t ? { Authorization: /^bearer\s/i.test(t) ? t : `Bearer ${t}` } : {}
  }
  async function loadMe() {
    try {
      const res = await fetch(`${getApiBase()}/auth/me`, { headers: tokenHeader() })
      if (res.ok) {
        const d = await res.json()
        setMe({
          username: d?.username || '',
          email: d?.email || '',
          role: String(d?.role || 'manager').toLowerCase(),
          allowed_branches:
            Array.isArray(d?.allowed_branches) ? d.allowed_branches :
            Array.isArray(d?.branches) ? d.branches :
            Array.isArray(d?.allowedBranches) ? d.allowedBranches : [],
        })
      }
    } catch {}
  }

  // ---------- fetch employees (with fallback) ----------
  async function fetchEmployeesWithFallback(includeArchived: boolean): Promise<any[]> {
    try {
      const r = await listEmployees({ include_archived: includeArchived })
      const arr = Array.isArray(r) ? r : (r as any)?.items
      if (Array.isArray(arr)) return arr
    } catch {}

    const params = new URLSearchParams()
    params.set('include_archived', includeArchived ? 'true' : 'false')

    for (const path of ['/employees', '/api/employees']) {
      try {
        const resp = await fetch(`${getApiBase()}${path}?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: 'application/json', ...tokenHeader() },
          credentials: 'include',
        })
        if (!resp.ok) continue
        const ct = resp.headers.get('content-type') || ''
        if (!ct.toLowerCase().includes('application/json')) { await resp.text(); continue }
        const data = await resp.json()
        const arr = Array.isArray(data) ? data : (data?.items ?? [])
        if (Array.isArray(arr)) return arr
      } catch {}
    }
    throw new Error('Could not load employees (unexpected response).')
  }

  // ---------- branch helpers ----------
  const uniq = (arr: string[]) =>
    Array.from(new Set(arr.map(s => String(s).trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))
  const normKey = (v: any) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
  function isWithinAllowed(x:any): boolean {
    if (!isManager) return true
    const names = new Set(allowedBranchesRaw.map((b:any) =>
      normKey(typeof b === 'object' ? (b.name ?? b.title ?? b.slug) : b)))
    return names.size === 0 ? false : names.has(normKey(x.branch))
  }
  async function buildBranchListUnion(): Promise<string[]> {
    try {
      const devResp = await api.listDevices()
      const devs = api.ensureArray(devResp)
      const fromDevices = uniq((Array.isArray(devs) ? devs : [])
        .map((d:any) => String(d?.branch ?? d?.branch_name ?? '')))

      let fromServer: string[] = []
      try {
        const res = await fetch(`${getApiBase()}/branches`, { headers: tokenHeader() })
        if (res.ok) {
          const data = await res.json()
          const list = Array.isArray(data) ? data : (data?.items ?? data?.data ?? data?.branches ?? [])
          fromServer = uniq(list.map(String))
        }
      } catch {}

      const fromStatic = Array.isArray(BRANCHES) ? uniq(BRANCHES.map(String)) : []

      let union = uniq([...fromStatic, ...fromDevices, ...fromServer])
      if (isManager) {
        const allowedNames = new Set(allowedBranchesRaw.map((b:any) =>
          normKey(typeof b === 'object' ? (b.name ?? b.title ?? b.slug) : b)))
        union = union.filter(b => allowedNames.has(normKey(b)))
      }
      return union
    } catch { return [] }
  }

  // ---------- load ----------
  async function load() {
    setLoading(true); setError(null)
    try {
      // Server: request active-only if supported
      const all = await fetchEmployeesWithFallback(false)

      // Client guard for legacy flags
      const activeOnly = all.filter((e: any) => {
        if (e?.status === 'active') return true
        if (e?.status === 'left') return false
        return e?.is_active === 1 || e?.is_active === true
      })

      const scoped = isManager ? activeOnly.filter(isWithinAllowed) : activeOnly

      const union = await buildBranchListUnion()
      setBranchList(union)

      const qLower = q.trim().toLowerCase()
      const filteredByBranch = (branchFilter === 'All')
        ? scoped
        : scoped.filter((e: any) => normKey(e.branch) === normKey(branchFilter))

      const finalRows = qLower
        ? filteredByBranch.filter((e: any) =>
            (e.name || '').toLowerCase().includes(qLower) ||
            String(e.uid || '').toLowerCase().includes(qLower) ||
            String(e.code || '').toLowerCase().includes(qLower))
        : filteredByBranch

      setRows(finalRows)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load employees')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadMe() }, [])
  // Note: brandFilter is client-only; we don't re-fetch on it.
  useEffect(() => { load() }, [q, branchFilter, me?.role, JSON.stringify(allowedBranchesRaw)])

  // ---------- CSV export (respects filters by using viewRows) ----------
  const esc = (v: any) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`)
  function exportCSV() {
    const header = [
      'Name','Location','Brand','Nationality','Position',
      'UID','Code','EmploymentType','HourlyRate','SalaryIQD','Phone','JoinedAt'
    ]
    const body = viewRows.map((e:any) => [
      e.name,
      e.branch ?? '',           // Location
      e.brand ?? '',            // Brand
      e.nationality ?? '',
      e.department ?? '',       // Position
      e.uid ?? '',
      e.code ?? '',
      e.employment_type ?? '',
      e.hourly_rate ?? '',
      e.salary_iqd ?? '',
      e.phone ?? '',
      getJoinedAt(e) ?? ''
    ])
    const csv = [header, ...body].map(r => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'employees.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const fmtDate = (v: any) => {
    if (!v) return '-'
    const s = String(v)
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
    const d = new Date(s)
     return formatLocalDate(s);
  }
  // Normalize various server keys → a single joined-at value
  const getJoinedAt = (e: any) =>
    e?.joined_at ?? e?.joinedAt ?? e?.join_date ?? e?.joined ??
    e?.start_date ?? e?.hired_at ?? e?.created_at ?? null;

  // ---------- derive view based on brandFilter (client-side) ----------
const normBrand = (s: string) => String(s || '').trim().toLowerCase()
const viewRows = rows.filter((r: any) => {
  if (brandFilter === 'All Brands') return true
  const b = normBrand(r.brand)
  if (brandFilter === 'Awtar')       return b === 'awtar'
  if (brandFilter === '360')         return b === '360'
  if (brandFilter === 'AA Chicken')  return b === 'aa chicken'
  if (brandFilter === 'CallCenter')  return b.replace(/\s+/g, '') === 'callcenter' // handles "Call Center"
  return true
})


  if (isAccountant) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground mt-1">Active employees</p>
        </div>
        <div className="card py-12 text-center text-sm">
          Access denied. This page is disabled for the Accountant role.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <DarkFormFix />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground mt-1">Browse, filter, and export your active roster</p>
        </div>

        <div className="flex items-center gap-3">
          <RoleBadge />
          {isManager && (allowedBranchesRaw?.length ?? 0) > 0 && (
            <div className="text-xs text-muted-foreground">
              {allowedBranchesRaw.length} branch{allowedBranchesRaw.length !== 1 ? 'es' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Controls (read-only) */}
      <div className="card" style={{ colorScheme: theme === 'dark' ? 'dark' : 'light' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <h3 className="font-semibold text-lg">Employee Management</h3>
            </div>
            <p className="text-sm text-muted-foreground">Search, filter, and export the roster</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Location filter */}
            <select 
              className="px-4 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm font-medium text-foreground" 
              value={branchFilter} 
              onChange={(e)=>setBranchFilter(e.target.value)} 
              title="Filter by location"
            >
              <option value="All">All Locations</option>
              {branchList.filter(b=>b!== 'All').map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            {/* NEW: Brand filter */}
            <select
              className="px-4 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm font-medium text-foreground"
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value as BrandFilter)}
              title="Filter by brand"
            >
              {BRAND_OPTIONS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            {/* Search */}
            <input 
              className="px-4 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm min-w-[200px]" 
              placeholder="Search employees." 
              value={q} 
              onChange={e=>setQ(e.target.value)} 
            />

            {/* Export */}
            <button 
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 text-sm"
              onClick={exportCSV}
              title="Export visible rows (respects filters)"
            >
              Export CSV
            </button>
            {/* Add/Edit/Delete intentionally removed to keep this page read-only */}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-6 py-4 rounded-2xl shadow-lg">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">Nationality</th>
                <th className="px-3 py-2 font-medium">Position</th>
                <th className="px-3 py-2 font-medium">UID</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Employment</th>
                <th className="px-3 py-2 font-medium">Hourly Rate</th>
                <th className="px-3 py-2 font-medium">Salary (IQD)</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Joined At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={12}>Loading.</td></tr>
              ) : viewRows.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={12}>No employees found</td></tr>
              ) : (
                viewRows.map((e:any) => (
                  <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-3 py-3">{e.name}</td>
                    <td className="px-3 py-3">{e.branch ?? '-'}</td>
                    <td className="px-3 py-3">{e.brand ?? '-'}</td>
                    <td className="px-3 py-3">{e.nationality ?? '-'}</td>
                    <td className="px-3 py-3">{e.department ?? '-'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.uid ?? '-'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.code ?? '-'}</td>
                    <td className="px-3 py-3">
                      {e.employment_type ? String(e.employment_type).toLowerCase() : '-'}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{e.employment_type === 'wages' ? (e.hourly_rate ?? '-') : '-'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.employment_type === 'salary' ? (e.salary_iqd ?? '-') : '-'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.phone ?? '-'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{fmtDate(getJoinedAt(e))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
