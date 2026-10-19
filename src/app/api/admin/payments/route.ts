import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { errorResponse, HttpError, mp } from '@/lib/mercadopago-server';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(request:NextRequest){try{
 await requireAdmin(request);
 const id=(request.nextUrl.searchParams.get('id')||'').trim();
 if(!/^\d{1,30}$/.test(id))throw new HttpError(400,'Ingresá un identificador numérico de pago.');
 const payment=await mp<{id:number;status:string;status_detail?:string;transaction_amount?:number;currency_id?:string;date_created?:string;date_approved?:string;external_reference?:string;payment_method_id?:string;order?:{id?:string};payer?:{id?:string;email?:string}}>(`/v1/payments/${id}`);
 return NextResponse.json({ok:true,payment:{id:payment.id,status:payment.status,statusDetail:payment.status_detail||null,amount:payment.transaction_amount,currency:payment.currency_id,createdAt:payment.date_created,approvedAt:payment.date_approved,externalReference:payment.external_reference||null,method:payment.payment_method_id||null,payerId:payment.payer?.id||null,payerEmail:payment.payer?.email||null}},{headers});
 }catch(error){const e=errorResponse(error);return NextResponse.json({ok:false,error:e.message},{status:e.status,headers});}}
