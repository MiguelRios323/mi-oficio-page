import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/admin-guard';
import { errorResponse, HttpError } from '@/lib/mercadopago-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
type Command={uid:string;action:'grant'|'free';days?:number;reason:string;requestId:string};
export async function POST(request:NextRequest){
 try {
  const admin=await requireAdmin(request);
  const input=await request.json() as Partial<Command>;
  if(typeof input.uid!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.uid))throw new HttpError(400,'UID inválido.');
  if(input.action!=='grant'&&input.action!=='free')throw new HttpError(400,'Acción inválida.');
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>500)throw new HttpError(400,'Indicá un motivo de 5 a 500 caracteres.');
  if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId))throw new HttpError(400,'Identificador de solicitud inválido.');
  if(input.action==='grant'&&![1,7,30,365].includes(Number(input.days)))throw new HttpError(400,'Duración no permitida.');
  const now=Date.now(),key=`${admin.uid}_${input.requestId}`;
  const ref=getAdminDb().ref(`mercadopago_entitlements/${input.uid}`);
  let duplicate=false;
  const result=await ref.transaction((current:Record<string,unknown>|null)=>{
   const data=current||{};
   const events=(data.adminEvents||{}) as Record<string,unknown>;
   if(events[key]){duplicate=true;return;}
   const beforeExpiresAt=Number(data.expiresAt)||0,beforeRevoked=data.revoked===true;
   const base=(!beforeRevoked&&beforeExpiresAt>now)?beforeExpiresAt:now;
   const afterExpiresAt=input.action==='grant'?base+Number(input.days)*86400000:beforeExpiresAt;
   const revoked=input.action==='free';
   return {...data,expiresAt:afterExpiresAt,revoked,adminEvents:{...events,[key]:{action:input.action,reason:input.reason!.trim(),at:now,adminUid:admin.uid,beforeExpiresAt,beforeRevoked,afterExpiresAt,days:input.action==='grant'?input.days:null,requestId:input.requestId}}};
  },undefined,false);
  if(!result.committed&&!duplicate)throw new HttpError(409,'No se pudo actualizar la membresía.');
  return NextResponse.json({ok:true,duplicate,uid:input.uid,expiresAt:result.snapshot.val()?.expiresAt||null,revoked:result.snapshot.val()?.revoked===true},{headers});
 }catch(error){const e=errorResponse(error);return NextResponse.json({ok:false,error:e.message},{status:e.status,headers});}
}
