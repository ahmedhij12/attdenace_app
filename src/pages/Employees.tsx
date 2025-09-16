// src/pages/Employees.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { api, BRANCHES } from '@/api/client'
import type { Employee } from '@/types/models'
import { useAuthStore } from '@/store/auth'

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

  const [editing, setEditing] = useState<Employee|null>(null)
  const [show, setShow] = useState(false)

  // role/scope
  const [me, setMe] = useState<Me|null>(null)
  const isManager = (me?.role || '').toLowerCase() === 'manager'
  const allowedBranchesRaw = me?.allowed_branches ?? []

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

  // ---------- branch helpers ----------
  const uniq = (arr: string[]) =>
    Array.from(new Set(arr.map(s => String(s).trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))

  const normKey = (v: any) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')

  function isWithinAllowed(x:any): boolean {
    if (!isManager) return true
    const names = new Set(allowedBranchesRaw.map((b:any) => normKey(typeof b === 'object' ? (b.name ?? b.title ?? b.slug) : b)))
    return names.size === 0 ? false : names.has(normKey(x.branch))
  }

  async function buildBranchListUnion(): Promise<string[]> {
    try {
      const devs = await api.getDevices()
      const fromDevices = uniq((Array.isArray(devs) ? devs : (devs as any)?.items ?? [])
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
        const allowedNames = new Set(allowedBranchesRaw.map((b:any) => normKey(typeof b === 'object' ? (b.name ?? b.title ?? b.slug) : b)))
        union = union.filter(b => allowedNames.has(normKey(b)))
      }
      return union
    } catch { return [] }
  }

  // ---------- load ----------
  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await api.getEmployees({})
      const scoped = (isManager ? data.filter(isWithinAllowed) : data)

      const union = await buildBranchListUnion()
      setBranchList(union)

      const qLower = q.trim().toLowerCase()
      const filteredByBranch = (branchFilter === 'All')
        ? scoped
        : scoped.filter((e:any) => normKey(e.branch) === normKey(branchFilter))

      const finalRows = qLower
        ? filteredByBranch.filter((e:any) =>
            (e.name || '').toLowerCase().includes(qLower) ||
            (e.uid || '').toLowerCase().includes(qLower) ||
            (e.code || '').toLowerCase().includes(qLower)
          )
        : filteredByBranch

      setRows(finalRows)
    } catch (err:any) {
      setError(err?.message ?? 'Failed to load employees')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadMe() }, [])
  useEffect(() => { load() }, [q, branchFilter, me?.role, JSON.stringify(allowedBranchesRaw)])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (isManager) { alert('Read-only role: managers cannot add or edit employees.'); return }
    if (!editing) return
    try {
      setLoading(true); setError(null)
      if (editing.id == null) await api.createEmployee(editing as any)
      else await api.updateEmployee(editing.id, editing as any)
      setShow(false); setEditing(null)
      await load()
      if (branchFilter === 'All' && (editing.branch ?? '')) setBranchFilter(String(editing.branch))
    } catch(e:any){ setError(e?.message ?? 'Failed to save') } finally { setLoading(false) }
  }
  async function remove(id: number) {
    if (isManager) { alert('Read-only role: managers cannot delete employees.'); return }
    if (!confirm('Delete employee?')) return
    try { setLoading(true); await api.deleteEmployee(id); await load() }
    catch(e:any){ setError(e?.message ?? 'Failed to delete') }
    finally { setLoading(false) }
  }

  const esc = (v: any) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`)
  function exportCSV() {
    const header = ['Name','Branch','Nationality','Department','UID','Code','EmploymentType','HourlyRate','SalaryIQD','Phone','JoinedAt']
    const body = rows.map((e:any)=>[
      e.name, e.branch ?? '', (e.nationality ?? ''), e.department ?? '', e.uid ?? '', e.code ?? '',
      e.employment_type ?? '', e.hourly_rate ?? '', e.salary_iqd ?? '',
      e.phone ?? '', e.joined_at ?? ''
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
    return isNaN(d.getTime()) ? s : d.toLocaleDateString()
  }

  // Edit modal options: include union list and current value (in case it’s legacy)
  const editBranchOptions = useMemo(() => {
    const set = new Set<string>(branchList)
    if (editing?.branch) set.add(String(editing.branch))
    return Array.from(set).filter(Boolean).sort((a,b)=>a.localeCompare(b))
  }, [branchList, editing?.branch])

  return (
    <div className="space-y-6 p-6">
      <DarkFormFix />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage employee records and information</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${
            isManager 
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100' 
              : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100'
          }`}>
            {isManager ? 'Manager View' : 'Admin Access'}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="card" style={{ colorScheme: theme === 'dark' ? 'dark' : 'light' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <h3 className="font-semibold text-lg">Employee Management</h3>
            </div>
            <p className="text-sm text-muted-foreground">Search, filter, and manage your employee database</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select 
              className="px-4 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm font-medium text-foreground" 
              value={branchFilter} 
              onChange={(e)=>setBranchFilter(e.target.value)} 
              title="Filter by branch"
            >
              <option value="All">All Branches</option>
              {branchList.filter(b=>b!== 'All').map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            <input 
              className="px-4 py-2.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-sm min-w-[200px]" 
              placeholder="Search employees." 
              value={q} 
              onChange={e=>setQ(e.target.value)} 
            />
            <button 
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 text-sm"
              onClick={exportCSV}
            >
              Export CSV
            </button>
            <button
              className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 text-sm"
              onClick={() => {
                if (isManager) { alert('Read-only role: managers cannot add employees.'); return }
                setEditing({
                  id: undefined, name: '', branch: '', uid: '', code: '',
                  department: null, address: null, phone: null, birthdate: null,
                  employment_type: null, hourly_rate: null, salary_iqd: null, joined_at: null,
                  // NEW: default nationality so payroll can compute allowances
                  nationality: 'iraqi',
                } as unknown as Employee)
                setShow(true)
              }}>
              Add Employee
            </button>
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
                <th className="px-3 py-2 font-medium">Branch</th>
                {/* NEW */}
                <th className="px-3 py-2 font-medium">Nationality</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2 font-medium">UID</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Employment</th>
                <th className="px-3 py-2 font-medium">Hourly Rate</th>
                <th className="px-3 py-2 font-medium">Salary (IQD)</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Joined At</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={12}>Loading.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={12}>No employees found</td></tr>
              ) : (
                rows.map((e:any) => (
                  <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-3 py-3">{e.name}</td>
                    <td className="px-3 py-3">{e.branch ?? '-'}</td>
                    {/* NEW */}
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
                    <td className="px-3 py-3 text-muted-foreground">{fmtDate(e.joined_at)}</td>
                    <td className="px-3 py-3 text-right space-x-2">
                      <button 
                        className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg text-xs font-medium shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                        onClick={() => { setEditing(e); setShow(true) }}
                      >
                        Edit
                      </button>
                      <button 
                        className="px-3 py-1.5 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-lg text-xs font-medium shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                        onClick={() => remove(e.id!)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {show && editing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center p-4 z-50">
          <form
            onSubmit={save}
            className="bg-background rounded-3xl shadow-2xl border border-border w-full max-w-4xl space-y-6 p-8 max-h-[90vh] overflow-auto"
            style={{ colorScheme: theme === 'dark' ? 'dark' : 'light' }}
          >
            <div className="text-2xl font-bold">
              {editing.id == null ? 'Add Employee' : 'Edit Employee'}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Field label="Name">
                <input 
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200" 
                  value={editing.name || ''} 
                  onChange={e=>setEditing({...editing, name:e.target.value})}
                />
              </Field>

              <Field label="Branch">
                <select
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-foreground"
                  value={editing.branch || ''}
                  onChange={e=>setEditing({ ...editing, branch: e.target.value })}
                >
                  <option value="">— Select Branch —</option>
                  {editBranchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>

              {/* NEW */}
              <Field label="Nationality">
                <input
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200"
                  placeholder="e.g., iraqi, jordanian, indian."
                  value={(editing as any).nationality ?? 'iraqi'}
                  onChange={e=>setEditing({ ...(editing as any), nationality: e.target.value } as any)}
                />
              </Field>

              <Field label="Department">
                <input 
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200" 
                  value={(editing as any).department || ''} 
                  onChange={e=>setEditing({ ...(editing as any), department:e.target.value } as any)}
                />
              </Field>

              <Field label="UID">
                <input 
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 font-mono" 
                  value={editing.uid || ''} 
                  onChange={e=>setEditing({ ...(editing as any), uid:e.target.value } as any)}
                />
              </Field>

              <Field label="Code">
                <input 
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 font-mono" 
                  value={editing.code || ''} 
                  onChange={e=>setEditing({ ...(editing as any), code:e.target.value } as any)}
                />
              </Field>

              <Field label="Employment Type">
                <select 
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-foreground" 
                  value={(editing as any).employment_type ?? ''} 
                  onChange={e => {
                    const v = (e.target.value || null) as 'wages' | 'salary' | null
                    setEditing({
                      ...(editing as any),
                      employment_type: v,
                      hourly_rate: v === 'salary' ? null : (editing as any).hourly_rate,
                      salary_iqd: v === 'wages' ? null : (editing as any).salary_iqd,
                    } as any)
                  }}
                >
                  <option value="">— Select Type —</option>
                  <option value="wages">Wages</option>
                  <option value="salary">Salary</option>
                </select>
              </Field>

              {(editing as any).employment_type === 'wages' && (
                <Field label="Hourly Rate">
                  <input 
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200" 
                    type="number" 
                    min={0}
                    value={(editing as any).hourly_rate ?? ''} 
                    onChange={e=>setEditing({ ...(editing as any), hourly_rate: e.target.value === '' ? null : Number(e.target.value) } as any)}
                  />
                </Field>
              )}

              {(editing as any).employment_type === 'salary' && (
                <Field label="Salary (IQD)">
                  <input 
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200" 
                    type="number" 
                    min={0}
                    value={(editing as any).salary_iqd ?? ''} 
                    onChange={e=>setEditing({ ...(editing as any), salary_iqd: e.target.value === '' ? null : Number(e.target.value) } as any)}
                  />
                </Field>
              )}

              <Field label="Phone">
                <input 
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200" 
                  value={(editing as any).phone ?? ''} 
                  onChange={e=>setEditing({ ...(editing as any), phone: e.target.value || null } as any)}
                />
              </Field>

              <Field label="Joined At">
                <input 
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200" 
                  type="date" 
                  value={(editing as any).joined_at ? String((editing as any).joined_at).substring(0,10) : ''} 
                  onChange={e=>setEditing({ ...(editing as any), joined_at: e.target.value || null } as any)}
                />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button 
                type="button"
                className="px-4 py-2 rounded-xl border border-border hover:bg-muted/40 transition"
                onClick={() => { setShow(false); setEditing(null) }}
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-lg transition"
              >
                Save Employee
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
