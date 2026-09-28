import {
  createHmac,
  timingSafeEqual,
} from "crypto";

import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * ============================================================
 * DLOCAL WEBHOOK
 * ============================================================
 *
 * Recibe las notificaciones de estado de los pagos de dLocal.
 *
 * Estados importantes:
 *
 * PAID
 * REJECTED
 * CANCELLED
 * PENDING
 *
 * La firma se verifica utilizando:
 *
 * X-Login + X-Date + RequestBody
 *
 * con HMAC-SHA256 y DLOCAL_SECRET_KEY.
 *
 * dLocal documenta actualmente las notificaciones y su
 * validación mediante firma HMAC-SHA256.
 *
 * ============================================================
 */

/**
 * Genera la firma esperada por dLocal.
 */
function createDLocalSignature(
  login: string,
  date: string,
  secretKey: string,
  body: string
): string {
  const message =
    login +
    date +
    body;

  return createHmac(
    "sha256",
    secretKey
  )
    .update(message, "utf8")
    .digest("hex");
}

/**
 * Compara dos firmas de forma segura.
 */
function safeCompare(
  received: string,
  expected: string
): boolean {
  try {
    const receivedBuffer =
      Buffer.from(
        received,
        "utf8"
      );

    const expectedBuffer =
      Buffer.from(
        expected,
        "utf8"
      );

    if (
      receivedBuffer.length !==
      expectedBuffer.length
    ) {
      return false;
    }

    return timingSafeEqual(
      receivedBuffer,
      expectedBuffer
    );
  } catch {
    return false;
  }
}

/**
 * Extrae solamente el valor hexadecimal de una firma.
 *
 * Acepta:
 *
 * 1. Signature: abc123...
 *
 * 2. Authorization:
 *    V2-HMAC-SHA256, Signature: abc123...
 */
function normalizeSignature(
  value: string | null
): string | null {
  if (!value) {
    return null;
  }

  const trimmed =
    value.trim();

  if (!trimmed) {
    return null;
  }

  /*
   * Caso:
   *
   * V2-HMAC-SHA256, Signature: abc...
   */
  const authorizationMatch =
    trimmed.match(
      /Signature:\s*([a-fA-F0-9]+)$/i
    );

  if (
    authorizationMatch?.[1]
  ) {
    return authorizationMatch[1]
      .toLowerCase();
  }

  /*
   * Caso:
   *
   * Signature: abc...
   */
  const signatureMatch =
    trimmed.match(
      /^([a-fA-F0-9]+)$/
    );

  if (
    signatureMatch?.[1]
  ) {
    return signatureMatch[1]
      .toLowerCase();
  }

  return null;
}

/**
 * Convierte un email en una clave segura.
 */
