// src/pages/EmployeeFile/Guarded.tsx
import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import EmployeeFile from './EmployeeFilePage'

export default function GuardedEmployeeFile() {
  const role = (useAuthStore(s => s.role) || '').toString().trim().toLowerCase()
  if (role !== 'admin' && role !== 'hr' && role !== 'accountant') return <Navigate to="/" replace />
  return <EmployeeFile />
}
