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

// Resolve API base consistently with the API client
function resolveInitialApiBase(): string {
  const env = (import.meta as any).env || {};
  const envApiBase = 
    env.VITE_API_BASE_URL ||
    env.VITE_API_BASE ||
    env.VITE_API_URL ||
    env.VITE_API ||
    localStorage.getItem("api_base");
    
  if (envApiBase) {
    return String(envApiBase).trim().replace(/\/+$/g, "");
  }

  const isDevelopment = env.MODE === 'development' || env.DEV === true;
  
  if (isDevelopment) {
    // Development: try to determine if we're running locally
    try {
      const currentUrl = new URL(window.location.href);
      const isLocalhost = ['localhost', '127.0.0.1'].includes(currentUrl.hostname);
      const isDevPort = ['5173', '5174', '5175', '3000'].includes(currentUrl.port);
      
      if (isLocalhost && isDevPort) {
        return `${currentUrl.protocol}//${currentUrl.hostname}:8000`;
      }
    } catch {
      // Fallback if window.location not available during SSR
    }
    // Development fallback to relative path
    return '/api';
  }
  
  // Production
  return 'https://api.hijazionline.org';
}

const initialBase = resolveInitialApiBase();

// Safe localStorage access with fallbacks
function safeGetItem(key: string, fallback: string = ''): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

const initialToken = safeGetItem('jwt')
const initialEmail = safeGetItem('email')
const initialRole = safeGetItem('role', 'viewer')
const initialTheme = (safeGetItem('theme') as 'light'|'dark') || 'light'

export const useAuthStore = create<State & Actions>((set, get) => ({
  apiBase: initialBase,
  token: initialToken,
  email: initialEmail,
  role: initialRole,
  theme: initialTheme,
  setApiBase: (v) => { localStorage.setItem('apiBase', v); set({apiBase: v}) },
  setSession: (token, email, role) => {
    try {
      localStorage.setItem('jwt', token)
      localStorage.setItem('email', email)
      localStorage.setItem('role', role)
    } catch (e) {
      console.warn('Failed to save to localStorage:', e)
    }
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
    try {
      localStorage.removeItem('jwt')
      localStorage.removeItem('email')
      localStorage.removeItem('role')
    } catch (e) {
      console.warn('Failed to clear localStorage:', e)
    }
    set({ token: '', email: '', role: 'viewer' })
    window.location.href = '/login'
  },
  toggleTheme: () => {
    const t = get().theme === 'light' ? 'dark' : 'light'
    try {
      localStorage.setItem('theme', t)
    } catch (e) {
      console.warn('Failed to save theme:', e)
    }
    document.documentElement.classList.toggle('dark', t === 'dark')
    set({ theme: t })
  }
}))

document.documentElement.classList.toggle('dark', initialTheme === 'dark')
