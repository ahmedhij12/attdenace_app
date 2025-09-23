// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate, Outlet,} from "react-router-dom";
import "./styles/index.css";
import App from "./pages/App";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Logs from "./pages/Logs";
import Employees from "./pages/Employees";
import Devices from "./pages/Devices";
import Settings from "./pages/Settings";
import Payroll from "./pages/Payroll";
import EmployeeFile from "./pages/EmployeeFile";
import { useAuthStore } from "./store/auth";
import Audits from "@/pages/Audits";

// --- existing helpers (kept) ---
function isAdmin(role: unknown) {
  const x = String(role ?? "").toLowerCase().trim();
  return x.startsWith("admin");
}
function isAdminOrHR(role: unknown) {
  const x = String(role ?? "").toLowerCase().trim();
  return x.startsWith("admin") || x === "hr" || x.startsWith("humanresources");
}

// --- new generic guard: allow list of roles ---
function RequireRoles({ roles }: { roles: Array<"admin" | "hr" | "manager" | "accountant"> }) {
  const role = String(useAuthStore((s) => s.role) ?? "").toLowerCase().trim();
  if (!roles.includes(role as any)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function RequireAuth() {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const role = useAuthStore((s) => s.role);
  if (!isAdmin(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function RequireAdminOrHR() {
  const role = useAuthStore((s) => s.role);
  if (!isAdminOrHR(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/",
        element: <App />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "logs", element: <Logs /> },
          { path: "employees", element: <Employees /> },
          { path: "devices", element: <Devices /> },

          // Employee Files: admin + hr + accountant
          {
            element: <RequireRoles roles={["admin", "hr", "accountant"]} />,
            children: [{ path: "employee-files", element: <EmployeeFile /> }],
          },

          // Payroll: admin + hr (unchanged)
          {
            element: <RequireAdminOrHR />,
            children: [{ path: "payroll", element: <Payroll /> }],
          },

          // Audits: admin only
          {
            element: <RequireRoles roles={["admin"]} />,
            children: [{ path: "audits", element: <Audits /> }],
          },

          // Settings: visible to all roles (logout, personal stuff)
          { path: "settings", element: <Settings /> },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
