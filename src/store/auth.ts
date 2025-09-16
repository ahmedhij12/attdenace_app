import { create } from 'zustand'

type State = {
  apiBase: string
  token: string
  email: string
  role: string
  theme: 'light' | 'dark'
}
type Actions = {
  setApiBase: (v:string)=>void
  setSession: (token:string, email:string, role:string)=>void
  login: (username:string, password:string)=>Promise<void>
  logout: ()=>void
  toggleTheme: ()=>void
}

const initialBase = (import.meta.env.MODE === 'development') ? '/api' : 'https://api.hijazionline.org';
const initialToken = localStorage.getItem('jwt') || ''
const initialEmail = localStorage.getItem('email') || ''
const initialRole = localStorage.getItem('role') || 'viewer'
const initialTheme = (localStorage.getItem('theme') as 'light'|'dark') || 'light'

export const useAuthStore = create<State & Actions>((set, get) => ({
  apiBase: initialBase,
  token: initialToken,
  email: initialEmail,
  role: initialRole,
  theme: initialTheme,
  setApiBase: (v) => { localStorage.setItem('apiBase', v); set({apiBase: v}) },
  setSession: (token, email, role) => {
    localStorage.setItem('jwt', token)
    localStorage.setItem('email', email)
    localStorage.setItem('role', role)
    set({ token, email, role })
  },
  async login(username, password) {
    const res = await fetch((get().apiBase.replace(/\/$/, '')) + '/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, password})
    })
    if (!res.ok) {
      let detail = ''
      try { const j = await res.json(); detail = j?.detail || JSON.stringify(j) } catch {}
      throw new Error(`${res.status} ${res.statusText}${detail ? ' - ' + detail : ''}`)
    }
    const j = await res.json()
    const token = (j?.access_token || j?.token || '').toString()
    const email = j?.user?.email || j?.email || ''
    const role = j?.user?.role || j?.role || 'admin'
    get().setSession(token, email, role)
  },
  logout: () => {
    localStorage.removeItem('jwt')
    localStorage.removeItem('email')
    localStorage.removeItem('role')
    set({ token: '', email: '', role: 'viewer' })
    window.location.href = '/login'
  },
  toggleTheme: () => {
    const t = get().theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
    set({ theme: t })
  }
}))

document.documentElement.classList.toggle('dark', initialTheme === 'dark')
