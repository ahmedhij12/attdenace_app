import React, { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Calendar, Building2, Pencil, Trash2, PlusCircle } from 'lucide-react'
import { BRANCHES } from '@/api/client'
import {
  getPayroll,
  type PayrollRow,
  listAdjustments, createAdjustment, updateAdjustment, deleteAdjustment,
  listDeductions, createDeduction, updateDeduction, deleteDeduction
} from '@/api/payroll'
import { useAuthStore } from '@/store/auth'

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

  const clientDefault = monthRange()
  const [from, setFrom] = useState(clientDefault.from)
  const [to, setTo] = useState(clientDefault.to)
  const [branch, setBranch] = useState<string>('All')
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Manage "Other Allowance"
  const [oaOpen, setOaOpen] = useState<{ uid: string, name: string } | null>(null)
  const [oaList, setOaList] = useState<any[]>([])
  const [oaNewAmount, setOaNewAmount] = useState<string>('0')
  const [oaNewNote, setOaNewNote] = useState<string>('')

  // Manage Deductions
  const [dedOpen, setDedOpen] = useState<{ uid: string, name: string } | null>(null)
  const [dedList, setDedList] = useState<any[]>([])
  const [dedNewAmount, setDedNewAmount] = useState<string>('0')
  const [dedNewDate, setDedNewDate] = useState<string>(clientDefault.from) // default to start of period
  const [dedNewNote, setDedNewNote] = useState<string>('')

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

  async function load() {
    try {
      setLoading(true); setError(null)
      const data = await getPayroll({ from, to, branch })
      // Adopt server period once (from first row meta.period)
      if (!adoptedServerPeriod && data?.length && data[0]?.meta?.period) {
        const p = data[0].meta.period
        const srvFrom = p?.from, srvTo = p?.to
        if (typeof srvFrom === 'string' && typeof srvTo === 'string' && (srvFrom !== from || srvTo !== to)) {
          setFrom(srvFrom); setTo(srvTo); setAdoptedServerPeriod(true)
          // trigger reload after changing period
          return
        }
        setAdoptedServerPeriod(true)
      }
      setRows(data)
    } catch (e:any) {
      const msg = (e?.message || '').toLowerCase()
      if (msg.includes('not found') || msg.includes('404')) { setRows([]); setError(null) }
      else { setError(e?.message || 'Failed to load payroll'); setRows([]) }
    } finally { setLoading(false) }
  }

  useEffect(() => { if (allowed) load() }, [from, to, branch, adoptedServerPeriod, allowed])

  function exportCSV() {
    const header = [
      'Code','Name','Branch','Nationality', ...days,
      'Total Hours','Food Allowance','Other Allowance','Deductions','Late Penalty','Base Salary','Total Pay'
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

  // ---------- Other Allowance modal helpers ----------
  async function openOtherAllowance(uid: string, name: string) {
    try {
      setLoading(true)
      const list = await listAdjustments(uid, from, to)
      setOaList(list)
      setOaOpen({ uid, name })
      setOaNewAmount('0'); setOaNewNote('')
    } catch (e:any) {
      alert(e?.message || 'Failed to load other allowance entries')
    } finally { setLoading(false) }
  }

  async function addOtherAllowance() {
    if (!oaOpen?.uid) return
    const amt = Number(oaNewAmount || '0')
    if (Number.isNaN(amt)) return alert('Invalid amount')
    try {
      setLoading(true)
      await createAdjustment({ uid: oaOpen.uid, from, to, amount_iqd: Math.round(amt), note: oaNewNote || undefined })
      const list = await listAdjustments(oaOpen.uid, from, to)
      setOaList(list)
      await load()
      setOaNewAmount('0'); setOaNewNote('')
    } catch (e:any) {
      alert(e?.message || 'Failed to add other allowance')
    } finally { setLoading(false) }
  }

  async function saveOtherRow(id: number, amount_iqd: number, note: string) {
    try {
      setLoading(true)
      await updateAdjustment(id, { amount_iqd: Math.round(amount_iqd), note })
      if (oaOpen?.uid) {
        const list = await listAdjustments(oaOpen.uid, from, to)
        setOaList(list)
      }
      await load()
    } catch (e:any) {
      alert(e?.message || 'Failed to update other allowance')
    } finally { setLoading(false) }
  }

  async function deleteOtherRow(id: number) {
    if (!confirm('Delete this other allowance entry?')) return
    try {
      setLoading(true)
      await deleteAdjustment(id)
      if (oaOpen?.uid) {
        const list = await listAdjustments(oaOpen.uid, from, to)
        setOaList(list)
      }
      await load()
    } catch (e:any) {
      alert(e?.message || 'Failed to delete other allowance')
    } finally { setLoading(false) }
  }

  // ---------- Deductions modal helpers ----------
  async function openDeductions(uid: string, name: string) {
    try {
      setLoading(true)
      const list = await listDeductions(uid, from, to)
      setDedList(list)
      setDedOpen({ uid, name })
      setDedNewAmount('0')
      setDedNewDate(from)
      setDedNewNote('')
    } catch (e:any) {
      alert(e?.message || 'Failed to load deductions')
    } finally { setLoading(false) }
  }

  async function addDeduction() {
    if (!dedOpen?.uid) return
    const amt = Number(dedNewAmount || '0')
    if (Number.isNaN(amt)) return alert('Invalid amount')
    if (!dedNewDate) return alert('Pick a date')
    try {
      setLoading(true)
      await createDeduction({ uid: dedOpen.uid, date: dedNewDate, amount_iqd: Math.round(amt), note: dedNewNote || undefined })
      const list = await listDeductions(dedOpen.uid, from, to)
      setDedList(list)
      await load()
      setDedNewAmount('0'); setDedNewNote('')
    } catch (e:any) {
      alert(e?.message || 'Failed to add deduction')
    } finally { setLoading(false) }
  }

  async function saveDedRow(id: number, date: string, amount_iqd: number, note: string) {
    try {
      setLoading(true)
      await updateDeduction(id, { date, amount_iqd: Math.round(amount_iqd), note })
      if (dedOpen?.uid) {
        const list = await listDeductions(dedOpen.uid, from, to)
        setDedList(list)
      }
      await load()
    } catch (e:any) {
      alert(e?.message || 'Failed to update deduction')
    } finally { setLoading(false) }
  }

  async function deleteDedRow(id: number) {
    if (!confirm('Delete this deduction entry?')) return
    try {
      setLoading(true)
      await deleteDeduction(id)
      if (dedOpen?.uid) {
        const list = await listDeductions(dedOpen.uid, from, to)
        setDedList(list)
      }
      await load()
    } catch (e:any) {
      alert(e?.message || 'Failed to delete deduction')
    } finally { setLoading(false) }
  }

  if (!allowed) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payroll</h1>
          <p className="text-muted-foreground mt-1">Employee payroll management</p>
        </div>
        <div className="card">
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
          <p className="text-muted-foreground mt-1">Employee payroll management and reporting</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100">
            {role.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard title="Employees" value={summary.employees} subtitle={`${branch !== 'All' ? branch : 'All branches'}`} />
        <StatCard title="Total Hours" value={summary.totalHours.toLocaleString()} subtitle={`${days.length} days period`} />
        <StatCard title="Total Payroll" value={`${summary.totalPay.toLocaleString()} IQD`} subtitle="Current period" />
        <StatCard title="Average Pay" value={`${Math.round(summary.avgPay).toLocaleString()} IQD`} subtitle="Per employee" />
      </div>

      {/* Controls */}
      <div className="card">
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
            <input type="date" value={from} onChange={e => { setAdoptedServerPeriod(true); setFrom(e.target.value) }} className="input" />
          </Field>
          <Field label="To Date" icon={<Calendar className="w-4 h-4" />}>
            <input type="date" value={to} onChange={e => { setAdoptedServerPeriod(true); setTo(e.target.value) }} className="input" />
          </Field>
          <Field label="Branch" icon={<Building2 className="w-4 h-4" />}>
            <select value={branch} onChange={e => setBranch(e.target.value)} className="input min-w-[160px]">
              {BRANCHES.map(b => (<option key={b} value={b}>{b}</option>))}
            </select>
          </Field>
          <div className="flex gap-2">
            <button onClick={load} disabled={loading} className="btn-primary inline-flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Loading...' : 'Reload'}
            </button>
            <button onClick={exportCSV} disabled={!rows.length} className="btn inline-flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
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
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/50 border-b border-border/50">
                <Th sticky className="bg-background border-r border-border/50">Code</Th>
                <Th sticky className="bg-background border-r border-border/50">Name</Th>
                <Th>Branch</Th>
                <Th>Nationality</Th>
                {days.map(d => (<Th key={d} center className="min-w-[50px]">{d.slice(-2)}</Th>))}
                <Th center>Total Hours</Th>
                <Th center>Food Allowance</Th>
                <Th center>Other Allowance</Th>
                <Th center>Deductions</Th>
                <Th center>Late Coming Penalty</Th>
                <Th center>Base Salary</Th>
                <Th center className="font-semibold">Total Pay</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12 + days.length} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
                      <p className="text-muted-foreground">Loading payroll data...</p>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12 + days.length} className="px-6 py-12 text-center">
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
                rows.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/30 transition-colors border-b border-border/30">
                    <Td sticky className="font-mono text-xs bg-background border-r border-border/50">{r.code ?? ''}</Td>
                    <Td sticky className="font-medium bg-background border-r border-border/50">{r.name}</Td>
                    <Td className="text-muted-foreground">{r.branch}</Td>
                    <Td className="capitalize text-muted-foreground">{r.nationality}</Td>
                    {days.map(d => (
                      <Td key={d} center className="font-mono tabular-nums">
                        <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-medium ${
                          (r.days?.[d] || 0) > 0 
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300' 
                            : 'text-muted-foreground'
                        }`}>{r.days?.[d] ?? 0}</span>
                      </Td>
                    ))}
                    <Td center className="font-mono tabular-nums font-medium">{r.totals?.hours ?? 0}</Td>
                    <Td center className="font-mono tabular-nums">
                      {(r.totals?.food_allowance_iqd ?? 0).toLocaleString()}
                    </Td>
                    <Td center className="font-mono tabular-nums">
                      <div className="inline-flex items-center gap-2">
                        {(r.totals?.other_allowance_iqd ?? 0).toLocaleString()}
                        <button
                          className="inline-flex items-center gap-1 text-xs underline opacity-70 hover:opacity-100"
                          onClick={() => openOtherAllowance((r as any).uid || (r as any).meta?.uid || '', r.name)}
                          title="Manage other allowances"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      </div>
                    </Td>
                    <Td center className="font-mono tabular-nums">
                      <div className="inline-flex items-center gap-2">
                        {(r.totals?.deductions_iqd ?? 0).toLocaleString()}
                        <button
                          className="inline-flex items-center gap-1 text-xs underline opacity-70 hover:opacity-100"
                          onClick={() => openDeductions((r as any).uid || (r as any).meta?.uid || '', r.name)}
                          title="Manage deductions"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      </div>
                    </Td>
                    <Td center className="font-mono tabular-nums">
                      {(r.totals?.late_penalty_iqd ?? 0).toLocaleString()}
                    </Td>
                    <Td center className="font-mono tabular-nums">{(r.totals?.base_salary_iqd ?? 0).toLocaleString()}</Td>
                    <Td center className="font-semibold font-mono tabular-nums">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                        {(r.totals?.total_pay_iqd ?? 0).toLocaleString()} IQD
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Other Allowance Manager */}
      {oaOpen && (
        <Modal onClose={() => setOaOpen(null)} title={`Other Allowances — ${oaOpen.name}`}>
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-sm text-muted-foreground">Amount (IQD)</label>
                <input type="number" min={0} className="input w-full" value={oaNewAmount} onChange={e => setOaNewAmount(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="text-sm text-muted-foreground">Note (optional)</label>
                <input className="input w-full" value={oaNewNote} onChange={e => setOaNewNote(e.target.value)} />
              </div>
              <button className="btn-primary inline-flex items-center gap-2" onClick={addOtherAllowance}>
                <PlusCircle className="w-4 h-4" /> Add
              </button>
            </div>

            <div className="rounded-xl border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>Date From</Th>
                    <Th>Date To</Th>
                    <Th center>Amount</Th>
                    <Th>Note</Th>
                    <Th center>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {oaList.length === 0 ? (
                    <tr><Td colSpan={5} className="text-center text-muted-foreground py-6">No entries</Td></tr>
                  ) : oaList.map((a: any) => <OAItem key={a.id} item={a} onSave={saveOtherRow} onDelete={deleteOtherRow} />)}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {/* Deductions Manager */}
      {dedOpen && (
        <Modal onClose={() => setDedOpen(null)} title={`Deductions — ${dedOpen.name}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-sm text-muted-foreground">Date</label>
                <input type="date" className="input w-full" value={dedNewDate} onChange={e => setDedNewDate(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Amount (IQD)</label>
                <input type="number" min={0} className="input w-full" value={dedNewAmount} onChange={e => setDedNewAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Note (optional)</label>
                <input className="input w-full" value={dedNewNote} onChange={e => setDedNewNote(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary inline-flex items-center gap-2" onClick={addDeduction}>
                <PlusCircle className="w-4 h-4" /> Add
              </button>
            </div>

            <div className="rounded-xl border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>Date</Th>
                    <Th center>Amount</Th>
                    <Th>Note</Th>
                    <Th center>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {dedList.length === 0 ? (
                    <tr><Td colSpan={4} className="text-center text-muted-foreground py-6">No entries</Td></tr>
                  ) : dedList.map((d: any) => <DedItem key={d.id} item={d} onSave={saveDedRow} onDelete={deleteDedRow} />)}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}{label}
      </label>
      {children}
    </div>
  )
}

function StatCard({ title, value, subtitle }: { title: string; value: React.ReactNode; subtitle?: string }) {
  return (
    <div className="rounded-2xl bg-muted/30 dark:bg-muted/20 p-6 shadow-sm border hover:shadow-md transition-shadow border-border/50">
      <div className="text-sm text-muted-foreground font-medium">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
    </div>
  )
}

function Th({ children, center, sticky, className = '' }: { children: React.ReactNode; center?: boolean; sticky?: boolean; className?: string }) {
  return (
    <th className={`px-3 py-3 whitespace-nowrap font-medium text-muted-foreground text-xs uppercase tracking-wide ${sticky ? 'sticky left-0 z-20' : ''} ${center ? 'text-center' : 'text-left'} ${className}`} style={sticky ? { minWidth: 140 } : undefined}>{children}</th>
  )
}
function Td({ children, center, sticky, className = '', colSpan }: { children: React.ReactNode; center?: boolean; sticky?: boolean; className?: string; colSpan?: number }) {
  return (
    <td className={`px-3 py-3 ${sticky ? 'sticky left-0 z-10' : ''} ${center ? 'text-center' : ''} ${className}`} style={sticky ? { minWidth: 180 } : undefined} colSpan={colSpan}>{children}</td>
  )
}

/** Generic modal shell */
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center p-4 z-50">
      <div className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{title}</div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Row item for Other Allowance list with inline edit/delete */
function OAItem({ item, onSave, onDelete }: { item: any; onSave: (id: number, amount_iqd: number, note: string) => void; onDelete: (id: number) => void }) {
  const [amt, setAmt] = useState<string>(String(item.amount_iqd ?? 0))
  const [note, setNote] = useState<string>(item.note ?? '')
  const [saving, setSaving] = useState(false)
  return (
    <tr className="border-b border-border/30">
      <Td>{item.date_from}</Td>
      <Td>{item.date_to}</Td>
      <Td center>
        <input type="number" className="input w-40 text-center" value={amt} onChange={e => setAmt(e.target.value)} />
      </Td>
      <Td>
        <input className="input w-full" value={note} onChange={e => setNote(e.target.value)} />
      </Td>
      <Td center>
        <div className="inline-flex gap-2">
          <button
            className="btn-primary px-2 py-1 text-xs"
            disabled={saving}
            onClick={async () => { setSaving(true); await onSave(item.id, Number(amt || 0), note); setSaving(false) }}
          >
            Save
          </button>
          <button className="btn px-2 py-1 text-xs inline-flex items-center gap-1" onClick={() => onDelete(item.id)}>
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      </Td>
    </tr>
  )
}

/** Row item for Deductions list with inline edit/delete */
function DedItem({ item, onSave, onDelete }: { item: any; onSave: (id: number, date: string, amount_iqd: number, note: string) => void; onDelete: (id: number) => void }) {
  const [date, setDate] = useState<string>(item.date)
  const [amt, setAmt] = useState<string>(String(item.amount_iqd ?? 0))
  const [note, setNote] = useState<string>(item.note ?? '')
  const [saving, setSaving] = useState(false)
  return (
    <tr className="border-b border-border/30">
      <Td>
        <input type="date" className="input w-40" value={date} onChange={e => setDate(e.target.value)} />
      </Td>
      <Td center>
        <input type="number" className="input w-40 text-center" value={amt} onChange={e => setAmt(e.target.value)} />
      </Td>
      <Td>
        <input className="input w-full" value={note} onChange={e => setNote(e.target.value)} />
      </Td>
      <Td center>
        <div className="inline-flex gap-2">
          <button
            className="btn-primary px-2 py-1 text-xs"
            disabled={saving}
            onClick={async () => { setSaving(true); await onSave(item.id, date, Number(amt || 0), note); setSaving(false) }}
          >
            Save
          </button>
          <button className="btn px-2 py-1 text-xs inline-flex items-center gap-1" onClick={() => onDelete(item.id)}>
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      </Td>
    </tr>
  )
}
