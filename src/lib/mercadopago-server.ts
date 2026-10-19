import { getAdminAuth } from '@/lib/firebase-admin';
import type { NextRequest } from 'next/server';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export class MpApiError extends HttpError { constructor(public upstreamStatus:number){super(502,"Mercado Pago no pudo procesar la solicitud. Intentá nuevamente.");} }
export function required(name: string): string { const value=process.env[name]?.trim(); if(!value)throw new HttpError(503,`Falta configurar ${name}.`);return value; }
export function appUrl():string {const url=new URL(required('NEXT_PUBLIC_APP_URL'));if(url.protocol!=='https:'||url.username||url.password)throw new HttpError(503,'NEXT_PUBLIC_APP_URL debe ser HTTPS.');return url.origin;}
export function liveMode():boolean {const mode=required('MERCADOPAGO_MODE');if(mode!=='test'&&mode!=='production')throw new HttpError(503,'MERCADOPAGO_MODE debe ser test o production.');return mode==='production';}
export async function identity(request:NextRequest){const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new HttpError(401,'Iniciá sesión para continuar.');try{const user=await getAdminAuth().verifyIdToken(token,true);if(!user.email)throw new HttpError(403,'Tu cuenta necesita un correo electrónico.');return{uid:user.uid,email:user.email,name:user.name||''};}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(401,'La sesión venció. Iniciá sesión nuevamente.');}}
// El cuarto argumento permite PUT sin cambiar las llamadas GET/POST existentes.
export async function mp<T>(path:string,body?:unknown,idempotencyKey?:string,method?:'GET'|'POST'|'PUT'):Promise<T>{
 const response=await fetch(`https://api.mercadopago.com${path}`,{method:method||(body===undefined?'GET':'POST'),cache:'no-store',headers:{Authorization:`Bearer ${required('MERCADOPAGO_ACCESS_TOKEN')}`,'Content-Type':'application/json',...(idempotencyKey?{'X-Idempotency-Key':idempotencyKey}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(!response.ok){console.error('Mercado Pago API:',response.status,path);throw new MpApiError(response.status);}return await response.json() as T;
}
export function errorResponse(error:unknown):{status:number;message:string}{if(error instanceof HttpError)return{status:error.status,message:error.message};console.error('Error en integración Mercado Pago:',error instanceof Error?error.message:'Error interno');return{status:500,message:'No se pudo completar la operación. Intentá nuevamente.'};}
