import {
  createHmac,
  timingSafeEqual,
} from "crypto";

import {
  getAdminAuth,
  getAdminDb,
} from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ============================================================
 * DLOCAL WEBHOOK - MIOFICIO
 * ============================================================
 *
 * Recibe las notificaciones de dLocal.
 *
 * Cuando el estado es PAID:
 *
 * 1. Guarda el pago en Firebase.
 * 2. Identifica al usuario mediante payer.user_reference.
 * 3. Si no existe user_reference, utiliza payer.email.
 * 4. Actualiza:
 *
 *    usuarios_data/{email}/perfil/es_premium = true
 *
 * ============================================================
 */

function createDLocalSignature(
  login: string,
  date: string,
  secretKey: string,
  body: string
): string {
  const message = login + date + body;

  return createHmac("sha256", secretKey)
    .update(message, "utf8")
    .digest("hex");
}

function safeCompare(
  received: string,
  expected: string
): boolean {
  try {
    const receivedBuffer = Buffer.from(
      received,
      "utf8"
    );

    const expectedBuffer = Buffer.from(
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

function normalizeSignature(
  value: string | null
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const authorizationMatch = trimmed.match(
    /Signature:\s*([a-fA-F0-9]+)$/i
  );

  if (authorizationMatch?.[1]) {
    return authorizationMatch[1].toLowerCase();
  }

  const signatureMatch = trimmed.match(
    /^([a-fA-F0-9]+)$/
  );

  if (signatureMatch?.[1]) {
    return signatureMatch[1].toLowerCase();
  }

  return null;
}

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]\\/]/g, "_")
    .slice(0, 100);
}

/**
 * GET
 *
 * Endpoint de diagnóstico.
 */
