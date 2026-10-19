import 'server-only';
import type { NextRequest } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';
import { HttpError, required } from '@/lib/mercadopago-server';

export async function requireAdministrator(request: NextRequest) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Iniciá sesión.');
  const allowedEmail = required('MIOFICIO_ADMIN_EMAIL').toLowerCase();
  let decoded;
  try { decoded = await getAdminAuth().verifyIdToken(token, true); }
  catch { throw new HttpError(401, 'Sesión inválida o vencida.'); }
  const account = await getAdminAuth().getUser(decoded.uid);
  const expectedUid = process.env.MIOFICIO_ADMIN_UID?.trim();
  if (account.disabled || !account.emailVerified || !decoded.email_verified ||
      account.email?.toLowerCase() !== allowedEmail || decoded.email?.toLowerCase() !== allowedEmail ||
      (expectedUid && expectedUid !== decoded.uid)) {
    throw new HttpError(403, 'Esta cuenta no tiene acceso de administrador.');
  }
  return { uid: account.uid, email: account.email! };
}