function safeEmailKey(
  email: string
): string {
  return email
    .toLowerCase()
    .replace(
      /[.#$[\]\\/]/g,
      "_"
    )
    .slice(0, 100);
}

/**
 * GET
 *
 * Endpoint de diagnóstico.
 *
 * No expone ninguna credencial.
 */
export async function GET() {
  const xLogin =
    process.env.DLOCAL_X_LOGIN?.trim() ||
    "";

  const secretKey =
    process.env.DLOCAL_SECRET_KEY?.trim() ||
    "";

  return Response.json({
    ok: true,

    route:
      "dlocal-webhook",

    message:
      "Webhook de dLocal de MiOficio funcionando correctamente.",

    xLoginConfigured:
      Boolean(xLogin),

    secretKeyConfigured:
      Boolean(secretKey),

    webhookConfigured:
      Boolean(xLogin) &&
      Boolean(secretKey),
  });
}

/**
 * POST
 *
 * Endpoint que recibe las notificaciones de dLocal.
 */
export async function POST(
  request: Request
) {
  try {
    /*
     * ========================================================
     * 1. OBTENER CREDENCIALES
     * ========================================================
     */

    const xLogin =
      process.env.DLOCAL_X_LOGIN?.trim();

    const secretKey =
      process.env.DLOCAL_SECRET_KEY?.trim();

    if (!xLogin) {
      console.error(
        "Webhook dLocal: falta DLOCAL_X_LOGIN."
      );

      return Response.json(
        {
          ok: false,
          error:
            "Webhook dLocal no configurado: falta DLOCAL_X_LOGIN.",
        },
        {
          status: 500,
        }
      );
    }

    if (!secretKey) {
      console.error(
        "Webhook dLocal: falta DLOCAL_SECRET_KEY."
      );

      return Response.json(
        {
          ok: false,
          error:
            "Webhook dLocal no configurado: falta DLOCAL_SECRET_KEY.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * ========================================================
     * 2. OBTENER X-DATE
     * ========================================================
     */

    const xDate =
      request.headers.get(
        "x-date"
      ) ||
      request.headers.get(
        "X-Date"
      );

    if (!xDate) {
      console.error(
        "Webhook dLocal: falta X-Date."
      );

      return Response.json(
        {
          ok: false,
          error:
            "Falta el header X-Date.",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * ========================================================
     * 3. OBTENER FIRMA
     * ========================================================
     *
     * dLocal puede enviar la firma en:
     *
     * Signature
     *
     * o en:
     *
     * Authorization
     *
     * dependiendo del flujo/documentación.
     */

    const signatureHeader =
      request.headers.get(
        "signature"
      ) ||
      request.headers.get(
        "Signature"
      );

    const authorizationHeader =
      request.headers.get(
        "authorization"
      ) ||
      request.headers.get(
        "Authorization"
      );

    const receivedSignature =
      normalizeSignature(
        signatureHeader ||
        authorizationHeader
      );

    if (!receivedSignature) {
      console.error(
        "Webhook dLocal: no se recibió una firma válida."
      );

      return Response.json(
        {
          ok: false,
          error:
            "No se recibió una firma válida de dLocal.",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * ========================================================
     * 4. LEER BODY ORIGINAL
     * ========================================================
     *
     * IMPORTANTE:
     *
     * No usamos request.json() para calcular la firma.
     *
     * Utilizamos el body RAW exactamente como llegó.
     */

    const rawBody =
      await request.text();

    if (!rawBody) {
      console.error(
        "Webhook dLocal: body vacío."
      );

      return Response.json(
        {
          ok: false,
          error:
            "El webhook recibió un body vacío.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * ========================================================
     * 5. CALCULAR FIRMA ESPERADA
     * ========================================================
     */

    const expectedSignature =
      createDLocalSignature(
        xLogin,
        xDate,
        secretKey,
        rawBody
      );

    /*
     * ========================================================
     * 6. VERIFICAR FIRMA
     * ========================================================
     */

    const signatureIsValid =
      safeCompare(
        receivedSignature,
        expectedSignature
      );

    if (!signatureIsValid) {
      console.error(
        "Webhook dLocal: firma inválida."
      );

      return Response.json(
        {
          ok: false,
          error:
            "Firma del webhook inválida.",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * ========================================================
     * 7. PARSEAR JSON
     * ========================================================
     */

    let notification: Record<
      string,
      any
    >;

    try {
      notification =
        JSON.parse(
          rawBody
        );
    } catch {
      console.error(
        "Webhook dLocal: JSON inválido."
      );

      return Response.json(
        {
          ok: false,
          error:
            "El body recibido no contiene un JSON válido.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * ========================================================
     * 8. EXTRAER INFORMACIÓN DEL PAGO
     * ========================================================
     */

    const paymentId =
      typeof notification.id ===
      "string"
        ? notification.id
        : null;

    const orderId =
      typeof notification.order_id ===
      "string"
        ? notification.order_id
        : null;

    const status =
      typeof notification.status ===
      "string"
        ? notification.status
            .toUpperCase()
        : "UNKNOWN";

    const statusDetail =
      typeof notification.status_detail ===
      "string"
        ? notification.status_detail
        : null;

    const statusCode =
      notification.status_code ??
      null;

    const amount =
      notification.amount ??
      null;

    const currency =
      typeof notification.currency ===
      "string"
        ? notification.currency
        : null;

    const country =
      typeof notification.country ===
      "string"
        ? notification.country
        : null;

    const paymentMethodId =
      typeof notification.payment_method_id ===
      "string"
        ? notification.payment_method_id
        : null;

    const paymentMethodType =
      typeof notification.payment_method_type ===
      "string"
        ? notification.payment_method_type
        : null;

    const paymentMethodFlow =
      typeof notification.payment_method_flow ===
      "string"
        ? notification.payment_method_flow
        : null;

    const payer =
      notification.payer &&
      typeof notification.payer ===
        "object"
        ? notification.payer
        : null;

    const payerEmail =
      typeof payer?.email ===
      "string"
        ? payer.email
            .trim()
            .toLowerCase()
        : null;

    /*
     * ========================================================
     * 9. VALIDACIONES BÁSICAS
     * ========================================================
     */

    if (!paymentId) {
      console.error(
        "Webhook dLocal: falta notification.id.",
        notification
      );

      return Response.json(
        {
          ok: false,
          error:
            "La notificación no contiene payment ID.",
        },
        {
          status: 400,
        }
      );
    }

    if (!orderId) {
      console.error(
        "Webhook dLocal: falta order_id.",
        notification
      );

      return Response.json(
        {
          ok: false,
          error:
            "La notificación no contiene order_id.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * ========================================================
     * 10. LOG DEL PAGO
     * ========================================================
     *
     * NO mostramos credenciales.
     */

    console.log(
      "=========================================="
    );

    console.log(
      "DLOCAL WEBHOOK - MIOFICIO"
    );

    console.log(
      "=========================================="
    );

    console.log({
      paymentId,
      orderId,
      status,
      statusCode,
      statusDetail,
      amount,
      currency,
      country,
      paymentMethodId,
      paymentMethodType,
      paymentMethodFlow,
      payerEmail,
    });

    /*
     * ========================================================
     * 11. GUARDAR NOTIFICACIÓN EN FIREBASE
     * ========================================================
     *
     * Guardamos el evento completo para tener trazabilidad.
     *
     * Esto NO activa Premium todavía.
     *
     * Primero dejamos funcionando correctamente el webhook.
     * Luego conectamos PAID con es_premium en el perfil.
     */

    try {
      const database =
        getAdminDb();

      const paymentKey =
        paymentId
          .replace(
            /[.#$[\]\\/]/g,
            "_"
          )
          .slice(0, 150);

      await database
        .ref(
          `dlocal_payments/${paymentKey}`
        )
        .set({
          paymentId,

          orderId,

          status,

          statusCode,

          statusDetail,

          amount,

          currency,

          country,

          paymentMethodId,

          paymentMethodType,

          paymentMethodFlow,

          payerEmail,

          notification,

          receivedAt:
            new Date().toISOString(),
        });

      console.log(
        "Webhook dLocal guardado en Firebase:",
        paymentId
      );
    } catch (
      firebaseError
    ) {
      /*
       * No ocultamos el error.
       */

      console.error(
        "No se pudo guardar el webhook dLocal en Firebase:",
        firebaseError
      );

      /*
       * Respondemos 500 para que dLocal pueda reintentar
       * la notificación.
       */
      return Response.json(
        {
          ok: false,

          error:
            "No se pudo procesar la notificación en Firebase.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * ========================================================
     * 12. PROCESAMIENTO SEGÚN ESTADO
     * ========================================================
     */

    switch (status) {
      case "PAID": {
        console.log(
          "=========================================="
        );

        console.log(
          "PAGO MIOFICIO PREMIUM CONFIRMADO"
        );

        console.log(
          "=========================================="
        );

        console.log({
          paymentId,
          orderId,
          payerEmail,
          amount,
          currency,
        });

        /*
         * IMPORTANTE:
         *
         * Todavía NO modificamos es_premium.
         *
         * Primero necesitamos confirmar la estructura
         * exacta donde MiOficio guarda el perfil del usuario.
         *
         * Una vez confirmada, este bloque será el encargado
         * de activar:
         *
         * es_premium: true
         */

        break;
      }

      case "REJECTED": {
        console.log(
          "Pago MiOficio rechazado:",
          {
            paymentId,
            orderId,
            payerEmail,
            statusDetail,
          }
        );

        break;
      }

      case "CANCELLED": {
        console.log(
          "Pago MiOficio cancelado:",
          {
            paymentId,
            orderId,
            payerEmail,
            statusDetail,
          }
        );

        break;
      }

      case "PENDING": {
        console.log(
          "Pago MiOficio pendiente:",
          {
            paymentId,
            orderId,
            payerEmail,
          }
        );

        break;
      }

      default: {
        console.log(
          "Estado dLocal recibido:",
          {
            paymentId,
            orderId,
            status,
            payerEmail,
          }
        );

        break;
      }
    }

    /*
     * ========================================================
     * 13. RESPUESTA 200
     * ========================================================
     *
     * Es importante responder 200 cuando procesamos
     * correctamente la notificación.
     *
     * dLocal utiliza la respuesta 200 como confirmación.
     */

    return Response.json(
      {
        ok: true,

        received: true,

        provider:
          "dlocal",

        paymentId,

        orderId,

        status,
      },
      {
        status: 200,
      }
    );
  } catch (
    error: unknown
  ) {
    console.error(
      "Error interno procesando webhook dLocal:",
      error
    );

    return Response.json(
      {
        ok: false,

        error:
          "Error interno procesando la notificación de dLocal.",

        detail:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}