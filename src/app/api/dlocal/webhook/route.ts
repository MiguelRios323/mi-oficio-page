import { NextResponse } from "next/server";
import crypto from "crypto";

import {
  getAdminAuth,
  getAdminDb,
} from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]\\/]/g, "_")
    .slice(0, 100);
}

function getSignature(request: Request): string {
  const authorization =
    request.headers.get("authorization");

  if (authorization) {
    const value = authorization.trim();

    const match = value.match(
      /Signature\s*:\s*([a-fA-F0-9]{64})/i
    );

    if (match) {
      return match[1].toLowerCase();
    }

    if (/^[a-fA-F0-9]{64}$/.test(value)) {
      return value.toLowerCase();
    }
  }

  const signatureHeader =
    request.headers.get("signature");

  if (signatureHeader) {
    const value = signatureHeader.trim();

    const match = value.match(
      /Signature\s*:\s*([a-fA-F0-9]{64})/i
    );

    if (match) {
      return match[1].toLowerCase();
    }

    if (/^[a-fA-F0-9]{64}$/.test(value)) {
      return value.toLowerCase();
    }
  }

  return "";
}

function verifySignature(
  received: string,
  expected: string
): boolean {
  const receivedBuffer =
    Buffer.from(received, "utf8");

  const expectedBuffer =
    Buffer.from(expected, "utf8");

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

export async function POST(request: Request) {
  try {
    /*
     * =========================================================
     * 1. LEER BODY Y HEADERS
     * =========================================================
     */

    const rawBody = await request.text();

    const secretKey =
      process.env.DLOCAL_SECRET_KEY?.trim();

    const envXLogin =
      process.env.DLOCAL_X_LOGIN?.trim();

    const xLoginHeader =
      request.headers.get("x-login")?.trim() || "";

    const xDate =
      request.headers.get("x-date")?.trim() || "";

    /*
     * dLocal envía X-Login en el webhook.
     *
     * Para verificar la firma usamos el X-Login recibido
     * por dLocal, que fue el que confirmó correctamente
     * nuestra integración.
     */

    const signingXLogin =
      xLoginHeader || envXLogin || "";

    const receivedSignature =
      getSignature(request);

    /*
     * =========================================================
     * 2. VALIDAR CONFIGURACIÓN
     * =========================================================
     */

    if (!secretKey) {
      console.error(
        "dLocal webhook: falta DLOCAL_SECRET_KEY."
      );

      return NextResponse.json(
        {
          error:
            "Configuración dLocal incompleta.",
        },
        {
          status: 500,
        }
      );
    }

    if (!signingXLogin) {
      console.error(
        "dLocal webhook: falta X-Login."
      );

      return NextResponse.json(
        {
          error:
            "Falta X-Login.",
        },
        {
          status: 401,
        }
      );
    }

    if (!xDate) {
      console.error(
        "dLocal webhook: falta X-Date."
      );

      return NextResponse.json(
        {
          error:
            "Falta X-Date.",
        },
        {
          status: 401,
        }
      );
    }

    if (!receivedSignature) {
      console.error(
        "dLocal webhook: firma no encontrada."
      );

      return NextResponse.json(
        {
          error:
            "Falta firma.",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * =========================================================
     * 3. VERIFICAR FIRMA HMAC-SHA256
     *
     * dLocal:
     *
     * X-Login + X-Date + RequestBody
     *
     * HMAC-SHA256 usando Secret Key.
     * =========================================================
     */

    const dataToSign =
      signingXLogin +
      xDate +
      rawBody;

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(
          dataToSign,
          "utf8"
        )
        .digest("hex")
        .toLowerCase();

    const signatureIsValid =
      verifySignature(
        receivedSignature,
        expectedSignature
      );

    if (!signatureIsValid) {
      console.error(
        "dLocal webhook: firma inválida."
      );

      return NextResponse.json(
        {
          error:
            "Firma inválida.",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * =========================================================
     * 4. PARSEAR NOTIFICACIÓN
     * =========================================================
     */

    let notification: any;

    try {
      notification =
        JSON.parse(rawBody);
    } catch {
      console.error(
        "dLocal webhook: JSON inválido."
      );

      return NextResponse.json(
        {
          error:
            "JSON inválido.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =========================================================
     * 5. EXTRAER DATOS
     * =========================================================
     */

    const paymentId =
      notification?.id
        ? String(notification.id)
        : "";

    const orderId =
      notification?.order_id
        ? String(notification.order_id)
        : "";

    const status =
      notification?.status
        ? String(notification.status)
        : "";

    const statusCode =
      notification?.status_code ??
      null;

    const statusDetail =
      notification?.status_detail ??
      null;

    const amount =
      notification?.amount ??
      null;

    const currency =
      notification?.currency ??
      null;

    const payer =
      notification?.payer || {};

    const userReference =
      payer?.user_reference
        ? String(payer.user_reference)
        : "";

    const payerEmail =
      typeof payer?.email === "string"
        ? payer.email.trim()
        : "";

    if (!paymentId || !orderId) {
      console.error(
        "dLocal webhook: faltan id u order_id."
      );

      return NextResponse.json(
        {
          error:
            "Faltan datos obligatorios.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =========================================================
     * 6. FIREBASE
     * =========================================================
     */

    const db = getAdminDb();

    const paymentRef =
      db.ref(
        `dlocal_payments/${paymentId}`
      );

    /*
     * =========================================================
     * 7. IDEMPOTENCIA
     *
     * dLocal puede enviar la misma notificación más de una vez.
     *
     * Si este pago YA activó Premium, respondemos 200 y
     * no volvemos a procesarlo.
     * =========================================================
     */

    const existingSnapshot =
      await paymentRef.once("value");

    const existingPayment =
      existingSnapshot.exists()
        ? existingSnapshot.val()
        : null;

    if (
      existingPayment?.premium_activated === true
    ) {
      console.log(
        "dLocal webhook: pago ya procesado."
      );

      return NextResponse.json(
        {
          received: true,
          duplicate: true,
          premiumActivated: true,
        },
        {
          status: 200,
        }
      );
    }

    /*
     * =========================================================
     * 8. GUARDAR NOTIFICACIÓN
     * =========================================================
     */

    await paymentRef.update({
      ...notification,

      received_at:
        new Date().toISOString(),

      signature_verified:
        true,

      signature_verified_at:
        new Date().toISOString(),
    });

    /*
     * =========================================================
     * 9. SI NO ESTÁ PAID
     * =========================================================
     */

    if (status !== "PAID") {
      console.log(
        "dLocal webhook: estado recibido:",
        status
      );

      return NextResponse.json(
        {
          received: true,

          premiumActivated:
            false,

          status,
        },
        {
          status: 200,
        }
      );
    }

    /*
     * =========================================================
     * 10. IDENTIFICAR USUARIO
     *
     * Primero intentamos Firebase UID mediante
     * payer.user_reference.
     *
     * Como alternativa usamos payer.email.
     * =========================================================
     */

    let userEmail =
      payerEmail;

    if (userReference) {
      try {
        const auth =
          getAdminAuth();

        const firebaseUser =
          await auth.getUser(
            userReference
          );

        if (firebaseUser.email) {
          userEmail =
            firebaseUser.email.trim();
        }
      } catch {
        console.error(
          "dLocal webhook: no se pudo identificar Firebase UID."
        );
      }
    }

    /*
     * =========================================================
     * 11. SI NO PODEMOS IDENTIFICAR USUARIO
     * =========================================================
     */

    if (!userEmail) {
      console.error(
        "dLocal webhook: usuario no identificado."
      );

      await paymentRef.update({
        premium_activated:
          false,

        processing_error:
          "Usuario no identificado.",

        processed_at:
          new Date().toISOString(),
      });

      /*
       * Respondemos 200 porque la notificación fue recibida
       * correctamente y la firma fue válida.
       */
      return NextResponse.json(
        {
          received: true,

          premiumActivated:
            false,

          reason:
            "Usuario no identificado.",
        },
        {
          status: 200,
        }
      );
    }

    /*
     * =========================================================
     * 12. ACTIVAR PREMIUM EN PERFIL
     * =========================================================
     */

    const emailKey =
      safeEmailKey(userEmail);

    const perfilRef =
      db.ref(
        `usuarios_data/${emailKey}/perfil`
      );

    const perfilSnapshot =
      await perfilRef.once("value");

    const perfilActual =
      perfilSnapshot.exists()
        ? perfilSnapshot.val()
        : {};

    const premiumActivatedAt =
      new Date().toISOString();

    await perfilRef.set({
      ...perfilActual,

      es_premium:
        true,

      premium_activado_at:
        premiumActivatedAt,

      premium_payment_id:
        paymentId,

      premium_order_id:
        orderId,

      premium_amount:
        amount,

      premium_currency:
        currency,

      premium_provider:
        "dlocal",
    });

    /*
     * =========================================================
     * 13. MARCAR PAGO COMO PROCESADO
     * =========================================================
     */

    await paymentRef.update({
      premium_activated:
        true,

      premium_activated_at:
        premiumActivatedAt,

      premium_user_email:
        userEmail,

      premium_user_reference:
        userReference || null,

      processed_at:
        new Date().toISOString(),

      processing_status:
        "COMPLETED",

      status_code:
        statusCode,

      status_detail:
        statusDetail,
    });

    /*
     * =========================================================
     * 14. RESPUESTA FINAL
     * =========================================================
     */

    console.log(
      "dLocal webhook: PREMIUM ACTIVADO."
    );

    return NextResponse.json(
      {
        received: true,

        premiumActivated:
          true,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "dLocal webhook: error interno."
    );

    return NextResponse.json(
      {
        error:
          "Error interno del webhook.",
      },
      {
        status: 500,
      }
    );
  }
}

/*
 * =========================================================
 * GET — COMPROBAR QUE EL WEBHOOK ESTÁ ACTIVO
 * =========================================================
 */

export async function GET() {
  return NextResponse.json({
    ok: true,

    service:
      "MiOficio dLocal webhook",

    endpoint:
      "/api/dlocal/webhook",

    method:
      "POST",

    message:
      "Webhook activo. Las notificaciones de dLocal llegan mediante POST.",
  });
}