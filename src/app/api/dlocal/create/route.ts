import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID } from "crypto";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DLOCAL_API_URL =
  process.env.DLOCAL_API_URL?.trim() ||
  "https://sandbox.dlocal.com";

const DLOCAL_X_LOGIN =
  process.env.DLOCAL_X_LOGIN?.trim();

const DLOCAL_X_TRANS_KEY =
  process.env.DLOCAL_X_TRANS_KEY?.trim();

const DLOCAL_SECRET_KEY =
  process.env.DLOCAL_SECRET_KEY?.trim();

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "http://localhost:3000";

const CALLBACK_URL =
  process.env.DLOCAL_CALLBACK_URL?.trim() ||
  `${APP_URL}/?dlocal=success`;

const NOTIFICATION_URL =
  process.env.DLOCAL_NOTIFICATION_URL?.trim() ||
  `${APP_URL}/api/dlocal/webhook`;

// ---------------------------------------------------------
// Firebase email -> clave utilizada en Realtime Database
// ---------------------------------------------------------

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]\\/]/g, "_")
    .slice(0, 100);
}

// ---------------------------------------------------------
// Crear firma HMAC para dLocal
// ---------------------------------------------------------

function createSignature(
  login: string,
  xDate: string,
  body: string,
  secretKey: string
): string {
  return createHmac("sha256", secretKey)
    .update(login + xDate + body)
    .digest("hex");
}

// ---------------------------------------------------------
// Crear identificador único de orden
// ---------------------------------------------------------

function createOrderId(): string {
  return `MIOFICIO-${Date.now()}-${randomUUID().slice(
    0,
    8
  )}`;
}

