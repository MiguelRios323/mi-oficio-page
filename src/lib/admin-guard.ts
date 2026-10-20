import type { NextRequest } from 'next/server';
import { requireAdministrator } from '@/lib/admin-access';

/** Un único control de acceso para todas las APIs administrativas. */
export async function requireAdmin(request: NextRequest) {
  return requireAdministrator(request);
}
