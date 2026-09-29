import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID } from "crypto";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DLOCAL_API_URL =
  process.env.DLOCAL_API_URL?.trim() || "https://sandbox.dlocal.com";

const DLOCAL_X_LOGIN = process.env.DLOCAL_X_LOGIN?.trim();
const DLOCAL_X_TRANS_KEY = process.env.DLOCAL_X_TRANS_KEY?.trim();
const DLOCAL_SECRET_KEY = process.env.DLOCAL_SECRET_KEY?.trim();

const NOTIFICATION_URL =
  process.env.DLOCAL_NOTIFICATION_URL?.trim() ||
  "https://mioficio-sepia.vercel.app/api/dlocal/webhook";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://mioficio-sepia.vercel.app";

const PREMIUM_AMOUNT = 4999;
const PREMIUM_CURRENCY = "ARS";
const PREMIUM_COUNTRY = "AR";

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]/\\]/g, "_")
    .slice(0, 100);
}

function createSignature(
  login: string,
  xDate: string,
  body: string,
  secretKey: string
): string {
  return createHmac("sha256", secretKey)
    .update(login + xDate + body, "utf8")
    .digest("hex");
}

function createOrderId(): string {
  return `MIOFICIO-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function validatePublicHttpsUrl(
  url: string,
  fieldName: string
): string | null {
  if (!url) {
    return `No está configurada ${fieldName}.`;
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return `${fieldName} no es una URL válida.`;
  }

  if (parsed.protocol !== "https:") {
    return `${fieldName} debe utilizar HTTPS.`;
  }

  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "0.0.0.0"
  ) {
    return `${fieldName} no puede apuntar a localhost.`;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    /*
     * ---------------------------------------------------------
     * 1. Verificar configuración de dLocal
     * ---------------------------------------------------------
     */

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
        {
          status: 500,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 2. Callback de regreso a MiOficio
     * ---------------------------------------------------------
     */

    const callbackUrl = `${APP_URL.replace(/\/+$/, "")}/?dlocal=return`;

    const callbackUrlError = validatePublicHttpsUrl(
      callbackUrl,
      "la callback URL de dLocal"
    );

    if (callbackUrlError) {
      return NextResponse.json(
        {
          ok: false,
          error: callbackUrlError,
        },
        {
          status: 500,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 3. Verificar Firebase
     * ---------------------------------------------------------
     */

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          ok: false,
          error: "No autorizado. Falta el token de Firebase.",
        },
        {
          status: 401,
        }
      );
    }

    const firebaseToken = authorization
      .substring("Bearer ".length)
      .trim();

    if (!firebaseToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Token de Firebase vacío.",
        },
        {
          status: 401,
        }
      );
    }

    const adminAuth = getAdminAuth();

    const decodedToken = await adminAuth.verifyIdToken(firebaseToken);

    const uid = decodedToken.uid;

    const firebaseEmail = decodedToken.email
      ?.trim()
      .toLowerCase();

    if (!firebaseEmail) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Tu cuenta de Firebase no tiene un correo electrónico asociado.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 4. Obtener perfil del usuario
     * ---------------------------------------------------------
     */

    const emailKey = safeEmailKey(firebaseEmail);

    const database = getAdminDb();

    const profileSnapshot = await database
      .ref(`usuarios_data/${emailKey}/perfil`)
      .once("value");

    const perfil = profileSnapshot.val() ?? {};

    if (perfil?.es_premium === true) {
      return NextResponse.json(
        {
          ok: false,
          error: "Tu cuenta ya tiene MiOficio Premium activo.",
        },
        {
          status: 409,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 5. Obtener documento
     * ---------------------------------------------------------
     */

    const rawDocument = String(
      perfil?.cuit_cuil ?? ""
    ).trim();

    const document = rawDocument.replace(/\D/g, "");

    if (!document) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Antes de activar Premium, completá tu CUIT / DNI en Perfil y guardá los datos.",
        },
        {
          status: 400,
        }
      );
    }

    if (!/^(?:\d{7,9}|\d{11})$/.test(document)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "El CUIT / DNI ingresado en Perfil no tiene un formato válido.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 6. Crear orden
     * ---------------------------------------------------------
     */

    const orderId = createOrderId();

    const payerName = String(
      decodedToken.name ||
        perfil?.nombre ||
        firebaseEmail.split("@")[0]
    ).trim();

    /*
     * ---------------------------------------------------------
     * 7. Checkout REDIRECT básico
     *
     * IMPORTANTE:
     *
     * NO enviamos:
     * - payment_method_id
     * - save_payment_method
     * - subscription
     * - notification_url
     *
     * Primero queremos comprobar que dLocal pueda crear
     * correctamente el Checkout Redirect básico.
     * ---------------------------------------------------------
     */

    const paymentBody = {
      amount: PREMIUM_AMOUNT,
      currency: PREMIUM_CURRENCY,
      country: PREMIUM_COUNTRY,
      payment_method_flow: "REDIRECT",

      payer: {
        name: payerName,
        email: firebaseEmail,
        document,
        user_reference: uid,
      },

      order_id: orderId,

      description: "MiOficio Premium",

      callback_url: callbackUrl,
    };

    const body = JSON.stringify(paymentBody);

    /*
     * ---------------------------------------------------------
     * 8. Firma HMAC dLocal
     * ---------------------------------------------------------
     */

    const xDate = new Date().toISOString();

    const signature = createSignature(
      DLOCAL_X_LOGIN,
      xDate,
      body,
      DLOCAL_SECRET_KEY
    );

    const idempotencyKey = randomUUID();

    /*
     * ---------------------------------------------------------
     * 9. Log seguro
     * ---------------------------------------------------------
     */

    console.log("Enviando Checkout básico a dLocal:", {
      amount: PREMIUM_AMOUNT,
      currency: PREMIUM_CURRENCY,
      country: PREMIUM_COUNTRY,
      flow: "REDIRECT",
      orderId,
      hasDocument: Boolean(document),
      callbackUrl,
      apiUrl: DLOCAL_API_URL,
      paymentBody,
    });

    /*
     * ---------------------------------------------------------
     * 10. Crear pago en dLocal
     * ---------------------------------------------------------
     */

    const apiBase = DLOCAL_API_URL.replace(/\/+$/, "");

    const dLocalResponse = await fetch(
      `${apiBase}/payments`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "X-Date": xDate,
          "X-Login": DLOCAL_X_LOGIN,
          "X-Trans-Key": DLOCAL_X_TRANS_KEY,
          "X-Version": "2.1",
          "User-Agent": "MiOficio/1.0",
          "X-Idempotency-Key": idempotencyKey,
          "Authorization": `V2-HMAC-SHA256, Signature: ${signature}`,
        },

        body,

        cache: "no-store",
      }
    );

    /*
     * ---------------------------------------------------------
     * 11. Leer respuesta
     * ---------------------------------------------------------
     */

    const rawResponse = await dLocalResponse.text();

    let dLocalData: any = null;

    try {
      dLocalData = rawResponse
        ? JSON.parse(rawResponse)
        : null;
    } catch {
      dLocalData = null;
    }

    /*
     * ---------------------------------------------------------
     * 12. Error dLocal
     * ---------------------------------------------------------
     */

    if (!dLocalResponse.ok) {
      console.error(
        "dLocal rechazó el Checkout básico:",
        {
          status: dLocalResponse.status,
          code: dLocalData?.code,
          message: dLocalData?.message,
          param: dLocalData?.param,
          error: dLocalData?.error,
          detail: dLocalData?.detail,
          response: dLocalData,
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
          error: dLocalMessage,
          dlocalStatus: dLocalResponse.status,
          dlocalCode: dLocalData?.code ?? null,
          dlocalParam: dLocalData?.param ?? null,
          orderId,
        },
        {
          status:
            dLocalResponse.status >= 400 &&
            dLocalResponse.status < 600
              ? dLocalResponse.status
              : 502,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 13. Pago creado
     * ---------------------------------------------------------
     */

    const paymentId = dLocalData?.id ?? null;

    const paymentStatus =
      dLocalData?.status ?? "PENDING";

    const redirectUrl =
      dLocalData?.redirect_url ??
      dLocalData?.redirect_URL ??
      dLocalData?.redirectUrl ??
      null;

    /*
     * ---------------------------------------------------------
     * 14. Guardar orden en Firebase
     * ---------------------------------------------------------
     */

    await database
      .ref(`dlocal_orders/${orderId}`)
      .set({
        order_id: orderId,
        payment_id: paymentId,
        uid,
        email: firebaseEmail,

        amount: PREMIUM_AMOUNT,
        currency: PREMIUM_CURRENCY,
        country: PREMIUM_COUNTRY,

        product: "MiOficio Premium",
        provider: "dlocal",

        status: paymentStatus,

        payment_flow: "REDIRECT",

        save_payment_method: false,

        notification_url: NOTIFICATION_URL,

        callback_url: callbackUrl,

        redirect_url: redirectUrl,

        created_at: new Date().toISOString(),
      });

    /*
     * ---------------------------------------------------------
     * 15. Log de éxito
     * ---------------------------------------------------------
     */

    console.log(
      "Checkout dLocal creado correctamente:",
      {
        orderId,
        paymentId,
        status: paymentStatus,
        hasRedirectUrl: Boolean(redirectUrl),
      }
    );

    /*
     * ---------------------------------------------------------
     * 16. Respuesta al frontend
     * ---------------------------------------------------------
     */

    return NextResponse.json({
      ok: true,
      orderId,
      paymentId,
      status: paymentStatus,

      redirectUrl,
      redirect_url: redirectUrl,

      message:
        "Checkout creado correctamente. Redirigiendo a dLocal.",
    });
  } catch (error) {
    console.error(
      "Error interno creando Checkout dLocal:",
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
      {
        status: 500,
      }
    );
  }
}

/*
 * ---------------------------------------------------------
 * GET
 * ---------------------------------------------------------
 */

export async function GET() {
  const callbackUrl =
    `${APP_URL.replace(/\/+$/, "")}/?dlocal=return`;

  return NextResponse.json({
    ok: true,

    service:
      "MiOficio dLocal create payment",

    method: "POST",

    product:
      "MiOficio Premium",

    amount:
      PREMIUM_AMOUNT,

    currency:
      PREMIUM_CURRENCY,

    country:
      PREMIUM_COUNTRY,

    paymentFlow:
      "REDIRECT",

    savePaymentMethod:
      false,

    notificationConfigured:
      Boolean(NOTIFICATION_URL),

    notificationUrl:
      NOTIFICATION_URL,

    callbackUrl,
  });
}