// ---------------------------------------------------------
// POST /api/dlocal/create
// ---------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // -------------------------------------------------------
    // 1. Verificar configuración de dLocal
    // -------------------------------------------------------

    if (
      !DLOCAL_X_LOGIN ||
      !DLOCAL_X_TRANS_KEY ||
      !DLOCAL_SECRET_KEY
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "La configuración de dLocal está incompleta en el servidor.",
        },
        { status: 500 }
      );
    }

    // -------------------------------------------------------
    // 2. Obtener token de Firebase
    // -------------------------------------------------------

    const authorization =
      request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No autorizado. Falta el token de Firebase.",
        },
        { status: 401 }
      );
    }

    const firebaseToken =
      authorization
        .substring("Bearer ".length)
        .trim();

    if (!firebaseToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Token de Firebase vacío.",
        },
        { status: 401 }
      );
    }

    // -------------------------------------------------------
    // 3. Verificar usuario con Firebase Admin
    // -------------------------------------------------------

    const adminAuth = getAdminAuth();

    const decodedToken =
      await adminAuth.verifyIdToken(firebaseToken);

    const uid = decodedToken.uid;

    const firebaseEmail =
      decodedToken.email
        ?.trim()
        .toLowerCase();

    if (!firebaseEmail) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Tu cuenta de Firebase no tiene un correo electrónico asociado.",
        },
        { status: 400 }
      );
    }

    // -------------------------------------------------------
    // 4. Buscar perfil del usuario
    // -------------------------------------------------------

    const emailKey =
      safeEmailKey(firebaseEmail);

    const database = getAdminDb();

    const profileSnapshot =
      await database
        .ref(
          `usuarios_data/${emailKey}/perfil`
        )
        .once("value");

    const perfil =
      profileSnapshot.val() ?? {};

    // -------------------------------------------------------
    // 5. Obtener CUIT / DNI / CUIL
    // -------------------------------------------------------

    const rawDocument =
      String(
        perfil?.cuit_cuil ?? ""
      ).trim();

    // Elimina guiones, espacios y puntos.
    //
    // Ejemplo:
    // 20-12345678-9
    // se convierte en:
    // 20123456789

    const document =
      rawDocument.replace(/\D/g, "");

    if (!document) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Antes de activar Premium, completá tu CUIT / DNI en Perfil y guardá los datos.",
        },
        { status: 400 }
      );
    }

    // Argentina:
    // DNI: 7 a 9 dígitos
    // CUIT/CUIL: 11 dígitos

    if (
      !/^(?:\d{7,9}|\d{11})$/.test(
        document
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "El CUIT / DNI ingresado en Perfil no tiene un formato válido.",
        },
        { status: 400 }
      );
    }

    // -------------------------------------------------------
    // 6. Crear order_id
    // -------------------------------------------------------

    const orderId =
      createOrderId();

    // -------------------------------------------------------
    // 7. Preparar cuerpo del pago
    // -------------------------------------------------------

    const paymentBody = {
      amount: 4999,

      currency: "ARS",

      country: "AR",

      payment_method_flow: "REDIRECT",

      payer: {
        name: String(
          decodedToken.name ||
            perfil?.nombre ||
            firebaseEmail.split("@")[0]
        ).trim(),

        email: firebaseEmail,

        // Documento obligatorio para Argentina.
        document,

        // Identificador interno del usuario.
        user_reference: uid,
      },

      order_id: orderId,

      description:
        "MiOficio Premium",

      notification_url:
        NOTIFICATION_URL,

      callback_url:
        CALLBACK_URL,
    };

    const body =
      JSON.stringify(paymentBody);

    // -------------------------------------------------------
    // 8. Crear fecha para firma
    // -------------------------------------------------------

    const xDate =
      new Date().toISOString();

    // -------------------------------------------------------
    // 9. Crear firma HMAC
    // -------------------------------------------------------

    const signature =
      createSignature(
        DLOCAL_X_LOGIN,
        xDate,
        body,
        DLOCAL_SECRET_KEY
      );

    // -------------------------------------------------------
    // 10. Idempotency key
    // -------------------------------------------------------

    const idempotencyKey =
      randomUUID();

    // -------------------------------------------------------
    // 11. Log seguro
    // -------------------------------------------------------

    console.log(
      "Enviando pago a dLocal:",
      {
        amount:
          paymentBody.amount,

        currency:
          paymentBody.currency,

        country:
          paymentBody.country,

        flow:
          paymentBody.payment_method_flow,

        orderId,

        hasDocument:
          Boolean(document),

        callbackUrl:
          CALLBACK_URL,

        notificationUrl:
          NOTIFICATION_URL,
      }
    );

    // -------------------------------------------------------
    // 12. Crear pago en dLocal
    // -------------------------------------------------------

    const dLocalResponse =
      await fetch(
        `${DLOCAL_API_URL}/payments`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-Date":
              xDate,

            "X-Login":
              DLOCAL_X_LOGIN,

            "X-Trans-Key":
              DLOCAL_X_TRANS_KEY,

            "X-Version":
              "2.1",

            "User-Agent":
              "MiOficio/1.0",

            "X-Idempotency-Key":
              idempotencyKey,

            // IMPORTANTE:
            // El formato correcto lleva ":" después
            // de "Signature".
            "Authorization":
              `V2-HMAC-SHA256, Signature: ${signature}`,
          },

          body,

          cache: "no-store",
        }
      );

    // -------------------------------------------------------
    // 13. Leer respuesta de dLocal
    // -------------------------------------------------------

    const rawResponse =
      await dLocalResponse.text();

    let dLocalData: any = null;

    try {
      dLocalData =
        rawResponse
          ? JSON.parse(rawResponse)
          : null;
    } catch {
      dLocalData = null;
    }

    // -------------------------------------------------------
    // 14. Manejar errores de dLocal
    // -------------------------------------------------------

    if (!dLocalResponse.ok) {
      console.error(
        "========================================"
      );

      console.error(
        "dLocal rechazó la creación del pago"
      );

      console.error({
        status:
          dLocalResponse.status,

        code:
          dLocalData?.code,

        message:
          dLocalData?.message,

        param:
          dLocalData?.param,

        error:
          dLocalData?.error,

        detail:
          dLocalData?.detail,

        response:
          dLocalData ??
          rawResponse,

        orderId,
      });

      console.error(
        "========================================"
      );

      const dLocalMessage =
        dLocalData?.message ||
        dLocalData?.error ||
        dLocalData?.detail ||
        "dLocal rechazó la creación del pago.";

      return NextResponse.json(
        {
          ok: false,

          error:
            dLocalMessage,

          dlocalStatus:
            dLocalResponse.status,

          dlocalCode:
            dLocalData?.code ??
            null,

          dlocalParam:
            dLocalData?.param ??
            null,

          orderId,
        },
        {
          status:
            dLocalResponse.status >=
              400 &&
            dLocalResponse.status <
              600
              ? dLocalResponse.status
              : 502,
        }
      );
    }

    // -------------------------------------------------------
    // 15. Obtener URL de checkout
    // -------------------------------------------------------

    const checkoutUrl =
      dLocalData?.redirect_url ||
      dLocalData?.checkout_url ||
      dLocalData?.payment_url;

    if (!checkoutUrl) {
      console.error(
        "dLocal creó el pago pero no devolvió URL:",
        dLocalData
      );

      return NextResponse.json(
        {
          ok: false,

          error:
            "dLocal creó el pago pero no devolvió una URL de checkout.",

          orderId,
        },
        { status: 502 }
      );
    }

    // -------------------------------------------------------
    // 16. Respuesta al frontend
    // -------------------------------------------------------

    return NextResponse.json({
      ok: true,

      checkoutUrl,

      orderId,
    });
  } catch (error) {
    // -------------------------------------------------------
    // 17. Error interno
    // -------------------------------------------------------

    console.error(
      "Error interno creando pago dLocal:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Error interno del servidor.",
      },
      { status: 500 }
    );
  }
}