// src/pages/Settings.tsx
import React, { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { api } from '@/api/client'
import { useNavigate } from 'react-router-dom'

type UserRow = {
  username: string
  email: string
  role: 'admin' | 'manager' | 'hr'
  allowed_branches: string[]
}

export default function Settings() {
  const theme = useAuthStore((s) => s.theme)
  const toggleTheme = useAuthStore((s) => s.toggleTheme)
  const sessionRole = useAuthStore((s) => (s as any).role) as string | undefined
  const navigate = useNavigate()

  // me (to decide if admin)
  const [me, setMe] = useState<UserRow | null>(null)
  // ✅ Show User Management for admin/HR; also trust store role so the block never disappears
  const isAdmin = ['admin', 'hr'].includes(
    ((me?.role as any) || sessionRole || '').toString().toLowerCase()
  )

  // Change password
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  // Admin: users + branches
  const [users, setUsers] = useState<UserRow[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [errorUsers, setErrorUsers] = useState<string | null>(null)

  // branch suggestions (built from live data)
  const [branchOptions, setBranchOptions] = useState<string[]>([])

  // create user form
  const [newUser, setNewUser] = useState<UserRow>({
    username: '',
    email: '',
    role: 'manager',
    allowed_branches: [],
  } as any)
  const [newUserPassword, setNewUserPassword] = useState('')

  const validPw =
    !!oldPw && !!newPw && newPw.length >= 8 && confirmPw === newPw && oldPw !== newPw

  // ---------- helpers: API base + token ----------
  function getApiBase(): string {
    const env = (import.meta as any)?.env?.VITE_API_URL as string | undefined
    if (env) return env.replace(/\/+$/, '')

    // 🔧 Fix: when running on the Pages app domain, talk to the API domain
    const host = window.location.hostname
    if (host === 'app.hijazionline.org') return 'https://api.hijazionline.org'

    // dev / other cases (e.g., Vite on 5173)
    const url = new URL(window.location.href)
    const port = url.port === '5173' ? '8000' : url.port
    return `${url.protocol}//${url.hostname}${port ? ':' + port : ''}`
  }

  function getToken(): string {
    try {
      const s: any = (useAuthStore as any)?.getState?.()
      const t = s?.token || s?.accessToken
      return (
        t ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('token') ||
        ''
      )
    } catch {
      return (
        localStorage.getItem('auth_token') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('token') ||
        ''
      )
    }
  }

  async function authed<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${getApiBase()}${path}`, {
      ...(init || {}),
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    return (await res.json()) as T
  }
  // ------------------------------------------------

  function signOut() {
    try { (useAuthStore as any).getState().setSession('', '', '') } catch {}
    localStorage.removeItem('token')
    localStorage.removeItem('auth_token')
    localStorage.removeItem('access_token')
    navigate('/login', { replace: true })
  }

  // ----- Change password -----
  async function changePw() {
    if (!validPw || busy) return
    setBusy(true)
    setMsg('')
    try {
      await api.changePassword(oldPw, newPw)
      setMsg('✅ Password updated. You will be signed out...')
      setOldPw(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => {
        try {
          (useAuthStore as any).getState().setSession('', '', '')
          localStorage.removeItem('token')
          localStorage.removeItem('auth_token')
          localStorage.removeItem('access_token')
        } catch {}
        navigate('/login', { replace: true })
      }, 900)
    } catch (e: any) {
      setMsg('❌ ' + (e?.message || 'Failed to update password'))
    } finally {
      setBusy(false)
    }
  }

  // ----- Admin: load me/users/branches -----
  async function loadMe() {
    try {
      const data = await authed<UserRow>('/auth/me')
      const raw = String((data as any).role ?? 'manager').toLowerCase().trim()
      const norm = raw.includes('admin') ? 'admin' : raw.includes('hr') ? 'hr' : 'manager'
      setMe({
        username: (data as any).username,
        email: (data as any).email || '',
        role: norm as any,
        allowed_branches: Array.isArray((data as any).allowed_branches)
          ? (data as any).allowed_branches
          : [],
      })
    } catch {
      // fall back to store role; UI gating already uses sessionRole
    }
  }

  async function loadUsers() {
    setLoadingUsers(true); setErrorUsers(null)
    try {
      const data = await authed<UserRow[]>('/auth/users')
      setUsers(data)
    } catch {
      setErrorUsers('Failed to load users')
    } finally {
      setLoadingUsers(false)
    }
  }

  async function loadBranchOptions() {
    try {
      const [emps, devs] = await Promise.all([api.getEmployees({}), api.getDevices()])
      const set = new Set<string>()
      for (const e of emps as any[]) if (e.branch) set.add(String(e.branch))
      for (const d of devs as any[]) if (d.branch) set.add(String(d.branch))
      setBranchOptions(Array.from(set).filter(Boolean).sort())
    } catch {
      // ignore
    }
  }

  useEffect(() => { loadMe() }, [])
  useEffect(() => {
    if (isAdmin) {
      loadUsers()
      loadBranchOptions()
    }
  }, [isAdmin])

  // ----- Admin: user actions -----
  async function createUser() {
    if (!newUser.username || !newUserPassword) {
      alert('Username and password are required')
      return
    }
    try {
      await authed('/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUser.username.trim(),
          password: newUserPassword,
          email: newUser.email || null,
          role: newUser.role, // backend accepts only 'admin' | 'manager'
          allowed_branches: newUser.role === 'manager' ? newUser.allowed_branches : [],
        }),
      })
      // reset form
      setNewUser({ username: '', email: '', role: 'manager', allowed_branches: [] } as any)
      setNewUserPassword('')
      await loadUsers()
      alert('User created')
    } catch {
      alert('Create failed (maybe username exists or invalid role)')
    }
  }

  async function updateUser(u: UserRow, patch: Partial<UserRow> & { password?: string }) {
    try {
      await authed(`/auth/users/${encodeURIComponent(u.username)}`, {
        method: 'PUT',
        body: JSON.stringify({
          email: patch.email ?? u.email,
          role: patch.role ?? u.role,
          allowed_branches:
            (patch.role ?? u.role) === 'manager'
              ? (patch.allowed_branches ?? u.allowed_branches)
              : [],
          ...(patch as any).password ? { password: (patch as any).password } : {},
        }),
      })
      await loadUsers()
    } catch {
      alert('Update failed')
    }
  }

  async function deleteUser(u: UserRow) {
    if (u.username === 'admin') return alert('Cannot delete built-in admin')
    if (!confirm(`Delete user "${u.username}"?`)) return
    try {
      await authed(`/auth/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' })
      await loadUsers()
    } catch {
      alert('Delete failed')
    }
  }

  // ----- Branch chips helpers -----
  function addBranch(list: string[], value: string) {
    const v = value.trim()
    if (!v) return list
    if (list.includes(v)) return list
    return [...list, v]
  }
  function removeBranch(list: string[], value: string) {
    return list.filter((x) => x !== value)
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your account and system preferences</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="px-5 py-2.5 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 text-sm"
            onClick={signOut}
            title="Sign out"
          >
            Logout
          </button>
          <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${
            isAdmin 
              ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100' 
              : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
          }`}>
            {isAdmin ? 'Administrator' : 'Manager'}
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <h3 className="font-semibold text-lg">Appearance</h3>
            </div>
            <p className="text-sm text-muted-foreground">Customize your visual experience</p>
          </div>
        </div>
        
        <div className="mt-6 flex items-center gap-4">
          <button 
            className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200"
            onClick={toggleTheme}
          >
            Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
          </button>
          <div className="text-sm text-muted-foreground">
            Current theme: <span className="font-medium capitalize">{theme}</span>
          </div>
        </div>
      </div>

      {/* Account Security */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <h3 className="font-semibold text-lg">Account Security</h3>
            </div>
            <p className="text-sm text-muted-foreground">Update your password to keep your account secure</p>
          </div>
        </div>

        <div className="mt-6 space-y-4 max-w-md">
          <input 
            className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground" 
            type="password" 
            placeholder="Current password" 
            value={oldPw} 
            onChange={(e) => setOldPw(e.target.value)} 
          />
          <input 
            className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground" 
            type="password" 
            placeholder="New password (min 8 characters)" 
            value={newPw} 
            onChange={(e) => setNewPw(e.target.value)} 
          />
          <input 
            className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground" 
            type="password" 
            placeholder="Confirm new password" 
            value={confirmPw} 
            onChange={(e) => setConfirmPw(e.target.value)} 
          />

          <div className="text-xs text-muted-foreground space-y-1">
            {newPw && newPw.length < 8 && <div className="text-amber-600">• New password must be at least 8 characters</div>}
            {confirmPw && confirmPw !== newPw && <div className="text-red-600">• Password confirmation doesn't match</div>}
            {oldPw && newPw && oldPw === newPw && <div className="text-amber-600">• New password must be different from current</div>}
          </div>

          {msg && (
            <div className={`p-4 rounded-xl text-sm font-medium ${
              msg.includes('✅') 
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300' 
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}>
              {msg}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button 
              className="px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none transition-all duration-200" 
              onClick={changePw} 
              disabled={!validPw || busy}
            >
              {busy ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>

      {/* Roles & Users (Admin/HR only) */}
      {isAdmin && (
        <div className="card">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                <h3 className="font-semibold text-lg">User Management</h3>
              </div>
              <p className="text-sm text-muted-foreground">Create users and assign roles/branches</p>
            </div>
            <button 
              className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 hover:from-slate-600 hover:to-slate-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200" 
              onClick={() => { loadUsers(); loadBranchOptions() }}
            >
              🔄 Refresh
            </button>
          </div>

          {/* Create new user (aka “create role for a user”) */}
          <div className="mt-6 p-6 bg-muted rounded-2xl border border-border">
            <div className="text-lg font-semibold mb-4">Create New User</div>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Username">
                <input 
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground" 
                  value={newUser.username} 
                  onChange={e => setNewUser({ ...newUser, username: e.target.value })} 
                />
              </Field>
              <Field label="Password">
                <input 
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground" 
                  type="password" 
                  value={newUserPassword} 
                  onChange={e => setNewUserPassword(e.target.value)} 
                />
              </Field>
              <Field label="Email">
                <input 
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground" 
                  type="email" 
                  value={newUser.email} 
                  onChange={e => setNewUser({ ...newUser, email: e.target.value })} 
                />
              </Field>
              <Field label="Role">
                <select 
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark]" 
                  value={newUser.role} 
                  onChange={e => setNewUser({ ...newUser, role: e.target.value as any })}
                >
                  <option value="manager">👥 Manager (Scoped)</option>
                  <option value="admin">🔑 Admin (Full access)</option>
                </select>
              </Field>
            </div>

            {newUser.role === 'manager' && (
              <div className="mt-6">
                <BranchPicker
                  label="Allowed Branches"
                  value={newUser.allowed_branches}
                  onAdd={(v) => setNewUser({ ...newUser, allowed_branches: addBranch(newUser.allowed_branches, v) })}
                  onRemove={(v) => setNewUser({ ...newUser, allowed_branches: removeBranch(newUser.allowed_branches, v) })}
                  options={branchOptions}
                />
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button 
                className="px-8 py-3 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200" 
                onClick={createUser}
              >
                Create User
              </button>
            </div>
          </div>

          {/* Users table */}
          {errorUsers && (
            <div className="mt-6 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-6 py-4 rounded-2xl">
              {errorUsers}
            </div>
          )}
          
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Branches</th>
                  <th className="px-3 py-2 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>Loading users...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>No users found</td></tr>
                ) : (
                  users.map((u) => (
                    <UserRowItem
                      key={u.username}
                      u={u}
                      options={branchOptions}
                      onSave={updateUser}
                      onDelete={deleteUser}
                    />
                  ))
                )}
              </tbody>
            </table>
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

function BranchPicker({
  label,
  value,
  onAdd,
  onRemove,
  options,
}: {
  label: string
  value: string[]
  onAdd: (v: string) => void
  onRemove: (v: string) => void
  options: string[]
}) {
  const [draft, setDraft] = useState('')
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) {
        onAdd(draft.trim())
        setDraft('')
      }
    }
  }
  return (
    <div>
      {label && <div className="text-sm font-medium text-foreground mb-3">{label}</div>}
      <div className="flex items-center gap-3 mb-3">
        <input
          className="flex-1 px-4 py-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground"
          list="branches-suggestions"
          placeholder="Type a branch name and press Enter..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onEnter}
        />
        <datalist id="branches-suggestions">
          {options.map((b) => <option key={b} value={b} />)}
        </datalist>
        <button
          className="px-4 py-3 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
          onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft('') } }}
        >
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {value.map((b) => (
          <span key={b} className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded-lg text-sm font-medium border border-blue-200 dark:border-blue-800">
            {b}
            <button 
              className="ml-2 text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-100 font-bold transition-colors duration-200" 
              onClick={() => onRemove(b)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

function UserRowItem({
  u,
  options,
  onSave,
  onDelete,
}: {
  u: UserRow
  options: string[]
  onSave: (u: UserRow, patch: Partial<UserRow> & { password?: string }) => void
  onDelete: (u: UserRow) => void
}) {
  const [email, setEmail] = useState(u.email || '')
  const [role, setRole] = useState<string>(u.role)
  const [branches, setBranches] = useState<string[]>(u.allowed_branches || [])
  const [pw, setPw] = useState('')

  const canEditBranches = role === 'manager'
  const isAdminUser = u.username === 'admin'

  return (
    <tr className="hover:bg-muted/50 transition-colors border-b border-border/50">
      <td className="px-3 py-3 font-medium">{u.username}</td>
      <td className="px-3 py-3">
        <input 
          className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)} 
        />
      </td>
      <td className="px-3 py-3">
        <select 
          className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-foreground dark:[color-scheme:dark]" 
          value={role} 
          onChange={(e) => setRole(e.target.value as any)} 
          disabled={isAdminUser}
        >
          <option value="manager">👥 Manager</option>
          <option value="admin">🔑 Admin</option>
        </select>
      </td>
      <td className="px-3 py-3">
        {canEditBranches ? (
          <BranchPicker
            label=""
            value={branches}
            onAdd={(v) => setBranches((prev) => (prev.includes(v) ? prev : [...prev, v]))}
            onRemove={(v) => setBranches((prev) => prev.filter((x) => x !== v))}
            options={options}
          />
        ) : (
          <div className="text-muted-foreground italic">All branches (Admin)</div>
        )}
      </td>
      <td className="px-3 py-3 text-center">
        <div className="space-y-3">
          <div className="flex justify-center gap-2">
            <button
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transform hover:-translate-y-0.5 disabled:transform-none transition-all duration-200"
              onClick={() => onSave(u, { email, role, allowed_branches: branches })}
              disabled={isAdminUser && role !== 'admin'}
            >
              Save
            </button>
            {!isAdminUser && (
              <button 
                className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200" 
                onClick={() => onDelete(u)}
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 px-3 py-2 bg-muted border border-border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all duration-200 text-foreground dark:[color-scheme:dark] placeholder:text-muted-foreground"
              type="password"
              placeholder="New password..."
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <button
              className="px-3 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
              onClick={() => {
                if (!pw) return
                onSave(u, { password: pw })
                setPw('')
              }}
            >
              Set
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}
