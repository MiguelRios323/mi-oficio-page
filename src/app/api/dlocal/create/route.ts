import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID } from "crypto";

import {
  getAdminAuth,
  getAdminDb,
} from "@/lib/firebase-admin";

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

const PREMIUM_AMOUNT = 4999;
const PREMIUM_CURRENCY = "ARS";
const PREMIUM_COUNTRY = "AR";

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]\\/]/g, "_")
    .slice(0, 100);
}

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

function createOrderId(): string {
  return `MIOFICIO-${Date.now()}-${randomUUID().slice(
    0,
    8
  )}`;
}

export async function POST(request: NextRequest) {
  try {
    // -------------------------------------------------------
    // 1. Configuración
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
    // 2. Firebase token
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
    // 3. Verificar usuario
    // -------------------------------------------------------

    const adminAuth = getAdminAuth();

    const decodedToken =
      await adminAuth.verifyIdToken(
        firebaseToken
      );

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
    // 4. Obtener perfil
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
    // 5. Evitar doble Premium
    // -------------------------------------------------------

    if (perfil?.es_premium === true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Tu cuenta ya tiene MiOficio Premium activo.",
        },
        { status: 409 }
      );
    }

    // -------------------------------------------------------
    // 6. Documento
    // -------------------------------------------------------

    const rawDocument =
      String(
        perfil?.cuit_cuil ?? ""
      ).trim();

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
    // 7. Orden
    // -------------------------------------------------------

    const orderId =
      createOrderId();

    // -------------------------------------------------------
    // 8. Pago inicial
    //
    // IMPORTANTE:
    //
    // NO enviamos payment_method_id.
    //
    // dLocal Checkout REDIRECT determina el medio de pago.
    //
    // save_payment_method pide a dLocal guardar la tarjeta
    // para futuras operaciones.
    // -------------------------------------------------------

    const paymentBody = {
      amount:
        PREMIUM_AMOUNT,

      currency:
        PREMIUM_CURRENCY,

      country:
        PREMIUM_COUNTRY,

      payment_method_flow:
        "REDIRECT",

      payer: {
        name: String(
          decodedToken.name ||
            perfil?.nombre ||
            firebaseEmail.split("@")[0]
        ).trim(),

        email:
          firebaseEmail,

        document,

        user_reference:
          uid,
      },

      order_id:
        orderId,

      description:
        "MiOficio Premium - pago inicial",

      notification_url:
        NOTIFICATION_URL,

      callback_url:
        CALLBACK_URL,

      save_payment_method: {
        save: true,
      },
    };

    const body =
      JSON.stringify(paymentBody);

    // -------------------------------------------------------
    // 9. Firma
    // -------------------------------------------------------

    const xDate =
      new Date().toISOString();

    const signature =
      createSignature(
        DLOCAL_X_LOGIN,
        xDate,
        body,
        DLOCAL_SECRET_KEY
      );

    // -------------------------------------------------------
    // 10. Idempotencia
    // -------------------------------------------------------

    const idempotencyKey =
      randomUUID();

    // -------------------------------------------------------
    // 11. Log seguro
    // -------------------------------------------------------

    console.log(
      "Enviando pago inicial Premium a dLocal:",
      {
        amount:
          PREMIUM_AMOUNT,

        currency:
          PREMIUM_CURRENCY,

        country:
          PREMIUM_COUNTRY,

        flow:
          "REDIRECT",

        savePaymentMethod:
          true,

        orderId,

        hasDocument:
          Boolean(document),
      }
    );

    // -------------------------------------------------------
    // 12. Crear pago
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

            "Authorization":
              `V2-HMAC-SHA256, Signature: ${signature}`,
          },

          body,

          cache:
            "no-store",
        }
      );

    // -------------------------------------------------------
    // 13. Respuesta
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
    // 14. Error dLocal
    // -------------------------------------------------------

    if (!dLocalResponse.ok) {
      console.error(
        "dLocal rechazó el pago inicial Premium:",
        {
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
        }
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
            dLocalResponse.status < 600
              ? dLocalResponse.status
              : 502,
        }
      );
    }

    // -------------------------------------------------------
    // 15. Checkout
    // -------------------------------------------------------

    const checkoutUrl =
      dLocalData?.redirect_url ||
      dLocalData?.checkout_url ||
      dLocalData?.payment_url;

    if (!checkoutUrl) {
      console.error(
        "dLocal creó el pago pero no devolvió checkout:",
        {
          orderId,
        }
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
    // 16. Guardar orden pendiente
    //
    // NO guardamos datos sensibles de tarjeta.
    // El card_id llegará desde dLocal después del pago.
    // -------------------------------------------------------

    await database
      .ref(
        `dlocal_orders/${orderId}`
      )
      .set({
        order_id:
          orderId,

        uid,

        email:
          firebaseEmail,

        amount:
          PREMIUM_AMOUNT,

        currency:
          PREMIUM_CURRENCY,

        country:
          PREMIUM_COUNTRY,

        product:
          "MiOficio Premium",

        provider:
          "dlocal",

        status:
          "PENDING",

        payment_flow:
          "REDIRECT",

        save_payment_method:
          true,

        created_at:
          new Date().toISOString(),
      });

    // -------------------------------------------------------
    // 17. Respuesta
    // -------------------------------------------------------

    return NextResponse.json({
      ok: true,

      checkoutUrl,

      orderId,

      status:
        "PENDING",
    });
  } catch (error) {
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

export async function GET() {
  return NextResponse.json({
    ok: true,

    service:
      "MiOficio dLocal create payment",

    method:
      "POST",

    product:
      "MiOficio Premium",

    amount:
      PREMIUM_AMOUNT,

    currency:
      PREMIUM_CURRENCY,
  });
}