// src/pages/Settings/LatePolicyCard.tsx
import React from 'react'
import { useAuthStore } from '@/store/auth'
import { getLatePolicy, putLatePolicy, type LatePolicy } from '@/api/payroll'

const DEFAULTS: LatePolicy = {
  workday_start: '08:30',
  grace_min: 0,
  mode: 'per_minute',
  per_minute_iqd: 0,
  block_minutes: 0,
  per_block_iqd: 0,
  cap_per_day_iqd: 0,
  exclude_weekends: false,
}

export default function LatePolicyCard() {
  const role = useAuthStore(s => s.role?.toLowerCase?.() || '')
  const isAdmin = role === 'admin'

  const [branch, setBranch] = React.useState<string>('') // empty = global policy
  const [policy, setPolicy] = React.useState<LatePolicy>(DEFAULTS)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!isAdmin) return
    setLoading(true)
    getLatePolicy(branch)
      .then(p => setPolicy(p ?? DEFAULTS))
      .catch(() => alert('Failed to load late policy'))
      .finally(() => setLoading(false))
  }, [branch, isAdmin])

  if (!isAdmin) return null // hide for non-admins (endpoint is admin-only)

  function save() {
    setLoading(true)
    putLatePolicy(policy, branch || undefined)
      .then(() => alert('Late policy saved'))
      .catch(() => alert('Failed to save late policy'))
      .finally(() => setLoading(false))
  }

  return (
    <div className="rounded-2xl bg-zinc-900/5 dark:bg-zinc-800 p-6 shadow-sm card border border-border/50 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <h3 className="font-semibold text-lg">Late Policy</h3>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Branch (blank = global)</span>
          <input className="input" value={branch} onChange={e => setBranch(e.target.value)} placeholder="e.g. Basra" />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Workday start (HH:MM)</span>
          <input className="input" value={policy.workday_start || ''} onChange={e => setPolicy({ ...policy, workday_start: e.target.value })} />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Grace (minutes)</span>
          <input type="number" className="input" value={policy.grace_min ?? 0}
            onChange={e => setPolicy({ ...policy, grace_min: Number(e.target.value) })}/>
        </label>

        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Mode</span>
          <select className="input" value={policy.mode || 'per_minute'}
            onChange={e => setPolicy({ ...policy, mode: e.target.value as any })}>
            <option value="per_minute">Per minute</option>
            <option value="per_block">Per block</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Amount per minute (IQD)</span>
          <input type="number" className="input" value={policy.per_minute_iqd ?? 0}
            onChange={e => setPolicy({ ...policy, per_minute_iqd: Number(e.target.value) })}/>
        </label>

        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Block minutes</span>
          <input type="number" className="input" value={policy.block_minutes ?? 0}
            onChange={e => setPolicy({ ...policy, block_minutes: Number(e.target.value) })}/>
        </label>

        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Amount per block (IQD)</span>
          <input type="number" className="input" value={policy.per_block_iqd ?? 0}
            onChange={e => setPolicy({ ...policy, per_block_iqd: Number(e.target.value) })}/>
        </label>

        <label className="space-y-1">
          <span className="text-sm text-muted-foreground">Cap per day (IQD)</span>
          <input type="number" className="input" value={policy.cap_per_day_iqd ?? 0}
            onChange={e => setPolicy({ ...policy, cap_per_day_iqd: Number(e.target.value) })}/>
        </label>

        <label className="inline-flex items-center gap-2 mt-2">
          <input type="checkbox" checked={!!policy.exclude_weekends}
            onChange={e => setPolicy({ ...policy, exclude_weekends: e.target.checked })}/>
          <span className="text-sm">Exclude weekends (Sat/Sun)</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button disabled={loading} onClick={save} className="px-5 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-60">
          {loading ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </div>
  )
}
