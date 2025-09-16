// src/pages/Logs.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { api, BRANCHES } from '@/api/client'
import type { AttendanceLog, DeviceInfo } from '@/types/models'

const LS_KEY = 'logs.filters.v16'

type Me = { username:string; email:string; role:'admin'|'manager'|string; allowed_branches:any[] }

export default function Logs() {
  // me
  const [me, setMe] = useState<Me|null>(null)
  const isAdmin = (me?.role || 'admin').toLowerCase() === 'admin'

  // filters (YYYY-MM-DD)
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')
  const [branch, setBranch] = useState<string>('All')
  const [deviceKey, setDeviceKey] = useState<string>('ALL') // "name||branch" or 'ALL'
  const [query, setQuery] = useState<string>('')

  // paging
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(200)

  // data
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // auxiliary lookups (employee branch by uid/code)
  const [empBranchByUid, setEmpBranchByUid] = useState<Record<string, string>>({})
  const [empBranchByCode, setEmpBranchByCode] = useState<Record<string, string>>({})

  // ---------- utils ----------
  const pad2 = (n:number)=>String(n).padStart(2,'0')
  const inputDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
  const normDisp = (v:any) => String(v ?? '').trim()
  const normKey  = (v:any) => normDisp(v).toLowerCase().replace(/\s+/g,'')

  const deviceNameOf   = (r:any) => r?.deviceName ?? r?.device_name ?? r?.device?.name ?? ''
  const deviceBranchOf = (r:any) => r?.deviceBranch ?? r?.device_branch ?? r?.device?.branch ?? r?.device?.branch_name ?? ''
  const logDeviceKey   = (r:any) => `${normDisp(deviceNameOf(r))}||${normDisp(deviceBranchOf(r))}`

  // ---- robust date parsing (prefer dateText day, then others; timestamp last) ----
  function ymdFromAny(x:any): string {
    if (x === undefined || x === null) return ''
    if (typeof x === 'string') {
      const s = x.trim()
      const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`
      const mDMY = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
      if (mDMY) return `${mDMY[3]}-${pad2(+mDMY[2])}-${pad2(+mDMY[1])}`
      const mMDY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
      if (mMDY) return `${mMDY[3]}-${pad2(+mMDY[1])}-${pad2(+mMDY[2])}`
    }
    try { const d = new Date(x); if (!isNaN(d.getTime())) return inputDate(d) } catch {}
    return ''
  }

  function ymdFromAt(at:any): string {
    if (typeof at === 'string') {
      const m = at.match(/^(\d{4}-\d{2}-\d{2})[T\s]/)
      if (m) return m[1] // respect recorded calendar date, avoid TZ drift
    }
    return ymdFromAny(at)
  }

  function logDateStr(r:any): string {
    const dt = r?.dateText ?? r?.date_text
    if (dt) {
      const s = String(dt).trim()
      let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})$/) // dd-MM (no year)
      if (m) {
        const dd = pad2(+m[1]), mm = pad2(+m[2])
        const baseYear = (to || from || inputDate(new Date())).slice(0,4)
        return `${baseYear}-${mm}-${dd}`
      }
      m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/) // dd-MM-YYYY
      if (m) return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`
      const y = s.match(/^(\d{4})-(\d{2})-(\d{2})$/) // already YYYY-MM-DD
      if (y) return s
    }
    const other = r?.date ?? r?.logDate ?? r?.day ?? r?.d
    if (other) {
      const y = ymdFromAny(other)
      if (y) return y
    }
    const at = r?.at ?? r?.timestamp ?? r?.ts
    if (at) {
      const y = ymdFromAt(at)
      if (y) return y
    }
    return ''
  }

  function saveFilters() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ from, to, branch, deviceKey, query, pageSize })) } catch {}
  }
  function restoreFilters() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const o = JSON.parse(raw || '{}') || {}
      if (o.from) setFrom(o.from)
      if (o.to) setTo(o.to)
      if (o.branch) setBranch(o.branch)
      if (o.deviceKey) setDeviceKey(o.deviceKey)
      if (o.query) setQuery(o.query)
      if (o.pageSize) setPageSize(o.pageSize)
    } catch {}
  }

  // ---- /auth/me ----
  function getApiBase(): string {
    const env = (import.meta as any)?.env?.VITE_API_URL as string | undefined
    if (env) return env.replace(/\/+$/, '')
    const url = new URL(window.location.href)
    const port = url.port === '5173' ? '8000' : url.port
    return `${url.protocol}//${url.hostname}${port ? ':' + port : ''}`
  }
  function tokenHeader() {
    const t = localStorage.getItem('jwt') || localStorage.getItem('token') || localStorage.getItem('auth_token') || localStorage.getItem('access_token') || ''
    return t ? { Authorization: /^bearer\s/i.test(t) ? t : `Bearer ${t}` } : {}
  }
  function normalizeMe(d:any): Me {
    const role = String(d?.role || d?.user?.role || 'manager').toLowerCase()
    const raw = Array.isArray(d?.allowed_branches) ? d.allowed_branches
              : Array.isArray(d?.branch_ids) ? d.branch_ids
              : Array.isArray(d?.branches) ? d.branches
              : Array.isArray(d?.allowedBranches) ? d.allowedBranches : []
    return { username: d?.username || '', email: d?.email || '', role, allowed_branches: raw }
  }
  useEffect(() => { (async()=>{ try{ const r = await fetch(`${getApiBase()}/auth/me`, { headers: tokenHeader() }); if(r.ok) setMe(normalizeMe(await r.json())) }catch{}})() }, [])

  // ---------- fetch with single-day fallback ----------
  async function fetchAll(opts?: { f?: string; t?: string }) {
    const fStr = opts?.f ?? from
    const tStr = opts?.t ?? to

    setLoading(true); setError(null)
    try {
      // try multiple parameter shapes for single-day; otherwise standard from/to
      const attempts: any[] = []
      if (fStr || tStr) {
        attempts.push({ from: fStr || undefined, to: tStr || undefined })
        if (fStr && tStr && fStr === tStr) {
          // single-day variations some backends expect
          attempts.push({ date: fStr })
          attempts.push({ on: fStr })
          attempts.push({ day: fStr })
          attempts.push({ date_from: fStr, date_to: tStr })
        }
      }
      // final fallback: fetch all, we'll filter on client
      attempts.push({})

      let base: any[] = []
      for (const params of attempts) {
        const raw = await api.getLogs(params)
        base = Array.isArray(raw) ? raw : (raw?.items ?? [])
        if (base.length > 0 || (params && Object.keys(params).length === 0)) break
      }

      const [employees, devs] = await Promise.all([
        api.getEmployees({}),
        api.getDevices(),
      ])

      const byUid: Record<string, string> = {}; const byCode: Record<string, string> = {}
      for (const e of (employees as any[])) {
        if ((e as any).uid)  byUid[(e as any).uid]  = (e as any).branch ?? ''
        if ((e as any).code) byCode[(e as any).code] = (e as any).branch ?? ''
      }

      setEmpBranchByUid(byUid)
      setEmpBranchByCode(byCode)
      setDevices(devs as any)
      setLogs(base as any)
      setPage(1)
      saveFilters()
    } catch (err:any) {
      setError(err?.message ?? 'Failed to load logs')
    } finally { setLoading(false) }
  }

  useEffect(() => { restoreFilters(); fetchAll() }, [])
  useEffect(() => { saveFilters() }, [from, to, branch, deviceKey, query, pageSize])

  // ---------- presets ----------
  function applyToday() {
    const t = new Date()
    const s = inputDate(t)
    setFrom(s); setTo(s)
    fetchAll({ f: s, t: s })
  }
  function applyLastNDays(n:number) {
    const t = new Date()
    const end = inputDate(t)
    const sd = new Date(t)
    sd.setDate(sd.getDate()-(n-1))
    const s = inputDate(sd)
    setFrom(s); setTo(end)
    fetchAll({ f: s, t: end })
  }
  function clearFilters() {
    setFrom(''); setTo(''); setBranch('All'); setDeviceKey('ALL'); setQuery(''); setPage(1)
    fetchAll({ f:'', t:'' })
  }

  // ---------- options ----------
  const branchOptions = useMemo(() => {
    const set = new Set<string>()
    const add = (v:any) => { const s = normDisp(v); if (s) set.add(s) }

    for (const d of devices as any[]) add((d as any).branch ?? (d as any).branch_name)
    for (const r of logs as any[]) add((r as any).deviceBranch ?? (r as any).branch)
    if (Array.isArray(BRANCHES)) for (const b of BRANCHES as any[]) add(b)

    let list = Array.from(set)
    list = list.filter(b => normKey(b) !== 'all')
    list.sort((a,b)=>a.localeCompare(b))
    return ['All', ...list]
  }, [devices, logs])

  const deviceOptions = useMemo(() => {
    const set = new Set<string>()
    const out: { key: string; label: string }[] = [{ key: 'ALL', label: 'All devices' }]

    for (const d of devices as any[]) {
      const dn = normDisp((d as any).name)
      if (!dn) continue
      const db = normDisp((d as any).branch ?? (d as any).branch_name)
      const key = `${dn}||${db}`
      if (!set.has(key)) { set.add(key); out.push({ key, label: db ? `${dn} (${db})` : dn }) }
    }
    for (const r of logs as any[]) {
      const dn = normDisp(deviceNameOf(r))
      if (!dn) continue
      const db = normDisp(deviceBranchOf(r))
      const key = `${dn}||${db}`
      if (!set.has(key)) { set.add(key); out.push({ key, label: db ? `${dn} (${db})` : dn }) }
    }

    return out
  }, [devices, logs])

  // ---------- client-side filtering (inclusive by date) ----------
  const filtered = useMemo(() => {
    const selectedKey = normKey(branch)
    const q = query.trim().toLowerCase()
    const f = from || ''
    const t = to   || ''

    return (logs as any[]).filter((r) => {
      const d = logDateStr(r)
      if (f && (!d || d < f)) return false
      if (t && (!d || d > t)) return false

      if (branch !== 'All') {
        const rb = normKey((r as any).branch ?? (r as any).branch_name ?? (r as any).branchName)
        const db = normKey(deviceBranchOf(r))
        const match = (rb && rb === selectedKey) || (db && db === selectedKey)
        if (!match) return false
      }

      if (deviceKey !== 'ALL' && logDeviceKey(r) !== deviceKey) return false

      if (q) {
        const code = (r as any).code ? String((r as any).code) : ''
        if (!(
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.uid && r.uid.toLowerCase().includes(q)) ||
          (code && code.toLowerCase().includes(q))
        )) return false
      }
      return true
    })
  }, [logs, from, to, branch, deviceKey, query])

  // pagination
  const startIdx = (Math.min(page, Math.max(1, Math.ceil((filtered.length || 1) / pageSize))) - 1) * pageSize
  const view = filtered.slice(startIdx, startIdx + pageSize)

  function exportCSV() {
    const header = ['Time', 'Date', 'Name', 'UID', 'Event', 'Code', 'Branch', 'Device']
    const rows = filtered.map((r: any) => [
      r.timeText, r.dateText, r.name, r.uid, r.event, r.code ?? '',
      empBranchByUid[r.uid] ?? empBranchByCode[r.code] ?? r.branch ?? '',
      deviceBranchOf(r) ? `${deviceNameOf(r)} (${deviceBranchOf(r)})` : deviceNameOf(r),
    ])
    const csv = [header, ...rows]
      .map(line => line.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'logs.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function Pager() {
    const total = filtered.length
    const pageCount = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, pageCount)
    if (pageCount <= 1) return null
    const canPrev = currentPage > 1
    const canNext = currentPage < pageCount
    const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount))
    const nums: number[] = []
    const start = Math.max(1, currentPage - 2)
    const end = Math.min(pageCount, start + 4)
    for (let i = Math.max(1, end - 4); i <= end; i++) nums.push(i)

    return (
      <div className="flex items-center gap-3">
        <button className="px-4 py-2 bg-background border border-border rounded-lg font-medium text-sm shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200" disabled={!canPrev} onClick={() => goto(currentPage - 1)}>Previous</button>
        {nums[0] > 1 && (<>
          <button className="px-3 py-2 bg-background border border-border rounded-lg font-medium text-sm shadow-sm hover:shadow-md transition-all duration-200" onClick={() => goto(1)}>1</button>
          {nums[0] > 2 && <span className="text-sm text-muted-foreground">...</span>}
        </>)}
        {nums.map(n => (
          <button
            key={n}
            className={`px-3 py-2 border rounded-lg font-medium text-sm shadow-sm hover:shadow-md transition-all duration-200 ${n === currentPage ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white border-purple-500' : 'bg-background border-border text-foreground'}`}
            onClick={() => goto(n)}
          >
            {n}
          </button>
        ))}
        {nums[nums.length - 1] < pageCount && (<>
          {nums[nums.length - 1] < pageCount - 1 && <span className="text-sm text-muted-foreground">...</span>}
          <button className="px-3 py-2 bg-background border border-border rounded-lg font-medium text-sm shadow-sm hover:shadow-md transition-all duration-200" onClick={() => goto(pageCount)}>{pageCount}</button>
        </>)}
        <button className="px-4 py-2 bg-background border border-border rounded-lg font-medium text-sm shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200" disabled={!canNext} onClick={() => goto(currentPage + 1)}>Next</button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Attendance Logs</h1>
          <p className="text-muted-foreground mt-1">View and filter attendance records</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${isAdmin ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'}`}>
            {isAdmin ? 'Admin Access' : 'Manager View'}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-purple-500"></div>
              <h3 className="font-semibold text-lg">Filters & Controls</h3>
            </div>
            <p className="text-sm text-muted-foreground">Filter logs by date range, branch, device, or employee</p>
          </div>
          <button className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 text-sm" onClick={exportCSV}>
            Export CSV
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">From Date</label>
            <input type="date" className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">To Date</label>
            <input type="date" className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Branch</label>
            <select className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Action</label>
            <button className="w-full px-3 py-2.5 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 text-sm" onClick={() => fetchAll()}>
              Apply Filters
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground">Quick Filters:</span>
          <button className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200" onClick={applyToday}>Today</button>
          <button className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200" onClick={() => applyLastNDays(7)}>Last 7 Days</button>
          <button className="px-4 py-2 bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200" onClick={() => applyLastNDays(30)}>Last 30 Days</button>
          <button className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 hover:from-slate-600 hover:to-slate-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200" onClick={clearFilters}>Clear All</button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Device</label>
            <select className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]" value={deviceKey} onChange={(e) => { setDeviceKey(e.target.value); setPage(1) }}>
              {deviceOptions.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Search</label>
            <input className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]" placeholder="Name / UID / Code" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Rows per page</label>
            <select className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]" value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1) }}>
              {[100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
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
        <div className="flex items-center justify-between mb-6">
          <div className="text-sm font-medium text-muted-foreground">
            Showing <span className="font-bold text-purple-600 dark:text-purple-400">{view.length}</span> of <span className="font-bold text-purple-600 dark:text-purple-400">{filtered.length}</span> filtered logs
            {filtered.length !== logs.length && <span className="text-muted-foreground"> (total {logs.length})</span>}
          </div>
          <Pager />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">UID</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Device</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={8}>Loading...</td></tr>
              ) : view.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={8}>
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">📊</div>
                    No results found
                  </div>
                </td></tr>
              ) : (
                view.map((r: any, i: number) => (
                  <tr key={String(r.id ?? i)} className="hover:bg-muted/50 transition-colors border-b border-border/50">
                    <td className="px-3 py-3 font-mono text-xs">{r.timeText}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.dateText}</td>
                    <td className="px-3 py-3 font-medium">{r.name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.uid}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        r.event === 'in' 
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                          : r.event === 'out'
                          ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {r.event}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.code ?? ''}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                        {empBranchByUid[r.uid] ?? empBranchByCode[r.code] ?? r.branch ?? ''}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {String(deviceBranchOf(r) || empBranchByUid[r.uid] || empBranchByCode[r.code] || r.branch || '')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end border-t border-border/50 pt-4">
          <Pager />
        </div>
      </div>
    </div>
  )
}

function Pager() {
  const [_, __] = useState(null) // keep component identity, no UI change requested
  return null
}
