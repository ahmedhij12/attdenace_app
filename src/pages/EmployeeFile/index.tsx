// src/pages/EmployeeFile/index.tsx
import React, { useEffect, useRef, useState } from 'react'
import employeeFileApi, {
  type EmployeeLite,
  type EmpLog,
  type EmpPayrollMonth,
  type EmpDeduction,
  type SalaryChange,
} from '@/api/employeeFiles'
import { useAuthStore } from '@/store/auth'
import { AttendanceIcon } from '@/components/AttendanceIcon'
import RoleBadge from '@/components/RoleBadge'


// Display helpers
import { pairLogsIfNeeded } from '@/features/employeeFiles/utils'
import { formatLocalDateTime, formatMinutes, minutesBetween } from '@/features/employeeFiles/utils'

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
  }

  if (!isSalary) body.hourly_rate = Number(input.hourly_rate ?? input.hourlyRate ?? 0)
  if (isSalary) body.salary_iqd = Number(input.salary_iqd ?? input.salary ?? 0)

  const phone = input.phone ?? input.mobile ?? ''
  if (String(phone).trim()) body.phone = String(phone).trim()
  if (join_date) body.join_date = join_date

  return body
}

type TabKey = 'overview' | 'logs' | 'payroll' | 'deductions' | 'advances' | 'salary';

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
  } // based on your existing helper. :contentReference[oaicite:1]{index=1}

  async function buildBranchListUnion(
    tk: string | null | undefined,
    current: EmployeeLite[]
  ): Promise<string[]> {
    const set = new Set<string>()
    for (const e of current) {
      const b = (e as any)?.branch
      if (b) set.add(String(b))
    }
    if (tk) {
      const auth = tk.startsWith('Bearer ') ? tk : `Bearer ${tk}`
      for (const path of ['/branches', '/api/branches']) {
        try {
          const r = await fetch(path, {
            method: 'GET',
            headers: { Accept: 'application/json', Authorization: auth },
            credentials: 'include',
          })
          if (r.ok) {
            const data = await r.json()
            const arr = Array.isArray(data) ? data : data?.items ?? []
            for (const b of arr) {
              if (typeof b === 'string') set.add(b)
              else if (b?.name) set.add(String(b.name))
              else if (b?.branch) set.add(String(b.branch))
            }
          }
        } catch {}
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  } // unchanged logic. :contentReference[oaicite:2]{index=2}


  // Try both employee_files and employees routes for salary history.
async function getSalaryHistoryWithFallback(empId: number) {
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
  return []; // no history available
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 0 014 0zM7 10a2 2 0 11-4 0 2 0 014 0z" />
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
              <button
                key={`${emp.id}`}
                className="group relative bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-lg border border-slate-200 dark:border-slate-700 p-6 text-left transition-all duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
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
              role={role}                                  // ← add this
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
            onClose={() => setShowCreate(false)}
            onCreated={(newEmp: any) => {
              setShowCreate(false)
              setItems((prev) => [newEmp, ...prev])
            }}
            onCreate={(payload) => createEmployeeWithFallback(payload, token)}
            branchOptions={branchOptions}
          />
        )}
      </div>
    </div>
  )
}

/* =========================
   EmployeeFileModal
   ========================= */

function EmployeeFileModal({
  emp,
  onClose,
  tab,
  setTab,
  canEdit,
  role,                             // ← add this
  onStatusChange,
  onMetaChange,
  branchOptions,
}: {
  emp: EmployeeLite
  onClose: () => void
  tab: TabKey
  setTab: (t: TabKey) => void
  canEdit: boolean
  role: 'admin' | 'hr' | 'accountant' | string   // ← add this
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
      ...(String(role || '').toLowerCase() === 'admin'
          ? [{ key: 'advances', label: 'Advances', icon: '💸' }] : []),
      { key: 'salary',     label: 'Salary History', icon: '📈' },
    ] as const);

// Force accountant into the Advances tab (and guard if URL tried to open another)
React.useEffect(() => {
  const allowed = new Set(tabs.map(t => t.key));
  if (!allowed.has(tab)) setTab(isAccountant ? 'advances' : 'overview');
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isAccountant, role]);


  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')

  // Deductions UI state
  const [dedLoadNonce, setDedLoadNonce] = useState(0)
  const [addingDed, setAddingDed] = useState(false)
  const [addDate, setAddDate] = useState<string>('')
  const [addAmount, setAddAmount] = useState<string>('')
  const [addReason, setAddReason] = useState<string>('')
  const [editId, setEditId] = useState<string | number | null>(null)
  const [editDate, setEditDate] = useState<string>('')
  const [editAmount, setEditAmount] = useState<string>('')
  const [editReason, setEditReason] = useState<string>('')
  const [dedBusy, setDedBusy] = useState(false)
  const [dedMsg, setDedMsg] = useState<string | null>(null)

  const [advs, setAdvs] = useState<any[]>([])
