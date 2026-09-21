import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

/**
 * Esta API utiliza Firebase Admin para verificar al usuario
 * y Mercado Pago para crear la suscripción Premium.
 *
 * TEST:
 *   MERCADOPAGO_TEST_MODE=true
 *   MERCADOPAGO_TEST_PAYER_EMAIL=testuser3694982411@testuser.com
 *
 * PRODUCCIÓN:
 *   MERCADOPAGO_TEST_MODE=false
 *
 * Importante:
 * El Access Token de TEST debe pertenecer al vendedor TEST.
 * El payer_email de TEST debe pertenecer al comprador TEST.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]]/g, "_");
}

function jsonError(
  message: string,
  status = 500,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...extra,
    },
    { status }
  );
}

/**
 * GET
 *
 * Sirve para comprobar que la API está publicada.
 *
 * URL:
 * /api/mercadopago/subscription
 */
export async function GET() {
  const testMode =
    process.env.MERCADOPAGO_TEST_MODE === "true";

  const hasAccessToken =
    Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);

  const hasFirebaseProject =
    Boolean(process.env.FIREBASE_PROJECT_ID);

  return NextResponse.json({
    ok: true,
    route: "mercadopago-subscription",
    message: "MiOficio API funcionando correctamente",
    testMode,
    configured: {
      mercadoPago: hasAccessToken,
      firebase: hasFirebaseProject,
    },
  });
}

/**
 * POST
 *
 * Crea la suscripción Premium.
 */
