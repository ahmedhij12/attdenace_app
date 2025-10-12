// src/App.tsx
import React, { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { canAccess } from "@/lib/roles";
function App() {
  const currentRole = useAuthStore(s => s.role?.toLowerCase?.() || "manager");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      
      {/* Mobile Header with Hamburger Menu */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-b border-white/20 dark:border-slate-700/50 shadow-lg">
        <div className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
          HR System
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
          aria-label="Toggle menu"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {isMobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>
      {/* Sidebar */}
      <aside className={`
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
        fixed md:relative
        z-50 md:z-auto
        w-64 h-full md:h-auto
        bg-white/80 dark:bg-slate-800/80 
        backdrop-blur-sm 
        border-r border-white/20 dark:border-slate-700/50 
        p-6 shadow-xl
        transition-transform duration-300 ease-in-out
        md:shrink-0
      `}>
        
        {/* Close button for mobile */}
        <div className="md:hidden flex justify-end mb-4">
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mb-8">
          <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            HR System
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">Management Portal</div>
        </div>
        <nav className="space-y-2">
          {canAccess(currentRole, "dashboard") && <Item to="/" onClick={() => setIsMobileMenuOpen(false)}>📊 Dashboard</Item>}
          {canAccess(currentRole, "logs") && <Item to="/logs" onClick={() => setIsMobileMenuOpen(false)}>📋 Logs</Item>}
          {canAccess(currentRole, "employees") && <Item to="/employees" onClick={() => setIsMobileMenuOpen(false)}>👥 Employees</Item>}
          {canAccess(currentRole, "employeeFiles") && <Item to="/employee-files" onClick={() => setIsMobileMenuOpen(false)}>📁 Employee Files</Item>}
          {canAccess(currentRole, "audits") && <Item to="/audits" onClick={() => setIsMobileMenuOpen(false)}>🔍 Audits</Item>}
          {canAccess(currentRole, "devices") && <Item to="/devices" onClick={() => setIsMobileMenuOpen(false)}>🖥️ Devices</Item>}
          {canAccess(currentRole, "payroll") && <Item to="/payroll" onClick={() => setIsMobileMenuOpen(false)}>💰 Payroll</Item>}
          {canAccess(currentRole, "settings") && <Item to="/settings" onClick={() => setIsMobileMenuOpen(false)}>⚙️ Settings</Item>}
        </nav>
      </aside>
      {/* Overlay for mobile */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      {/* Main Content */}
      <main className="flex-1 overflow-auto md:ml-0">
        <Outlet />
      </main>
    </div>
  );
}
function Item({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
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