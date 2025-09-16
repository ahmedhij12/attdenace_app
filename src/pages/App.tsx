import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'

export default function App() {
  const role = useAuthStore(s => s.role?.toLowerCase?.() || 'manager')

  return (
    <div className="min-h-screen flex bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      <aside className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-4">
        <div className="text-lg font-semibold mb-4">Attendance Admin</div>
        <nav className="space-y-1">
          <Item to="/">Dashboard</Item>
          <Item to="/logs">Logs</Item>
          <Item to="/employees">Employees</Item>
          <Item to="/devices">Devices</Item>
          {(role === 'admin' || role === 'hr') && <Item to="/payroll">Payroll</Item>}
          <Item to="/settings">Settings</Item>
        </nav>
      </aside>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}

function Item({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        'block px-3 py-2 rounded-xl text-sm ' +
        (isActive
          ? 'bg-zinc-100 dark:bg-zinc-700/40 font-medium'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-700/40')
      }
    >
      {children}
    </NavLink>
  )
}
