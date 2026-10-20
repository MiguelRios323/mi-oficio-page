import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/admin-guard';
import { errorResponse, HttpError } from '@/lib/mercadopago-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const safe = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const uid = (request.nextUrl.searchParams.get('uid') || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) throw new HttpError(400, 'UID inválido.');
    const auth = getAdminAuth();
    const account = await auth.getUser(uid);
    const db = getAdminDb();
    const email = (account.email || '').trim().toLowerCase();
    // Los perfiles observados usan correo con el punto reemplazado por guion bajo.
    // Solo se consulta la clave derivada del correo VERIFICADO por Firebase Auth, no una entrada arbitraria.
    const key = email ? email.replace(/\./g, '_') : null;
    const profileSnap = key ? await db.ref('usuarios_data').child(key).child('perfil').get() : null;
    const businessFound = Boolean(profileSnap?.exists());
    const businessRaw = safe(profileSnap?.val());
    // Lista explícita: no devolver secretos bancarios ni datos internos de la base.
    const fields = ['nombre','oficio_rubro','cuit','dni','cuit_dni','condicion_iva','iibb','direccion','localidad','codigo_postal','telefono','email','moneda_default','iva_default','plantilla_estilo','premium_activado_at','premium_amount','acepta_efectivo','acepta_transferencia','acepta_cheque'];
    const business = Object.fromEntries(fields.filter(f => Object.prototype.hasOwnProperty.call(businessRaw,f)).map(f => [f,businessRaw[f]]));
    const entitlement = safe((await db.ref('mercadopago_entitlements').child(uid).get()).val());
    const expiresAt = Number(entitlement.expiresAt) || null;
    const premium = Boolean(expiresAt && expiresAt > Date.now() && entitlement.revoked !== true);
    return NextResponse.json({ok:true,profile:{uid:account.uid,email:account.email || null,displayName:account.displayName || null,emailVerified:account.emailVerified,providerIds:account.providerData.map(p => p.providerId),disabled:account.disabled,createdAt:account.metadata.creationTime,lastLogin:account.metadata.lastSignInTime,business,businessFound,profileKey:businessFound ? key : null,premium,expiresAt}}, {headers});
  } catch (error) {
    const e = errorResponse(error);
    return NextResponse.json({ok:false,error:e.message}, {status:e.status,headers});
  }
}
