import React, { useEffect, useRef, useState } from 'react'
import employeeFileApi, {
  type EmployeeLite,
  type EmpLog,
  type EmpPayrollMonth,
  type EmpDeduction,
  type SalaryChange,
} from '@/api/employeeFiles'
import { useAuthStore } from '@/store/auth'
import AttendanceIcon from '@/components/AttendanceIcon'
import RoleBadge from '@/components/RoleBadge'
import EmployeeFileModal, { CreateEmpModal } from '@/pages/EmployeeFile/EmployeeFileModal'
import { formatMinutes } from '@/features/employeeFiles/utils';
import { formatLocalDateTime } from '@/features/employeeFiles/utils/time';
import { BRAND_OPTIONS } from '@/constants/brands';

// ---- delete helper (tries both bare and /api/ prefix) ----
async function deleteEmployeeById(empId: number, hard = false): Promise<boolean> {
  const token = useAuthStore.getState().token
  if (!token) return false
  const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`

  const endpoints = hard
    ? [`/employees/${empId}/purge`, `/api/employees/${empId}/purge`]
    : [`/employees/${empId}`, `/api/employees/${empId}`]

  for (const path of endpoints) {
    try {
      const r = await fetch(path, {
        method: 'DELETE',
        headers: { Accept: 'application/json', Authorization: auth },
        credentials: 'include',
      })
      if (r.ok) return true
    } catch {}
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
  if (brand) body.brand = brand;

  if (!isSalary) body.hourly_rate = Number(input.hourly_rate ?? input.hourlyRate ?? 0)
  if (isSalary) body.salary_iqd = Number(input.salary_iqd ?? input.salary ?? 0)

  const phone = input.phone ?? input.mobile ?? ''
  if (String(phone).trim()) body.phone = String(phone).trim()
  if (join_date) body.join_date = join_date

  return body
}

type TabKey = 'overview' | 'logs' | 'payroll' | 'deductions' | 'advances' | 'salary' | 'overrides';

export default function EmployeeFilePage() {
  const role = useAuthStore((s) => s.role)
  const token = useAuthStore((s) => s.token)

  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<EmployeeLite[]>([])
  const [active, setActive] = useState<EmployeeLite | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [showArchived, setShowArchived] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'left'>('all')
  
  // Selection state for bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // -------- API helpers --------

  async function listEFWithFallback(
    params: { q: string; include_archived: boolean },
    tk: string | null | undefined
  ): Promise<EmployeeLite[]> {
    try {
      const res = await employeeFileApi.listEmployeeFiles(params as any)
      if (Array.isArray(res)) return res as EmployeeLite[]
    } catch {}

    if (!tk) throw new Error('Unauthorized')
    const auth = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`

    const qs = new URLSearchParams()
    if (params.q) qs.set('q', params.q)
    if (params.include_archived) qs.set('include_archived', 'true')

    for (const path of ['/employee_files', '/api/employee_files']) {
      try {
        const resp = await fetch(`${path}?${qs.toString()}`, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: auth },
          credentials: 'include',
        })
        if (resp.ok) {
          const data = await resp.json()
          if (Array.isArray(data)) return data as EmployeeLite[]
        }
      } catch {}
    }
    throw new Error('Not Found')
  }

  async function buildBranchListUnion(
  tk: string | null | undefined,
  current: EmployeeLite[]
): Promise<string[]> {
  const set = new Set<string>();

  // seed with branches already present on the loaded employees
  for (const e of current) {
    const b = (e as any)?.branch;
    if (b) set.add(String(b));
  }

  // if we have a token, try fetching branch list from the API
  if (tk) {
    const auth = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`;

    // resolve API base (dev: 517x -> 8000; prod: keep origin)
    const API_BASE = (() => {
      const env = (import.meta as any)?.env || {};
      const v =
        env.VITE_API_BASE_URL ??
        env.VITE_API_URL ??
        (window as any)?.VITE_API_BASE_URL ??
        (window as any)?.VITE_API_URL ?? '';
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

    const endpoints = [
      `${API_BASE}/branches`,
      `${API_BASE}/api/branches`,
    ];

    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: auth },
          credentials: 'include',
        });
        if (!r.ok) continue;

        const ct = r.headers.get('content-type') || '';
        const payload = /json/i.test(ct) ? await r.json() : null;
        const list: string[] = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
          ? payload
          : [];

        for (const b of list) if (b) set.add(String(b));
        if (list.length) break; // we got a good response; stop trying others
      } catch {
        /* try next endpoint */
      }
    }
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}


  async function createEmployeeWithFallback(payload: any, tk: string | null | undefined) {
    if (!tk) throw new Error('Unauthorized')
    const auth = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`
    const body = sanitizeEmployeePayload(payload)

    for (const path of ['/employees', '/api/employees']) {
      try {
        const resp = await fetch(path, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: auth,
          },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        if (!resp.ok) continue
        const ct = resp.headers.get('content-type') || ''
        const data = /json/i.test(ct) ? await resp.json() : null
        return data && typeof data === 'object' ? (data.data ?? data) : body
      } catch {}
    }
    throw new Error('Create failed')
  }

  // -------- Load --------
  useEffect(() => {
    if (!token) return
    let mounted = true
    setLoading(true)
    setError(null)

    listEFWithFallback({ q, include_archived: showArchived }, token)
      .then(async (res) => {
        if (!mounted) return
        setItems(res)
        setError(null)
        const branches = await buildBranchListUnion(token, res)
        if (mounted) setBranchOptions(branches)
      })
      .catch((err) => {
        if (!mounted) return
        setError(err?.message || 'Failed to load employees')
        setItems([])
        setBranchOptions([])
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [q, token, showArchived])

  useEffect(() => {
    buildBranchListUnion(token, items).then(setBranchOptions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, JSON.stringify(items.map((i) => (i as any)?.branch ?? ''))])

  const handleRetry = () => {
    if (!token) return
    setError(null)
    setLoading(true)
    listEFWithFallback({ q, include_archived: showArchived }, token)
      .then((res) => {
        setItems(res)
        setError(null)
      })
      .catch((err) => {
        setError(err?.message || 'Failed to load employees')
        setItems([])
      })
      .finally(() => setLoading(false))
  }

  const handleStatusChanged = (id: number, nextStatus: 'active' | 'left') => {
    setItems((prev) =>
      prev.map((e: any) =>
        e.id === id ? { ...e, status: nextStatus, is_active: nextStatus === 'active' ? 1 : 0 } : e
      ) as EmployeeLite[]
    )
    setActive((prev) => (prev && prev.id === id ? ({ ...prev, status: nextStatus } as any) : prev))
  }

  const filteredItems = items.filter((emp: any) => {
    const s = emp?.status
    const effective: 'active' | 'left' = s === 'active' || s === 'left' ? s : emp?.is_active ? 'active' : 'left'
    if (!showArchived && effective === 'left') return false
    if (statusFilter === 'active' && effective !== 'active') return false
    if (statusFilter === 'left' && effective !== 'left') return false
    const qLower = q.trim().toLowerCase()
    if (!qLower) return true
    return (
      (emp.name || '').toLowerCase().includes(qLower) ||
      String(emp.uid || '').toLowerCase().includes(qLower) ||
      String(emp.code || '').toLowerCase().includes(qLower)
    )
  })

  // Bulk selection handlers
  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked)
    if (checked) {
      setSelectedIds(new Set(filteredItems.map(emp => emp.id)))
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
    
    // Update select all if all items are selected
    if (newSelected.size === filteredItems.length && filteredItems.length > 0) {
      setSelectAll(true)
    }
  }

  const handleBulkDelete = async () => {
  if (selectedIds.size === 0) return

  if (!confirm(`Are you sure you want to permanently delete ${selectedIds.size} selected employees? This action cannot be undone.`)) {
    return
  }

  try {
    setDeleting(true)

    await Promise.all(
      Array.from(selectedIds).map(id => deleteEmployeeById(id, true)) // <-- hard delete!
    )

    setItems(prev => prev.filter(emp => !selectedIds.has(emp.id)))
    setSelectedIds(new Set())
    setSelectAll(false)

    alert(`Successfully deleted ${selectedIds.size} employees permanently.`)

  } catch (error: any) {
    alert(`Bulk delete failed: ${error.message}`)
  } finally {
    setDeleting(false)
  }
}

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Employee Files</h1>
              <p className="text-slate-600 dark:text-slate-400">Comprehensive employee records and attendance archive</p>
            </div>
            <div className="flex items-center gap-3">
              <RoleBadge />
              <div className="hidden md:flex items-center gap-2 mr-2">
                {(['all', 'active', 'left'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      statusFilter === k
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {k === 'all' ? 'All' : k === 'active' ? 'Active' : 'Left'}
                  </button>
                ))}
              </div>
              <label className="hidden md:inline-flex items-center gap-2 mr-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                <span className="text-sm text-slate-600 dark:text-slate-400">Include archived</span>
              </label>
              
              {/* Bulk selection controls - Admin only */}
              {role === 'admin' && filteredItems.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-red-600"
                      checked={selectAll}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                    <span className="text-sm text-slate-600 dark:text-slate-400">Select All</span>
                  </label>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleBulkDelete}
                      disabled={deleting}
                      className="px-3 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Delete ${selectedIds.size} selected employees`}
                    >
                      {deleting ? 'Deleting...' : `🗑️ Delete (${selectedIds.size})`}
                    </button>
                  )}
                </div>
              )}
              
              {(role === 'admin' || role === 'hr') && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
                  title="Create a new employee file"
                >
                  Create Emp File
                </button>
              )}
              <div className="relative">
                <input
                  className="w-full sm:w-80 px-4 py-2.5 pl-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-slate-900 dark:text-white placeholder-slate-500"
                  placeholder="Search by name or code..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <svg className="absolute left-3 top-3 h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Mobile controls */}
          <div className="mt-3 md:hidden flex items-center gap-3">
            <div className="flex items-center gap-2">
              {(['all', 'active', 'left'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setStatusFilter(k)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === k
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {k === 'all' ? 'All' : k === 'active' ? 'Active' : 'Left'}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              <span className="text-sm text-slate-600 dark:text-slate-400">Include archived</span>
            </label>
            
            {/* Mobile bulk selection controls - Admin only */}
            {role === 'admin' && filteredItems.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="accent-red-600"
                    checked={selectAll}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-400">Select All</span>
                </label>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={deleting}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    title={`Delete ${selectedIds.size} selected employees`}
                  >
                    {deleting ? 'Deleting...' : `🗑️ Delete (${selectedIds.size})`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
              <span className="text-blue-800 dark:text-blue-200">Loading employees...</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-red-800 dark:text-red-200">{error}</span>
              </div>
              <button onClick={handleRetry} className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium">
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filteredItems.length === 0 && (
          <div className="text-center py-16">
            <div className="w-24 h-24 mx-auto mb-6 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">No employees found</h3>
            <p className="text-slate-600 dark:text-slate-400">{q ? `No employees match "${q}"` : 'No employee records available'}</p>
          </div>
        )}

        {/* Grid */}
        {!loading && !error && filteredItems.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredItems.map((emp) => (
              <div
                key={`${emp.id}`}
                className={`group relative bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-lg border transition-all duration-200 hover:scale-[1.02] ${
                  selectedIds.has(emp.id)
                    ? 'border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/10'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {/* Checkbox - Admin only */}
                {role === 'admin' && (
                  <div className="absolute top-3 left-3 z-10">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-red-600 bg-white border-gray-300 rounded focus:ring-red-500 dark:focus:ring-red-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      checked={selectedIds.has(emp.id)}
                      onChange={(e) => {
                        e.stopPropagation()
                        handleSelectOne(emp.id, e.target.checked)
                      }}
                    />
                  </div>
                )}

                {/* Clickable area */}
                <button
                  className="w-full p-6 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded-xl"
                  onClick={() => {
                    setActive(emp)
                    setTab('overview')
                  }}
                >
                  {/* Status pill */}
                  {(() => {
                    const s = (emp as any)?.status
                    const status: 'active' | 'left' = s === 'active' || s === 'left' ? s : (emp as any)?.is_active ? 'active' : 'left'
                    return (
                      <span
                        className={`absolute top-3 right-3 inline-flex items-center px-2 py-1 rounded-full text-xs ${
                          status === 'active'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {status === 'active' ? 'Active' : 'Left'}
                      </span>
                    )
                  })()}

                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg group-hover:shadow-xl">
                      <AttendanceIcon size={24} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate mb-1">{emp.name || '—'}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400 space-y-1">
                        <div className="truncate">Code: {emp.code || emp.uid || '—'}</div>
                        {emp.branch && (
                          <div className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{emp.branch}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Details modal */}
        {active && (
          <EmployeeFileModal
            emp={active}
            onClose={() => setActive(null)}
            tab={tab}
            setTab={setTab}
            canEdit={role === 'admin' || role === 'hr'}
            role={role}
            onStatusChange={handleStatusChanged}
            onMetaChange={(id, patch) =>
              setItems((prev) =>
                prev.map((e: any) => (e.id === id ? { ...e, ...(patch || {}) } : e)) as EmployeeLite[]
              )
            }
            branchOptions={branchOptions}
          />
        )}

        {/* Create modal */}
        {showCreate && (
          <CreateEmpModal
            open={true}
            onClose={() => setShowCreate(false)}
            onCreated={(newEmp: any) => {
              setShowCreate(false)
              setItems((prev) => [newEmp, ...prev])
            }}
            branchOptions={branchOptions}
          />
        )}
      </div>
    </div>
  )
}