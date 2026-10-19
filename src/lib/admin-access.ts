import 'server-only';
import type { NextRequest } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';
import { HttpError } from '@/lib/mercadopago-server';

export async function requireAdministrator(request: NextRequest) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Iniciá sesión.');

  const allowedUid = process.env.MIOFICIO_ADMIN_UID?.trim();
  const allowedEmail = process.env.MIOFICIO_ADMIN_EMAIL?.trim().toLowerCase();

  if (!allowedUid || !allowedEmail) {
    throw new HttpError(503, 'Administrador no configurado.');
  }

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, 'Sesión inválida o vencida.');
  }

  if (
    decoded.uid !== allowedUid ||
    decoded.admin !== true ||
    decoded.email_verified !== true ||
    decoded.email?.toLowerCase() !== allowedEmail
  ) {
    throw new HttpError(403, 'Acceso de administrador denegado.');
  }

  const account = await getAdminAuth().getUser(decoded.uid);

  if (
    account.disabled ||
    !account.emailVerified ||
    account.email?.toLowerCase() !== allowedEmail
  ) {
    throw new HttpError(403, 'Cuenta no autorizada.');
  }

  return { uid: account.uid, email: account.email! };
}
