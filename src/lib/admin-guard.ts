import type { NextRequest } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';
import { HttpError } from '@/lib/mercadopago-server';

export async function requireAdmin(request: NextRequest) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Iniciá sesión.');
  const decoded = await getAdminAuth().verifyIdToken(token, true)
    .catch(() => { throw new HttpError(401, 'Sesión inválida.'); });
  const allowedUid = process.env.MIOFICIO_ADMIN_UID?.trim();
  if (!allowedUid) throw new HttpError(503, 'Administrador no configurado.');
  if (decoded.uid !== allowedUid || decoded.admin !== true ||
      decoded.email?.toLowerCase() !== 'riosmiguelr3@gmail.com' || !decoded.email_verified) {
    throw new HttpError(403, 'Acceso exclusivo de administración.');
  }
  const account = await getAdminAuth().getUser(decoded.uid);
  if (account.disabled || account.email?.toLowerCase() !== 'riosmiguelr3@gmail.com' || !account.emailVerified)
    throw new HttpError(403, 'Cuenta no autorizada.');
  return decoded;
}