export async function POST(request: NextRequest) {
  try {
    console.log(
      "=========================================="
    );

    console.log(
      "MiOficio → Mercado Pago → POST /subscription"
    );

    console.log(
      "=========================================="
    );

    /**
     * 1. Firebase Authorization
     */
    const authorization =
      request.headers.get("authorization");

    if (!authorization) {
      console.error(
        "Falta header Authorization."
      );

      return jsonError(
        "No autorizado. Falta el token de Firebase.",
        401
      );
    }

    if (!authorization.startsWith("Bearer ")) {
      console.error(
        "Authorization no comienza con Bearer."
      );

      return jsonError(
        "No autorizado. Token inválido.",
        401
      );
    }

    const firebaseToken =
      authorization.substring(7).trim();

    if (!firebaseToken) {
      return jsonError(
        "No autorizado. Token vacío.",
        401
      );
    }

    /**
     * 2. Verificar usuario Firebase
     */
    let decodedToken;

    try {
      decodedToken =
        await adminAuth.verifyIdToken(
          firebaseToken
        );
    } catch (firebaseError) {
      console.error(
        "Error verificando Firebase:",
        firebaseError
      );

      return jsonError(
        "La sesión de Firebase no es válida o expiró.",
        401
      );
    }

    const realUserEmail =
      decodedToken.email;

    if (!realUserEmail) {
      return jsonError(
        "El usuario de Firebase no tiene email asociado.",
        400
      );
    }

    const emailKey =
      safeEmailKey(realUserEmail);

    /**
     * 3. Referencia interna de MiOficio
     *
     * Esta referencia sigue identificando
     * al usuario real de MiOficio.
     */
    const externalReference =
      `mioficio_${emailKey}`;

    /**
     * 4. Variables de entorno
     */
    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!accessToken) {
      console.error(
        "MERCADOPAGO_ACCESS_TOKEN no configurado."
      );

      return jsonError(
        "Mercado Pago no está configurado correctamente en el servidor.",
        500
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://mioficio-sepia.vercel.app";

    /**
     * 5. Determinar TEST / PRODUCCIÓN
     */
    const testMode =
      process.env.MERCADOPAGO_TEST_MODE ===
      "true";

    /**
     * En TEST NO usamos el email real
     * del usuario de Firebase.
     *
     * Mercado Pago exige que payer y collector
     * sean usuarios de prueba cuando se prueba
     * la integración.
     */
    let payerEmail = realUserEmail;

    if (testMode) {
      payerEmail =
        process.env.MERCADOPAGO_TEST_PAYER_EMAIL ||
        "testuser3694982411@testuser.com";

      console.log(
        "MODO TEST Mercado Pago activado."
      );

      console.log(
        "Comprador TEST:",
        payerEmail
      );
    } else {
      console.log(
        "MODO PRODUCCIÓN Mercado Pago activado."
      );

      console.log(
        "Comprador real:",
        realUserEmail
      );
    }

    /**
     * 6. Datos de la suscripción
     */
    const subscriptionData = {
      reason: "MiOficio Premium",

      external_reference:
        externalReference,

      payer_email:
        payerEmail,

      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 4999,
        currency_id: "ARS",
      },

      back_url: appUrl,

      status: "pending",
    };

    console.log(
      "Datos enviados a Mercado Pago:"
    );

    console.log({
      testMode,
      payer_email: payerEmail,
      external_reference:
        externalReference,
      back_url: appUrl,
      amount: 4999,
    });

    /**
     * 7. Crear Preapproval
     */
    let response: Response;

    try {
      response = await fetch(
        "https://api.mercadopago.com/preapproval",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },

          body: JSON.stringify(
            subscriptionData
          ),

          cache: "no-store",
        }
      );
    } catch (mercadoPagoConnectionError) {
      console.error(
        "Error conectando con Mercado Pago:",
        mercadoPagoConnectionError
      );

      return jsonError(
        "No se pudo conectar con Mercado Pago.",
        502
      );
    }

    /**
     * 8. LEER RESPUESTA COMO TEXTO
     *
     * No usamos response.json() directamente.
     *
     * Esto evita:
     * Unexpected end of JSON input
     */
    const responseText =
      await response.text();

    console.log(
      "Mercado Pago HTTP status:",
      response.status
    );

    console.log(
      "Mercado Pago response:",
      responseText.substring(0, 3000)
    );

    /**
     * 9. Parsear JSON de forma segura
     */
    let data: any = {};

    if (responseText.trim()) {
      try {
        data = JSON.parse(
          responseText
        );
      } catch (parseError) {
        console.error(
          "Mercado Pago devolvió contenido no JSON:",
          parseError
        );

        return jsonError(
          "Mercado Pago devolvió una respuesta inesperada.",
          502,
          {
            mercadoPagoStatus:
              response.status,

            responsePreview:
              responseText.substring(
                0,
                1000
              ),
          }
        );
      }
    }

    /**
     * 10. Mercado Pago rechazó la solicitud
     */
    if (!response.ok) {
      console.error(
        "Mercado Pago rechazó la suscripción."
      );

      console.error(
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return jsonError(
        data?.message ||
          data?.error ||
          "Mercado Pago rechazó la creación de la suscripción.",
        response.status >= 400 &&
        response.status < 600
          ? response.status
          : 502,
        {
          mercadoPagoStatus:
            response.status,

          details: data,

          testMode,
        }
      );
    }

    /**
     * 11. Obtener checkout
     *
     * Mercado Pago puede devolver
     * init_point o sandbox_init_point
     * dependiendo del entorno.
     */
    const checkoutUrl =
      data?.init_point ||
      data?.sandbox_init_point;

    if (!checkoutUrl) {
      console.error(
        "Mercado Pago no devolvió init_point."
      );

      console.error(
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return jsonError(
        "Mercado Pago creó la suscripción pero no devolvió el enlace de pago.",
        502,
        {
          details: data,
          testMode,
        }
      );
    }

    /**
     * 12. Respuesta al frontend
     */
    console.log(
      "Suscripción creada correctamente."
    );

    console.log({
      subscriptionId: data.id,
      checkoutUrl,
      externalReference,
      testMode,
    });

    return NextResponse.json(
      {
        success: true,

        subscriptionId:
          data.id,

        checkoutUrl,

        externalReference,

        testMode,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "=========================================="
    );

    console.error(
      "ERROR GENERAL MiOficio / Mercado Pago"
    );

    console.error(error);

    console.error(
      "=========================================="
    );

    return jsonError(
      "No se pudo crear la suscripción Premium.",
      500,
      {
        details:
          error instanceof Error
            ? error.message
            : "Error desconocido.",
      }
    );
  }
}