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

/**
 * Obtiene la firma enviada por dLocal.
 *
 * dLocal utiliza:
 *
 * Authorization:
 * V2-HMAC-SHA256, Signature: <hash>
 *
 * También dejamos soporte para un header
 * "signature" por si el entorno de notificaciones
 * lo entrega de esa manera.
 */
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

/**
 * Compara dos firmas de forma segura.
 */
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

/**
 * POST
 *
 * Este es el endpoint que recibe la notificación
 * de dLocal.
 */
export async function POST(request: Request) {
  try {
    /**
     * IMPORTANTE:
     *
     * No usamos request.json().
     *
     * Necesitamos conservar exactamente el body
     * recibido porque el body forma parte de la
     * firma HMAC.
     */
    const rawBody =
      await request.text();

    /**
     * Variables de entorno.
     */
    const xLogin =
      process.env.DLOCAL_X_LOGIN?.trim();

    const secretKey =
      process.env.DLOCAL_SECRET_KEY?.trim();

    /**
     * Headers enviados por dLocal.
     */
    const xDate =
      request.headers
        .get("x-date")
        ?.trim() || "";

    const authorization =
      request.headers
        .get("authorization")
        ?.trim() || "";

    const signatureHeader =
      request.headers
        .get("signature")
        ?.trim() || "";

    const xLoginHeader =
      request.headers
        .get("x-login")
        ?.trim() || "";

    const xVersion =
      request.headers
        .get("x-version")
        ?.trim() || "";

    /**
     * ==================================================
     * DIAGNÓSTICO SEGURO
     * ==================================================
     *
     * NO mostramos:
     *
     * - DLOCAL_X_LOGIN completo
     * - DLOCAL_SECRET_KEY
     * - Authorization completo
     * - Signature completa
     * - Body completo
     *
     * Solo mostramos información útil para
     * descubrir qué está enviando dLocal.
     */

    console.log(
      "========== dLocal WEBHOOK DIAGNÓSTICO =========="
    );

    console.log(
      "Webhook dLocal diagnóstico:",
      {
        method:
          request.method,

        url:
          request.url,

        bodyLength:
          rawBody.length,

        hasAuthorizationHeader:
          Boolean(authorization),

        authorizationLength:
          authorization.length,

        authorizationPrefix:
          authorization
            ? authorization
                .slice(0, 25)
                .replace(
                  /Signature.*$/i,
                  "Signature: ***"
                )
            : "",

        hasSignatureHeader:
          Boolean(signatureHeader),

        signatureHeaderLength:
          signatureHeader.length,

        hasXDate:
          Boolean(xDate),

        xDateLength:
          xDate.length,

        xDateValue:
          xDate
            ? xDate
            : "NO ENVIADO",

        hasXLoginHeader:
          Boolean(xLoginHeader),

        xLoginHeaderLength:
          xLoginHeader.length,

        xVersion:
          xVersion || "NO ENVIADO",

        envHasXLogin:
          Boolean(xLogin),

        envXLoginLength:
          xLogin?.length || 0,

        envHasSecret:
          Boolean(secretKey),

        receivedSignatureDetected:
          Boolean(
            getSignature(request)
          ),

        receivedSignatureLength:
          getSignature(request).length,

        contentType:
          request.headers.get(
            "content-type"
          ) || "",

        userAgent:
          request.headers.get(
            "user-agent"
          ) || "",

        allHeaders:
          Array.from(
            request.headers.keys()
          ),
      }
    );

    console.log(
      "================================================="
    );

    /**
     * Verificamos configuración.
     */
    if (!xLogin || !secretKey) {
      console.error(
        "Webhook dLocal: faltan variables de entorno."
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

    /**
     * X-Date es obligatorio para calcular
     * la firma.
     */
    if (!xDate) {
      console.error(
        "Webhook dLocal: falta X-Date."
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

    /**
     * Extraemos la firma.
     */
    const receivedSignature =
      getSignature(request);

    if (!receivedSignature) {
      console.error(
        "Webhook dLocal: no se pudo extraer la firma."
      );

      return NextResponse.json(
        {
          error:
            "Falta Signature/Authorization.",
        },
        {
          status: 401,
        }
      );
    }

    /**
     * ==================================================
     * GENERACIÓN DE FIRMA
     * ==================================================
     *
     * Según dLocal:
     *
     * X-Login + X-Date + RequestBody
     *
     * HMAC-SHA256 usando Secret Key.
     */
    const dataToSign =
      xLogin +
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

    /**
     * Diagnóstico de la firma.
     *
     * NO mostramos la firma completa.
     */
    console.log(
      "Webhook dLocal firma:",
      {
        receivedSignatureLength:
          receivedSignature.length,

        expectedSignatureLength:
          expectedSignature.length,

        receivedSignaturePrefix:
          receivedSignature.slice(
            0,
            8
          ),

        expectedSignaturePrefix:
          expectedSignature.slice(
            0,
            8
          ),

        signaturesMatch:
          receivedSignature ===
          expectedSignature,

        receivedIs64Hex:
          /^[a-fA-F0-9]{64}$/.test(
            receivedSignature
          ),

        expectedIs64Hex:
          /^[a-fA-F0-9]{64}$/.test(
            expectedSignature
          ),
      }
    );

    /**
     * Verificación segura.
     */
    if (
      !verifySignature(
        receivedSignature,
        expectedSignature
      )
    ) {
      console.error(
        "Webhook dLocal: FIRMA INVÁLIDA."
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

    console.log(
      "Webhook dLocal: FIRMA VÁLIDA."
    );

    /**
     * ==================================================
     * PARSEAMOS EL BODY
     * ==================================================
     */
    let notification: any;

    try {
      notification =
        JSON.parse(rawBody);
    } catch (error) {
      console.error(
        "Webhook dLocal: JSON inválido.",
        error
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

    /**
     * Extraemos información básica.
     */
    const paymentId =
      notification?.id || "";

    const orderId =
      notification?.order_id || "";

    const status =
      notification?.status || "";

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
      payer?.user_reference ||
      "";

    const payerEmail =
      typeof payer?.email ===
      "string"
        ? payer.email.trim()
        : "";

    /**
     * Log seguro del contenido importante.
     *
     * NO mostramos datos sensibles completos.
     */
    console.log(
      "Webhook dLocal notificación:",
      {
        paymentId:
          paymentId
            ? String(paymentId)
                .slice(0, 20)
            : "",

        orderId:
          orderId
            ? String(orderId)
                .slice(0, 40)
            : "",

        status,

        statusCode,

        statusDetail,

        amount,

        currency,

        hasPayer:
          Boolean(
            notification?.payer
          ),

        hasUserReference:
          Boolean(
            userReference
          ),

        hasPayerEmail:
          Boolean(
            payerEmail
          ),
      }
    );

    /**
     * Necesitamos ID y order_id para
     * guardar correctamente el pago.
     */
    if (
      !paymentId ||
      !orderId
    ) {
      console.error(
        "Webhook dLocal: faltan id u order_id."
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

    /**
     * ==================================================
     * FIREBASE
     * ==================================================
     */
    const db =
      getAdminDb();

    /**
     * Guardamos la notificación únicamente
     * después de comprobar la firma.
     */
    await db
      .ref(
        `dlocal_payments/${paymentId}`
      )
      .set({
        ...notification,

        received_at:
          new Date().toISOString(),

        signature_verified:
          true,
      });

    console.log(
      "Webhook dLocal: pago guardado en Firebase.",
      paymentId
    );

    /**
     * ==================================================
     * ESTADO DEL PAGO
     * ==================================================
     */
    if (
      status !== "PAID"
    ) {
      console.log(
        "Webhook dLocal: pago recibido con estado:",
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

    /**
     * ==================================================
     * IDENTIFICAR USUARIO
     * ==================================================
     *
     * Primero intentamos usar:
     *
     * payer.user_reference
     *
     * que en MiOficio contiene el UID de Firebase.
     */
    let userEmail =
      payerEmail;

    if (
      userReference
    ) {
      try {
        const auth =
          getAdminAuth();

        const firebaseUser =
          await auth.getUser(
            userReference
          );

        if (
          firebaseUser.email
        ) {
          userEmail =
            firebaseUser.email.trim();
        }

        console.log(
          "Webhook dLocal: usuario Firebase identificado."
        );
      } catch (error) {
        console.error(
          "Webhook dLocal: no se pudo obtener el usuario Firebase.",
          error
        );
      }
    }

    /**
     * Si no conseguimos el email,
     * no activamos Premium.
     */
    if (!userEmail) {
      console.error(
        "Webhook dLocal: no se pudo identificar al usuario."
      );

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

    /**
     * Generamos la clave compatible con
     * la estructura actual de Firebase.
     */
    const emailKey =
      safeEmailKey(
        userEmail
      );

    console.log(
      "Webhook dLocal: emailKey generado."
    );

    /**
     * ==================================================
     * ACTIVAR PREMIUM
     * ==================================================
     */
    const perfilRef =
      db.ref(
        `usuarios_data/${emailKey}/perfil`
      );

    const perfilSnapshot =
      await perfilRef.once(
        "value"
      );

    const perfilActual =
      perfilSnapshot.exists()
        ? perfilSnapshot.val()
        : {};

    await perfilRef.set({
      ...perfilActual,

      es_premium:
        true,

      premium_activado_at:
        new Date().toISOString(),

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

    console.log(
      "Webhook dLocal: PREMIUM ACTIVADO."
    );

    /**
     * Respuesta 200.
     *
     * Esto le indica a dLocal que
     * recibimos correctamente la notificación.
     */
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
      "Webhook dLocal: ERROR INTERNO.",
      error
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

/**
 * GET
 *
 * Sirve solamente para comprobar que
 * la ruta está publicada y funcionando.
 *
 * dLocal NO utiliza este GET para enviar
 * las notificaciones de pago.
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