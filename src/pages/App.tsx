// src/App.tsx
import React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { canAccess } from "@/lib/roles";

function App() {
  const currentRole = useAuthStore(s => s.role?.toLowerCase?.() || "manager");


  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <aside className="w-64 shrink-0 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-r border-white/20 dark:border-slate-700/50 p-6 shadow-xl">
        <div className="mb-8">
          <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            HR System
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">Management Portal</div>
        </div>

        <nav className="space-y-2">
          {canAccess(currentRole, "dashboard") && <Item to="/">📊 Dashboard</Item>}
          {canAccess(currentRole, "logs") && <Item to="/logs">📋 Logs</Item>}
          {canAccess(currentRole, "employees") && <Item to="/employees">👥 Employees</Item>}
          {canAccess(currentRole, "employeeFiles") && <Item to="/employee-files">📁 Employee Files</Item>}
          {canAccess(currentRole, "audits") && <Item to="/audits">🔍 Audits</Item>}
          {canAccess(currentRole, "devices") && <Item to="/devices">🖥️ Devices</Item>}
          {canAccess(currentRole, "payroll") && <Item to="/payroll">💰 Payroll</Item>}
          {canAccess(currentRole, "settings") && <Item to="/settings">⚙️ Settings</Item>}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function Item({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        "block px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 " +
        (isActive
          ? "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg transform scale-105"
          : "text-slate-700 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md hover:transform hover:scale-105")
      }
    >
      {children}
    </NavLink>
  );
}

export default App;