const [advMsg, setAdvMsg] = useState<string | null>(null)
const [advLoadNonce, setAdvLoadNonce] = useState(0)
const [addAdvDate, setAddAdvDate] = useState<string>(new Date().toISOString().slice(0,10))
const [addAdvKind, setAddAdvKind] = useState<'advance'|'repayment'>('repayment')
const [addAdvAmount, setAddAdvAmount] = useState<string>('0')
const [addAdvReason, setAddAdvReason] = useState<string>('')

const [editingAdvId, setEditingAdvId] = useState<number | null>(null)
const [editAdvDate, setEditAdvDate] = useState<string>('')
const [editAdvKind, setEditAdvKind] = useState<'advance'|'repayment'>('repayment')
const [editAdvAmount, setEditAdvAmount] = useState<string>('')
const [editAdvReason, setEditAdvReason] = useState<string>('')



  const firstDayOfMonth = (m: string) =>
    (/^\d{4}-\d{2}$/.test(m || '') ? `${m}-01` : new Date().toISOString().slice(0, 10))

  const startAddDed = () => {
    setDedMsg(null)
    setAddingDed(true)
    setEditId(null)
    setAddDate(firstDayOfMonth(month))
    setAddAmount('')
    setAddReason('')
  }
  const cancelAddDed = () => {
    setAddingDed(false)
    setAddDate('')
    setAddAmount('')
    setAddReason('')
  }
  const createDed = async () => {
    if (dedBusy) return
    try {
      setDedBusy(true)
      setDedMsg(null)
      const amt = parseInt(addAmount || '0', 10) || 0
      await employeeFileApi.createEmpDeduction((emp as any).id, {
        date: (addDate && addDate.trim()) || firstDayOfMonth(month),
        amount_iqd: amt,
        note: (addReason || '').trim() || undefined,
      })
      cancelAddDed()
      setDedLoadNonce((n) => n + 1)
    } catch (e: any) {
      setDedMsg(e?.message || 'Failed to add deduction')
    } finally {
      setDedBusy(false)
    }
  }
  const startEditDed = (d: any) => {
    setDedMsg(null)
    setAddingDed(false)
    setEditId(d.id)
    setEditDate(d.date || firstDayOfMonth(month))
    setEditAmount(String(d.amount ?? 0))
    setEditReason(d.reason || d.note || '')
  }
  const cancelEditDed = () => {
    setEditId(null)
    setEditDate('')
    setEditAmount('')
    setEditReason('')
  }
  const saveEditDed = async () => {
    if (dedBusy || editId == null) return
    try {
      setDedBusy(true)
      setDedMsg(null)
      const amt = parseInt(editAmount || '0', 10) || 0
      await employeeFileApi.updateEmpDeduction((emp as any).id, editId as any, {
        date: (editDate && editDate.trim()) || undefined,
        amount_iqd: amt,
        note: (editReason || '').trim() || undefined,
      })
      cancelEditDed()
      setDedLoadNonce((n) => n + 1)
    } catch (e: any) {
      setDedMsg(e?.message || 'Failed to save')
    } finally {
      setDedBusy(false)
    }
  }
  const deleteDed = async (d: any) => {
    if (dedBusy) return
    const isReal = /^\d+$/.test(String(d.id || ''))
    if (!isReal) {
      setDedMsg('Cannot delete legacy payroll-only row.')
      return
    }
    const reason = window.prompt('Delete reason (required):', '')
    if (reason === null) return
    if (!reason.trim()) {
      setDedMsg('Delete reason is required.')
      return
    }
    if (!window.confirm('Are you sure you want to delete this deduction?')) return
    try {
      setDedBusy(true)
      setDedMsg(null)
      await employeeFileApi.deleteEmpDeduction((emp as any).id, d.id, { reason: reason.trim() })
      setDedLoadNonce((n) => n + 1)
    } catch (e: any) {
      setDedMsg(e?.message || 'Failed to delete')
    } finally {
      setDedBusy(false)
    }
  }
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

  const [showAddCheckout, setShowAddCheckout] = useState(false);
  const [addCheckoutTime, setAddCheckoutTime] = useState<string>("");
  const [addCheckoutReason, setAddCheckoutReason] = useState<string>("Forgot to punch out");
  const [pendingCheckoutRow, setPendingCheckoutRow] = useState<null | { employeeId: number; inTs?: string }>(null);

  // Toggle status UX
  const [saving, setSaving] = useState(false)
  const token = useAuthStore((s) => s.token)
  const inFlightRef = useRef<boolean>(false)

  // EDITING (branch + employment + pay)
  const [editing, setEditing] = useState(false)
  const [editVals, setEditVals] = useState<any>(() => ({
    branch: (emp as any).branch ?? '',
    employment_type: (emp as any).employment_type ?? 'wages',
    hourly_rate: (emp as any).hourly_rate ?? '',
    salary_iqd: (emp as any).salary_iqd ?? '',
  }))
  useEffect(() => {
    setEditVals((v: any) => ({
      ...v,
      branch: overview?.branch ?? (emp as any).branch ?? '',
      employment_type: overview?.employment_type ?? (emp as any).employment_type ?? 'wages',
      hourly_rate: overview?.hourly_rate ?? (emp as any).hourly_rate ?? '',
      salary_iqd: overview?.salary_iqd ?? (emp as any).salary_iqd ?? '',
    }))
  }, [overview, (emp as any).id])

