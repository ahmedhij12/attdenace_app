import React, { useEffect, useMemo, useState } from 'react'
import { BRANCHES } from '@/api/client'
import type { DeviceInfo } from '@/types/models'
import { useAuthStore } from '@/store/auth'

type Me = { username: string; email: string; role: 'admin'|'manager'|string; allowed_branches: string[] }

export default function Devices() {
  const [rows, setRows] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [show, setShow] = useState(false)

  // NOTE: "Name" field removed — we'll use branch as the device name on create.
  const [branch, setBranch] = useState('')
  const [type, setType] = useState('ESP32')

  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [typeOptions, setTypeOptions] = useState<string[]>(['ESP32'])
  const [newKey, setNewKey] = useState<string | null>(null)

  // role/scope
  const [me, setMe] = useState<Me|null>(null)
  const isManager = (me?.role || '').toLowerCase() === 'manager'
  const allowed = useMemo(()=> me?.allowed_branches ?? [], [me])

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
  async function handle<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(()=> '')
      throw new Error(text || `HTTP ${res.status}`)
    }
    return res.json()
  }

  // ---------- direct API calls (no shared api object) ----------
  async function apiGetDevices(): Promise<DeviceInfo[]> {
    const res = await fetch(`${getApiBase()}/devices`, { headers: { ...tokenHeader() } })
    const list: any[] = await handle<any[]>(res)
    return (Array.isArray(list) ? list : []).map((d: any) => ({
      id: Number(d.id ?? d.device_id ?? d.ID ?? 0),
      name: String(d.name ?? d.device_name ?? d.branch ?? 'Device'),
      branch: String(d.branch ?? d.branch_name ?? ''),
      type: String(d.type ?? d.device_type ?? 'ESP32'),
      online: Boolean(d.online ?? d.is_online ?? false),
      port: d.port ?? d.listen_port ?? '',
      ip: d.ip ?? d.address ?? '',
      lastSeen: d.lastSeen ?? d.last_seen ?? d.last_ping ?? d.updated_at ?? null,
    }))
  }

  async function apiCreateDevice(payload: { name: string; branch: string; type: string }): Promise<string> {
    const res = await fetch(`${getApiBase()}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tokenHeader() },
      body: JSON.stringify(payload),
    })
    const data: any = await handle<any>(res)
    // accept various server shapes
    return String(data.key ?? data.api_key ?? data.device_key ?? data.secret ?? data.token ?? '')
  }

  async function apiRegenKey(id: number): Promise<string> {
    const endpoints = [
      `${getApiBase()}/devices/${id}/regenerate`,
      `${getApiBase()}/devices/${id}/key`,
      `${getApiBase()}/devices/${id}/regen`,
    ]
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { ...tokenHeader(), 'Content-Type': 'application/json' },
        })
        if (!res.ok) continue
        const data: any = await res.json().catch(() => ({}))
        return String(data.key ?? data.api_key ?? data.device_key ?? data.secret ?? data.token ?? '')
      } catch { /* try next */ }
    }
    throw new Error('Failed to regenerate device key')
  }

  async function apiDeleteDevice(id: number): Promise<void> {
    const res = await fetch(`${getApiBase()}/devices/${id}`, {
      method: 'DELETE',
      headers: { ...tokenHeader() },
    })
    if (!res.ok) throw new Error(await res.text().catch(()=> 'Failed to delete device'))
  }

  // ---------- user profile ----------
  function normalizeMe(d:any):Me{
    const role = String(d?.role || d?.user?.role || 'manager').toLowerCase()
    const raw = Array.isArray(d?.allowed_branches) ? d.allowed_branches
              : Array.isArray(d?.branch_ids) ? d.branch_ids
              : Array.isArray(d?.branches) ? d.branches
              : Array.isArray(d?.allowedBranches) ? d.allowedBranches : []
    const allowed_branches = Array.from(new Set(raw.map((b:any)=>String(b)).filter(Boolean)))
    return { username: d?.username || '', email: d?.email || '', role, allowed_branches }
  }
  async function loadMe() {
    try {
      const res = await fetch(`${getApiBase()}/auth/me`, { headers: tokenHeader() })
      if (res.ok) setMe(normalizeMe(await res.json()))
    } catch {}
  }

  const uniq = (arr: string[]) =>
    Array.from(new Set(arr.map(s => String(s).trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))

  // Build options from devices + static list (no /branches probe to avoid 404)
  async function loadOptions() {
    try {
      const devs = await apiGetDevices()

      // Branch options
      const fromDevices = uniq(devs.map((d:any) => String(d?.branch ?? d?.branch_name ?? '')))
      const fromStatic = Array.isArray(BRANCHES) ? uniq(BRANCHES.map(String)) : []
      setBranchOptions(uniq([...fromStatic, ...fromDevices]))

      // Type options (free-text with suggestions)
      const defaults = ['ESP32', 'ESP8266', 'RaspberryPi', 'Arduino', 'Relay', 'Controller']
      const fromTypes = uniq(devs.map((d:any) => String(d?.type ?? '')))
      setTypeOptions(uniq([...defaults, ...fromTypes]))
    } catch {
      setBranchOptions(Array.isArray(BRANCHES) ? uniq(BRANCHES.map(String)) : [])
      setTypeOptions(['ESP32'])
    }
  }

  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await apiGetDevices()
      const scoped = (isManager && allowed.length)
        ? data.filter(d => allowed.includes(String(d.branch ?? '')))
        : data
      setRows(scoped)
    } catch (e:any) {
      setError(e?.message ?? 'Failed to load devices')
    } finally { setLoading(false) }
  }

  useEffect(() => { loadMe() }, [])
  useEffect(() => { load(); loadOptions() }, [me?.role, JSON.stringify(allowed)])

  async function createDevice(e: React.FormEvent) {
    e.preventDefault()
    if (isManager) { alert('Read-only role: managers cannot add devices.'); return }
    try {
      if (!branch.trim()) { alert('Please enter a branch'); return }
      if (!type.trim()) { alert('Please enter a type'); return }

      setLoading(true); setError(null)

      // "Name" removed — use branch as the device name
      const key = await apiCreateDevice({ name: branch.trim(), branch: branch.trim(), type: type.trim() })
      setShow(false); setBranch(''); setType(typeOptions[0] || 'ESP32'); setNewKey(key)
      await load(); await loadOptions()
    } catch (e:any) {
      setError(e?.message ?? 'Failed to create device')
    } finally { setLoading(false) }
  }
  async function regen(id: number) {
    if (isManager) { alert('Read-only role: managers cannot regenerate keys.'); return }
    try { const key = await apiRegenKey(id); setNewKey(key) }
    catch (e:any) { alert(e?.message ?? 'Failed to regenerate key') }
  }
  async function remove(id: number) {
    if (isManager) { alert('Read-only role: managers cannot delete devices.'); return }
    if (!confirm('Delete device?')) return
    try { setLoading(true); await apiDeleteDevice(id); await load(); await loadOptions() }
    catch (e:any) { setError(e?.message ?? 'Failed to delete device') }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Device Management</h1>
          <p className="text-muted-foreground mt-1">Monitor and manage your connected devices</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${
            isManager 
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100' 
              : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100'
          }`}>
            {isManager ? 'Manager View' : 'Admin Access'}
          </div>
          <button 
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200"
            onClick={() => { 
              if (isManager) { 
                alert('Read-only role: managers cannot add devices.'); 
                return 
              } 
              setShow(true) 
            }}
          >
            Add New Device
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-6 py-4 rounded-2xl shadow-lg">
          {error}
        </div>
      )}

      {/* Device List */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-500"></div>
              <h3 className="font-semibold text-lg">Connected Devices</h3>
            </div>
            <p className="text-sm text-muted-foreground">Real-time status and management of all devices</p>
          </div>
          <div className="text-sm text-muted-foreground">
            {rows.length} device{rows.length !== 1 ? 's' : ''} total
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Port</th>
                <th className="px-3 py-2 font-medium">IP Address</th>
                <th className="px-3 py-2 font-medium">Last Seen</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={9}>Loading devices...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={9}>
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">📱</div>
                    No devices found
                  </div>
                </td></tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/50 transition-colors border-b border-border/50">
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">#{d.id}</td>
                    <td className="px-3 py-3 font-medium">{d.name}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                        {d.branch}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                        {d.type}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        d.online 
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
                      }`}>
                        {d.online ? '🟢 Online' : '🔴 Offline'}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{d.port || '-'}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{d.ip || '-'}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '-'}</td>
                    <td className="px-3 py-3 text-right space-x-2">
                      <button 
                        className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-xs font-medium shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                        onClick={() => regen(d.id)}
                      >
                        🔄 Regen
                      </button>
                      <button 
                        className="px-3 py-1.5 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-lg text-xs font-medium shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                        onClick={() => remove(d.id)}
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

      {/* Add Device Modal */}
      {show && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center p-4 z-50">
          <form onSubmit={createDevice} className="bg-background rounded-3xl shadow-2xl border border-border w-full max-w-2xl space-y-6 p-8">
            <div className="text-center">
              <div className="text-2xl font-bold mb-2">Add New Device</div>
              <p className="text-muted-foreground">Configure a new device for your system</p>
            </div>

            <div className="space-y-6">
              <Field label="Branch Location">
                <input
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground"
                  value={branch}
                  onChange={e=>setBranch(e.target.value)}
                  list="branch-list"
                  placeholder="Select or enter branch location"
                />
                <datalist id="branch-list">
                  {branchOptions.map(b => <option key={b} value={b} />)}
                </datalist>
              </Field>

              <Field label="Device Type">
                <input
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground"
                  value={type}
                  onChange={e=>setType(e.target.value)}
                  list="type-list"
                  placeholder="Select or enter device type"
                />
                <datalist id="type-list">
                  {typeOptions.map(t => <option key={t} value={t} />)}
                </datalist>
              </Field>
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t border-border">
              <button 
                type="button" 
                className="px-6 py-3 bg-muted hover:bg-muted/80 text-foreground rounded-xl font-medium transition-all duration-200 shadow-md hover:shadow-lg"
                onClick={()=>setShow(false)}
              >
                Cancel
              </button>
              <button 
                className="px-8 py-3 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200" 
                type="submit"
              >
                Create Device
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Generated Key Display */}
      {newKey && (
        <div className="card border-l-4 border-l-emerald-500">
          <div className="flex items-start gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <h3 className="font-semibold text-lg">Device Key Generated</h3>
              </div>
              <p className="text-sm text-muted-foreground">Copy this key to configure your device</p>
            </div>
            <button
              onClick={() => setNewKey(null)}
              className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-muted-foreground rounded-lg text-xs transition-colors"
            >
              Dismiss
            </button>
          </div>
          
          <div className="mt-6">
            <code className="block p-4 bg-muted border border-border rounded-xl text-sm font-mono break-all shadow-inner">
              {newKey}
            </code>
            <div className="mt-4 p-3 bg-amber-100 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                ⚠️ <strong>Important:</strong> Save this key securely. It won't be shown again and is required for device authentication.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2 block">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  )
}
