// src/pages/EmployeeFile/Guarded.tsx
import React from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { isAdmin, isHR, isManager, isAccountant } from "@/constants/roles";

export default function GuardedEmployeeFile() {
  const role = (useAuthStore((s) => s.role) || "").toString().trim().toLowerCase();

  // Prevent access for roles other than admin/hr/accountant
  if (!["admin", "hr", "accountant"].includes(role)) {
    return <Navigate to="/" replace />;
  }

  // If authorized, render the Employee File content
  return <div className="p-6">Employee File component not found</div>;
}