export async function GET() {
  const xLogin =
    process.env.DLOCAL_X_LOGIN?.trim() || "";

  const secretKey =
    process.env.DLOCAL_SECRET_KEY?.trim() || "";

  return Response.json({
    ok: true,
    route: "dlocal-webhook",
    message:
      "Webhook de dLocal de MiOficio funcionando correctamente.",
    xLoginConfigured: Boolean(xLogin),
    secretKeyConfigured: Boolean(secretKey),
    webhookConfigured:
      Boolean(xLogin) && Boolean(secretKey),
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
    /**
     * ========================================================
     * 1. CREDENCIALES
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
        { status: 500 }
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
        { status: 500 }
      );
    }

    /**
     * ========================================================
     * 2. X-DATE
     * ========================================================
     */

    const xDate =
      request.headers.get("x-date");

    if (!xDate) {
      console.error(
        "Webhook dLocal: falta X-Date."
      );

      return Response.json(
        {
          ok: false,
          error: "Falta el header X-Date.",
        },
        { status: 401 }
      );
    }

    /**
     * ========================================================
     * 3. FIRMA
     * ========================================================
     */

    const signatureHeader =
      request.headers.get("signature");

    const authorizationHeader =
      request.headers.get("authorization");

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
        { status: 401 }
      );
    }

    /**
     * ========================================================
     * 4. BODY ORIGINAL
     * ========================================================
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
        { status: 400 }
      );
    }

    /**
     * ========================================================
     * 5. VERIFICAR FIRMA
     * ========================================================
     */

    const expectedSignature =
      createDLocalSignature(
        xLogin,
        xDate,
        secretKey,
        rawBody
      );

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
        { status: 401 }
      );
    }

    /**
     * ========================================================
     * 6. PARSEAR JSON
     * ========================================================
     */

    let notification: Record<
      string,
      any
    >;

    try {
      notification = JSON.parse(
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
        { status: 400 }
      );
    }

    /**
     * ========================================================
     * 7. INFORMACIÓN DEL PAGO
     * ========================================================
     */

    const paymentId =
      typeof notification.id === "string"
        ? notification.id
        : null;

    const orderId =
      typeof notification.order_id === "string"
        ? notification.order_id
        : null;

    const status =
      typeof notification.status === "string"
        ? notification.status.toUpperCase()
        : "UNKNOWN";

    const statusDetail =
      typeof notification.status_detail === "string"
        ? notification.status_detail
        : null;

    const statusCode =
      notification.status_code ?? null;

    const amount =
      notification.amount ?? null;

    const currency =
      typeof notification.currency === "string"
        ? notification.currency
        : null;

    const country =
      typeof notification.country === "string"
        ? notification.country
        : null;

    const paymentMethodId =
      typeof notification.payment_method_id === "string"
        ? notification.payment_method_id
        : null;

    const paymentMethodType =
      typeof notification.payment_method_type === "string"
        ? notification.payment_method_type
        : null;

    const paymentMethodFlow =
      typeof notification.payment_method_flow === "string"
        ? notification.payment_method_flow
        : null;

    const payer =
      notification.payer &&
      typeof notification.payer === "object"
        ? notification.payer
        : null;

    const payerEmail =
      typeof payer?.email === "string"
        ? payer.email.trim().toLowerCase()
        : null;

    const userReference =
      typeof payer?.user_reference === "string"
        ? payer.user_reference.trim()
        : null;

    /**
     * ========================================================
     * 8. VALIDACIONES
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
        { status: 400 }
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
        { status: 400 }
      );
    }

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
      userReference,
    });

    /**
     * ========================================================
     * 9. FIREBASE
     * ========================================================
     */

    const database = getAdminDb();

    const paymentKey = paymentId
      .replace(/[.#$[\]\\/]/g, "_")
      .slice(0, 150);

    /**
     * Guardamos el pago.
     */
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
        userReference,
        notification,
        receivedAt:
          new Date().toISOString(),
      });

    console.log(
      "Webhook dLocal guardado en Firebase:",
      paymentId
    );

    /**
     * ========================================================
     * 10. PAGO APROBADO
     * ========================================================
     */

    if (status === "PAID") {
      console.log(
        "=========================================="
      );

      console.log(
        "PAGO MIOFICIO PREMIUM CONFIRMADO"
      );

      console.log(
        "=========================================="
      );

      /**
       * ------------------------------------------------------
       * 10.1 DETERMINAR EMAIL DEL USUARIO
       * ------------------------------------------------------
       */

      let userEmail =
        payerEmail;

      /**
       * Primero intentamos utilizar user_reference.
       *
       * En /api/dlocal/create enviamos:
       *
       * payer.user_reference = Firebase UID
       *
       * Por lo tanto podemos recuperar el email
       * directamente desde Firebase Authentication.
       */
      if (userReference) {
        try {
          const adminAuth =
            getAdminAuth();

          const firebaseUser =
            await adminAuth.getUser(
              userReference
            );

          if (firebaseUser.email) {
            userEmail =
              firebaseUser.email
                .trim()
                .toLowerCase();
          }

          console.log(
            "Usuario identificado mediante Firebase UID:",
            userReference
          );
        } catch (authError) {
          console.error(
            "No se pudo identificar el usuario mediante user_reference:",
            authError
          );
        }
      }

      /**
       * ------------------------------------------------------
       * 10.2 VALIDAR EMAIL
       * ------------------------------------------------------
       */

      if (!userEmail) {
        console.error(
          "Pago PAID pero no se pudo identificar al usuario."
        );

        return Response.json(
          {
            ok: false,
            error:
              "Pago aprobado pero no se pudo identificar al usuario de MiOficio.",
            paymentId,
            orderId,
          },
          { status: 500 }
        );
      }

      /**
       * ------------------------------------------------------
       * 10.3 ACTUALIZAR PERFIL
       * ------------------------------------------------------
       */

      const emailKey =
        safeEmailKey(userEmail);

      const perfilRef =
        database.ref(
          `usuarios_data/${emailKey}/perfil`
        );

      /**
       * Obtenemos el perfil actual para no
       * sobrescribir otros datos.
       */
      const perfilSnapshot =
        await perfilRef.once(
          "value"
        );

      const perfilActual =
        perfilSnapshot.exists()
          ? perfilSnapshot.val()
          : {};

      /**
       * Activamos Premium.
       */
      await perfilRef.set({
        ...perfilActual,

        es_premium: true,

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
        "=========================================="
      );

      console.log(
        "MIOFICIO PREMIUM ACTIVADO"
      );

      console.log(
        "=========================================="
      );

      console.log({
        userEmail,
        emailKey,
        paymentId,
        orderId,
      });
    }

    /**
     * ========================================================
     * 11. OTROS ESTADOS
     * ========================================================
     */

    if (status === "REJECTED") {
      console.log(
        "Pago MiOficio rechazado:",
        {
          paymentId,
          orderId,
          payerEmail,
          statusDetail,
        }
      );
    }

    if (status === "CANCELLED") {
      console.log(
        "Pago MiOficio cancelado:",
        {
          paymentId,
          orderId,
          payerEmail,
          statusDetail,
        }
      );
    }

    if (status === "PENDING") {
      console.log(
        "Pago MiOficio pendiente:",
        {
          paymentId,
          orderId,
          payerEmail,
        }
      );
    }

    /**
     * ========================================================
     * 12. RESPUESTA
     * ========================================================
     */

    return Response.json(
      {
        ok: true,
        received: true,
        provider: "dlocal",
        paymentId,
        orderId,
        status,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
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
      { status: 500 }
    );
  }
}