import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/admin-guard';
import { errorResponse, HttpError } from '@/lib/mercadopago-server';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(request:NextRequest){try{
 await requireAdmin(request);
 const q=(request.nextUrl.searchParams.get('q')||'').trim();
 if(!q||q.length>254)throw new HttpError(400,'Ingresá un UID o correo válido.');
 const user=q.includes('@')?await getAdminAuth().getUserByEmail(q):await getAdminAuth().getUser(q);
 const entitlement=(await getAdminDb().ref(`mercadopago_entitlements/${user.uid}`).get()).val();
 return NextResponse.json({ok:true,user:{uid:user.uid,email:user.email||null,displayName:user.displayName||null,disabled:user.disabled,createdAt:user.metadata.creationTime},premium:!!entitlement&&!entitlement.revoked&&Number(entitlement.expiresAt)>Date.now(),expiresAt:Number(entitlement?.expiresAt)||null},{headers});
 }catch(error){const e=errorResponse(error);return NextResponse.json({ok:false,error:e.message},{status:e.status,headers});}}
