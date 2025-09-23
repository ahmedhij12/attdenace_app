// src/components/RoleBadge.tsx
import React from "react";
import { useAuthStore } from "@/store/auth";
import { roleLabel } from "@/lib/roles";

export default function RoleBadge({ className = "" }: { className?: string }) {
  const role = useAuthStore((s) => s.role);
  const label = roleLabel(role); // 'admin' | 'manager'
  const bg = label === "admin" ? "bg-purple-600" : "bg-blue-600";

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-white ${bg} ${className}`}
      title={`Signed in as ${label}`}
    >
      {label}
    </span>
  );
}
