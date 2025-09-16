import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import './styles/index.css'

import App from './pages/App'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Logs from './pages/Logs'
import Employees from './pages/Employees'
import Devices from './pages/Devices'
import Settings from './pages/Settings'
import Payroll from './pages/Payroll'
import { useAuthStore } from './store/auth'

function RequireAuth() {
  const token = useAuthStore(s => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}

function RequireAdmin() {
  const role = useAuthStore(s => s.role?.toLowerCase?.() || 'manager')
  if (role !== 'admin' && role !== 'hr') return <Navigate to="/" replace />
  return <Outlet />
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <RequireAuth />,
    children: [{
      path: '/',
      element: <App />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'logs', element: <Logs /> },
        { path: 'employees', element: <Employees /> },
        { path: 'devices', element: <Devices /> },
        { path: 'settings', element: <Settings /> },
        { element: <RequireAdmin />, children: [{ path: 'payroll', element: <Payroll /> }] },
      ],
    }],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
