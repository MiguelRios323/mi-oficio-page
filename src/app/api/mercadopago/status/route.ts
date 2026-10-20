
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
};

export async function GET(request: NextRequest) {
  try {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/)?.[1];

    if (!token) {
      return NextResponse.json(
        { ok: false, premium: false, error: "Iniciá sesión." },
        { status: 401, headers }
      );
    }

    const decoded = await getAdminAuth().verifyIdToken(token, true);

    const snapshot = await getAdminDb()
      .ref("mercadopago_entitlements")
      .child(decoded.uid)
      .get();

    const entitlement = snapshot.val();

    const expiresAt = Number(entitlement?.expiresAt) || 0;

    const premium =
      entitlement?.revoked !== true &&
      expiresAt > Date.now();

    return NextResponse.json(
      {
        ok: true,
        premium,
        expiresAt: expiresAt || null,
      },
      { headers }
    );
  } catch (error) {
    console.error(
      "Error al consultar membresía Premium:",
      error instanceof Error ? error.message : "Error desconocido"
    );

    return NextResponse.json(
      {
        ok: false,
        premium: false,
        error: "No se pudo verificar la membresía.",
      },
      { status: 401, headers }
    );
  }
}
