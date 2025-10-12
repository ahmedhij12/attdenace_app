import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { canAccess, type AppPage } from '@/lib/roles';

export default function RouteGuard(
  { page, children }: { page: AppPage; children: JSX.Element }
) {
  const role = useAuthStore(s => s.role?.toLowerCase?.() || 'manager');
  return canAccess(role, page) ? children : <Navigate to="/" replace />;
}