async function addManualCheckout(outLocal: string, reason: string) {
  const base = (import.meta as any)?.env?.VITE_API_BASE || "/api";
  const outISO = new Date(outLocal).toISOString();
  const id = Number((emp as any)?.id);
  if (!id) throw new Error("Missing employee id");
    const res = await fetch(`${base}/employee_files/${id}/logs/add_checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify({ out: outISO, reason }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to add checkout (${res.status}) ${msg}`);
  }
  return res.json().catch(() => ({ ok: true }));
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
    if (!v) return undefined
    const m1 = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m1) {
      const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}T00:00:00`)
      return isNaN(d.getTime()) ? undefined : d.toISOString()
    }
    const m2 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m2) {
      const [_, mm, dd, yyyy] = m2
      const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00`)
      return isNaN(d.getTime()) ? undefined : d.toISOString()
    }
    return undefined
  }
  function toIsoDateEnd(v?: string): string | undefined {
    if (!v) return undefined
    const d = new Date(v + 'T23:59:59')
    return isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  function isValidDateInput(v: string): boolean {
    if (!v) return true
    return !!toIsoDateStart(v)
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

  const rowsAll = pairLogsIfNeeded(raw);
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
    const checkIn = r.date_in ?? r.in ?? r.check_in ?? r.datetime_in ?? r.date ?? r.ts_in ?? null
    const checkOut = r.date_out ?? r.out ?? r.check_out ?? r.datetime_out ?? r.ts_out ?? null
    const ciMs = checkIn ? Date.parse(checkIn) : null
    const coMs = checkOut ? Date.parse(checkOut) : null
    if (!startMs && !endMs) return true
    if (ciMs != null) return (!startMs || ciMs >= startMs) && (!endMs || ciMs <= endMs)
    if (coMs != null) return (!startMs || coMs >= startMs) && (!endMs || coMs <= endMs)
    return false
  })

  const logsDisplay = filteredRows.map((r: any) => {
    const checkIn = r.date_in ?? r.in ?? r.check_in ?? r.datetime_in ?? r.date ?? r.ts_in ?? null
    const checkOut = r.date_out ?? r.out ?? r.check_out ?? r.datetime_out ?? r.ts_out ?? null
    const inDisplay = checkIn ? formatLocalDateTime(checkIn) : '—'
    const outDisplay = checkOut ? formatLocalDateTime(checkOut) : '—'
    let hoursDisplay = '—'
    if (typeof r?.hours === 'number') hoursDisplay = formatMinutes(Math.round(r.hours * 60))
    else if (checkIn && checkOut) hoursDisplay = formatMinutes(minutesBetween(checkIn, checkOut))
    const device = r.device ?? r.source ?? r.branch ?? r.reader ?? '—'
    return { ...r, inDisplay, outDisplay, hoursDisplay, device }
  })

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
          const data = await employeeFileApi.getPayroll((emp as any).id, month)
          if (mounted) setPay(data)
        } else if (tab === 'deductions') {
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
  }, [tab, month, (emp as any).id, dedLoadNonce, advLoadNonce]) // unchanged. :contentReference[oaicite:3]{index=3}

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
                    Code: {(emp as any).code || (emp as any).uid || '—'}
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
                {/* Overview (includes inline edit) */}
                {tab === 'overview' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Profile */}
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <span>👤</span> Profile Information
                      </h3>

                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Name:</span>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {overview?.name ?? (emp as any).name}
                          </span>
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
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {/* Phone */}
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Phone:</span>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {overview?.phone ?? '—'}
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
                          <span className="font-medium text-slate-900 dark:text-white">
                            {overview?.joined_at ?? (emp as any)?.joined_at ?? '—'}
                          </span>
                        </div>

                        {/* Status display */}
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

                        {/* Edit/Save */}
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
                                      department: curr.department ?? '',
                                      branch: String(editVals.branch || curr.branch || ''),
                                      uid: String(curr.uid ?? curr.code ?? '').toUpperCase(),
                                      code: curr.code ?? '',
                                      employment_type: String(editVals.employment_type || curr.employment_type || 'wages'),
                                      hourly_rate:
                                        String(editVals.employment_type || curr.employment_type) === 'wages'
                                          ? Number((editVals.hourly_rate ?? curr.hourly_rate) || 0)
                                          : undefined,
                                      salary_iqd:
                                        String(editVals.employment_type || curr.employment_type) === 'salary'
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
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
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
                  </div>
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
                Check-In
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Check-Out
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Device
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Hours
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
            {logsDisplay.map((r: any) => {
              const hasOut =
                !!(r.date_out || r.out || r.check_out || r.datetime_out || r.ts_out) ||
                (typeof r.hours === 'number' && r.hours > 0);

              // Prefill datetime-local from IN (or now)
              const guess = r.date_in ?? r.in ?? r.check_in ?? r.datetime_in ?? r.ts_in ?? null;

              return (
                <tr
                  key={r.id ?? `${r.inDisplay}-${r.outDisplay}-${r.device ?? ''}`}
                  className="hover:bg-slate-50 dark:hover:bg-slate-700/30"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                    {r.inDisplay}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                    {r.outDisplay}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                    {r.device ?? r.branch ?? '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white text-right">
                    {r.hoursDisplay}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    {!hasOut ? (
                      <button
                        className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
                        onClick={() => {
                          const init = guess ? new Date(guess) : new Date();
                          const pad = (n: number) => String(n).padStart(2, "0");
                          const v = `${init.getFullYear()}-${pad(init.getMonth()+1)}-${pad(init.getDate())}T${pad(init.getHours())}:${pad(init.getMinutes())}`;
                          setAddCheckoutTime(v);
                          setAddCheckoutReason("Forgot to punch out");
                          setShowAddCheckout(true);
                        }}
                      >
                        Add Checkout
                      </button>
                    ) : (
                      <span className="opacity-50">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {logsDisplay.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                  No logs found for the selected period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>

    {/* ---- Add Checkout Modal ---- */}
    {showAddCheckout && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="w-full max-w-md rounded-xl bg-neutral-900 text-white shadow-xl p-5">
          <div className="text-lg font-semibold mb-4">Add Checkout</div>

          <label className="block text-sm mb-1">Checkout time</label>
          <input
            type="datetime-local"
            className="w-full mb-3 rounded bg-neutral-800 px-3 py-2 outline-none border border-neutral-700"
            value={addCheckoutTime}
            onChange={(e) => setAddCheckoutTime(e.target.value)}
          />

          <label className="block text-sm mb-1">Reason</label>
          <input
            type="text"
            className="w-full mb-4 rounded bg-neutral-800 px-3 py-2 outline-none border border-neutral-700"
            value={addCheckoutReason}
            onChange={(e) => setAddCheckoutReason(e.target.value)}
            placeholder="Forgot to punch out"
          />

          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600"
              onClick={() => {
                setShowAddCheckout(false);
              }}
            >
              Cancel
            </button>
            <button
              className="px-3 py-2 rounded bg-green-600 hover:bg-green-700"
              onClick={async () => {
                try {
                  await addManualCheckout(addCheckoutTime, addCheckoutReason);
                  await reloadLogs(); // uses your existing loader
                  setShowAddCheckout(false);
                } catch (err: any) {
                  alert(err?.message || "Failed to add checkout");
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
                  <div className="space-y-6">
                    <div className="flex items-end gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Month</label>
                        <input
                          type="month"
                          className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          value={month}
                          onChange={(e) => setMonth(e.target.value)}
                        />
                      </div>
                      <button
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                        onClick={() => setTab('payroll')}
                      >
                        Load
                      </button>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Monthly Totals</h3>
                        <div className="space-y-3">
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Hours:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{pay?.hours_total ?? 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Food Allowance:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{pay?.food_allowance ?? 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Other Allowance:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{pay?.other_allowance ?? 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Deductions:</span>
                            <span className="font-medium text-red-600 dark:text-red-400">{pay?.deductions ?? 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Late Penalty:</span>
                            <span className="font-medium text-red-600 dark:text-red-400">{pay?.late_penalty ?? 0}</span>
                          </div>
                          <div className="flex justify-between pt-3 border-t border-slate-200 dark:border-slate-600">
                            <span className="font-semibold text-slate-900 dark:text-white">Total Pay:</span>
                            <span className="font-bold text-green-600 dark:text-green-400">{pay?.total_pay ?? 0}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-600">
                          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Daily Breakdown</h3>
                        </div>
                        <div className="overflow-x-auto max-h-96">
                          <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400">Day</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Hours</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Food</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Other</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Deduct</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Late</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
                              {(pay?.rows ?? []).map((d, i) => (
                                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                  <td className="px-4 py-2 text-sm text-slate-900 dark:text-white">{d.day}</td>
                                  <td className="px-4 py-2 text-sm text-slate-900 dark:text-white text-right">{d.hours}</td>
                                  <td className="px-4 py-2 text-sm text-slate-900 dark:text-white text-right">{d.food_allowance}</td>
                                  <td className="px-4 py-2 text-sm text-slate-900 dark:text-white text-right">{d.other_allowance}</td>
                                  <td className="px-4 py-2 text-sm text-red-600 dark:text-red-400 text-right">{d.deductions}</td>
                                  <td className="px-4 py-2 text-sm text-red-600 dark:text-red-400 text-right">{d.late_penalty}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Deductions */}
                {tab === 'deductions' && (
                  <div className="space-y-6">
                    <div className="flex items-end gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Month</label>
                        <input
                          type="month"
                          className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          value={month}
                          onChange={(e) => setMonth(e.target.value)}
                        />
                      </div>
                      <button
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                        onClick={() => setDedLoadNonce((n) => n + 1)}
                      >
                        Load
                      </button>
                      {canEdit && !addingDed && editId == null && (
                        <button
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                          onClick={startAddDed}
                        >
                          + Add Deduction
                        </button>
                      )}
                    </div>

                    {dedMsg && (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3 text-yellow-800 dark:text-yellow-200">
                        {dedMsg}
                      </div>
                    )}

                    <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Date
                              </th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Amount (IQD)
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Reason
                              </th>
                              {canEdit && (
                                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                  Actions
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
                            {/* Add row */}
                            {canEdit && addingDed && (
                              <tr className="bg-slate-50/60 dark:bg-slate-800/40">
                                <td className="px-6 py-3">
                                  <input
                                    type="date"
                                    className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                                    value={addDate}
                                    onChange={(e) => setAddDate(e.target.value)}
                                  />
                                </td>
                                <td className="px-6 py-3 text-right">
                                  <input
                                    type="number"
                                    className="px-2 py-1 w-32 text-right rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                                    value={addAmount}
                                    onChange={(e) => setAddAmount(e.target.value)}
                                  />
                                </td>
                                <td className="px-6 py-3">
                                  <input
                                    className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 w-full"
                                    value={addReason}
                                    onChange={(e) => setAddReason(e.target.value)}
                                  />
                                </td>
                                <td className="px-6 py-3 text-right">
                                  <button
                                    className="px-3 py-1 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 mr-2"
                                    onClick={cancelAddDed}
                                    disabled={dedBusy}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="px-3 py-1 rounded-md bg-blue-600 text-white disabled:opacity-50"
                                    onClick={createDed}
                                    disabled={dedBusy}
                                  >
                                    Save
                                  </button>
                                </td>
                              </tr>
                            )}

                            {/* Existing rows */}
                            {(deds ?? []).map((d: any) => {
                              const editingThis = editId === d.id
                              return (
                                <tr key={d.id}>
                                  <td className="px-6 py-3">
                                    {editingThis ? (
                                      <input
                                        type="date"
                                        className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                                        value={editDate}
                                        onChange={(e) => setEditDate(e.target.value)}
                                      />
                                    ) : (
                                      <span>{d.date ?? '—'}</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-3 text-right">
                                    {editingThis ? (
                                      <input
                                        type="number"
                                        className="px-2 py-1 w-32 text-right rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                                        value={editAmount}
                                        onChange={(e) => setEditAmount(e.target.value)}
                                      />
                                    ) : (
                                      <span>{d.amount}</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-3">
                                    {editingThis ? (
                                      <input
                                        className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 w-full"
                                        value={editReason}
                                        onChange={(e) => setEditReason(e.target.value)}
                                      />
                                    ) : (
                                      <span>{d.reason ?? '—'}</span>
                                    )}
                                  </td>
                                  {canEdit && (
                                    <td className="px-6 py-3 text-right">
                                      {editingThis ? (
                                        <>
                                          <button
                                            className="px-3 py-1 rounded-md bg-blue-600 text-white mr-2 disabled:opacity-50"
                                            onClick={saveEditDed}
                                            disabled={dedBusy}
                                          >
                                            Save
                                          </button>
                                          <button
                                            className="px-3 py-1 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100"
                                            onClick={cancelEditDed}
                                            disabled={dedBusy}
                                          >
                                            Cancel
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            className="px-3 py-1 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 mr-2"
                                            onClick={() => startEditDed(d)}
                                            disabled={dedBusy}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            className="px-3 py-1 rounded-md bg-red-600 text-white disabled:opacity-50"
                                            onClick={() => deleteDed(d)}
                                            disabled={dedBusy}
                                          >
                                            Delete
                                          </button>
                                        </>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              )
                            })}

                            {/* Empty */}
                            {(!deds || deds.length === 0) && !addingDed && (
                              <tr>
                                <td
                                  colSpan={canEdit ? 5 : 4}
                                  className="px-6 py-12 text-center text-slate-500 dark:text-slate-400"
                                >
                                  No deductions found for selected month
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
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
                            title="Record a repayment (deduct from this month’s salary)"
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

                {/* Salary History */}
                {tab === 'salary' && (
                  <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
                      <div className="p-4 border-b border-slate-200 dark:border-slate-600">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Salary Change History</h3>
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
                                <td className="px-6 py-3 text-sm text-slate-900 dark:text-white">{h.effective_from ?? h.date ?? '—'}</td>
                                <td className="px-6 py-3 text-sm text-slate-900 dark:text-white">{h.type ?? h.employment_type ?? '—'}</td>
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
   CreateEmpModal
   ========================= */
function CreateEmpModal({
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
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [vals, setVals] = useState<any>({
    name: '',
    branch: branchOptions[0] || '',
    code: '',
    uid: '',
    employment_type: 'wages',
    hourly_rate: '',
    salary_iqd: '',
    phone: '',
    joined_at: '',
  })

  const canSave =
    !!vals.name.trim() &&
    !!String(vals.branch || '').trim() &&
    ((vals.employment_type === 'wages' && String(vals.hourly_rate).length > 0) ||
      (vals.employment_type === 'salary' && String(vals.salary_iqd).length > 0))

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

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Name *</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.name}
                onChange={(e) => setVals({ ...vals, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Branch *</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.branch}
                onChange={(e) => setVals({ ...vals, branch: e.target.value })}
              >
                {branchOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Code (optional)</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.code}
                onChange={(e) => setVals({ ...vals, code: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">UID (optional)</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.uid}
                onChange={(e) => setVals({ ...vals, uid: e.target.value.toUpperCase() })}
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Employment Type *</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.employment_type}
                onChange={(e) => setVals({ ...vals, employment_type: e.target.value })}
              >
                <option value="wages">wages</option>
                <option value="salary">salary</option>
              </select>
            </div>

            {vals.employment_type === 'wages' ? (
              <div>
                <label className="block text-sm mb-1">Hourly Rate *</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                  value={vals.hourly_rate}
                  onChange={(e) => setVals({ ...vals, hourly_rate: e.target.value })}
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
                />
              </div>
            )}

            <div>
              <label className="block text-sm mb-1">Phone</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                value={vals.phone}
                onChange={(e) => setVals({ ...vals, phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Joined At</label>
            <input
              type="date"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
              value={vals.joined_at}
              onChange={(e) => setVals({ ...vals, joined_at: e.target.value })}
            />
          </div>

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
                  const payload: any = {
                    name: vals.name.trim(),
                    branch: vals.branch.trim(),
                    code: vals.code.trim() || undefined,
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
