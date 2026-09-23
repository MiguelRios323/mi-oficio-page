import {
  NextResponse,
} from "next/server";

export const dynamic =
  "force-dynamic";

export const runtime =
  "nodejs";

function safeEmailKey(
  email: string
): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]]/g, "_")
    .slice(0, 100);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route:
      "mercadopago-subscription",
    message:
      "MiOficio API funcionando correctamente",

    testMode:
      process.env.MERCADOPAGO_TEST_MODE ===
      "true",

    mercadoPagoTokenConfigured:
      Boolean(
        process.env
          .MERCADOPAGO_ACCESS_TOKEN
      ),

    testPayerConfigured:
      Boolean(
        process.env
          .MERCADOPAGO_TEST_PAYER_EMAIL
      ),

    firebaseConfigured:
      Boolean(
        process.env
          .FIREBASE_PROJECT_ID
      ) &&
      Boolean(
        process.env
          .FIREBASE_CLIENT_EMAIL
      ) &&
      Boolean(
        process.env
          .FIREBASE_PRIVATE_KEY
      ) &&
      Boolean(
        process.env
          .FIREBASE_DATABASE_URL
      ),
  });
}

export async function POST(
  request: Request
) {
  try {
    /*
     * =====================================================
     * 1. AUTENTICACIÓN FIREBASE
     * =====================================================
     *
     * Importante:
     * Firebase Admin se importa dinámicamente.
     *
     * Así el GET de diagnóstico no intenta inicializar
     * Firebase Admin.
     */

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (!authorization) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No autenticado.",
          detail:
            "Falta el header Authorization.",
        },
        {
          status: 401,
        }
      );
    }

    if (
      !authorization
        .toLowerCase()
        .startsWith("bearer ")
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Authorization inválido.",
          detail:
            "Se esperaba Bearer <token>.",
        },
        {
          status: 401,
        }
      );
    }

    const firebaseToken =
      authorization
        .slice(7)
        .trim();

    if (!firebaseToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Token de Firebase vacío.",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * Importación dinámica de Firebase Admin.
     */

    const {
      getAdminAuth,
    } = await import(
      "@/lib/firebase-admin"
    );

    const adminAuth =
      getAdminAuth();

    const decodedToken =
      await adminAuth.verifyIdToken(
        firebaseToken
      );

    const firebaseEmail =
      decodedToken.email
        ?.trim()
        .toLowerCase();

    if (!firebaseEmail) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "La cuenta de Firebase no tiene email.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * 2. MERCADO PAGO
     * =====================================================
     */

    const accessToken =
      process.env
        .MERCADOPAGO_ACCESS_TOKEN
        ?.trim();

    if (!accessToken) {
      console.error(
        "Falta MERCADOPAGO_ACCESS_TOKEN."
      );

      return NextResponse.json(
        {
          ok: false,
          error:
            "Mercado Pago no está configurado.",
          detail:
            "Falta MERCADOPAGO_ACCESS_TOKEN.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =====================================================
     * 3. MODO TEST
     * =====================================================
     */

    const testMode =
      process.env
        .MERCADOPAGO_TEST_MODE ===
      "true";

    let payerEmail =
      firebaseEmail;

    if (testMode) {
      const testPayerEmail =
        process.env
          .MERCADOPAGO_TEST_PAYER_EMAIL
          ?.trim()
          .toLowerCase();

      if (!testPayerEmail) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Falta MERCADOPAGO_TEST_PAYER_EMAIL.",
            detail:
              "En modo TEST tenés que configurar el email del comprador de prueba de Mercado Pago.",
          },
          {
            status: 500,
          }
        );
      }

      payerEmail =
        testPayerEmail;
    }

    /*
     * =====================================================
     * 4. URL DE LA APLICACIÓN
     * =====================================================
     */

    const appUrl =
      process.env
        .NEXT_PUBLIC_APP_URL
        ?.trim() ||
      "https://mioficio-sepia.vercel.app";

    /*
     * =====================================================
     * 5. REFERENCIA EXTERNA
     * =====================================================
     */

    const emailKey =
      safeEmailKey(
        firebaseEmail
      );

    const externalReference =
      `mioficio_${emailKey}`;

    /*
     * =====================================================
     * 6. DATOS DE LA SUSCRIPCIÓN
     * =====================================================
     */

    const subscriptionBody = {
      reason:
        "MiOficio Premium",

      external_reference:
        externalReference,

      payer_email:
        payerEmail,

      auto_recurring: {
        frequency: 1,

        frequency_type:
          "months",

        transaction_amount:
          4999,

        currency_id:
          "ARS",
      },

      back_url:
        appUrl,

      status:
        "pending",
    };

    console.log(
      "Creando suscripción Mercado Pago:",
      {
        testMode,
        firebaseEmail,
        payerEmail,
        externalReference,
        appUrl,
      }
    );

    /*
     * =====================================================
     * 7. CREAR PREAPPROVAL
     * =====================================================
     */

    const mercadoPagoResponse =
      await fetch(
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
            subscriptionBody
          ),

          cache:
            "no-store",
        }
      );

    /*
     * =====================================================
     * 8. LEER RESPUESTA SEGURA
     * =====================================================
     */

    const responseText =
      await mercadoPagoResponse.text();

    let mercadoPagoData:
      Record<string, any> = {};

    if (responseText) {
      try {
        mercadoPagoData =
          JSON.parse(
            responseText
          );
      } catch {
        console.error(
          "Mercado Pago devolvió una respuesta no JSON:",
          responseText
        );

        return NextResponse.json(
          {
            ok: false,
            error:
              "Mercado Pago devolvió una respuesta inesperada.",
            status:
              mercadoPagoResponse.status,
            response:
              responseText.slice(
                0,
                1000
              ),
          },
          {
            status: 502,
          }
        );
      }
    }

    /*
     * =====================================================
     * 9. ERROR DE MERCADO PAGO
     * =====================================================
     */

    if (
      !mercadoPagoResponse.ok
    ) {
      console.error(
        "Mercado Pago rechazó la suscripción:",
        {
          status:
            mercadoPagoResponse.status,

          data:
            mercadoPagoData,
        }
      );

      return NextResponse.json(
        {
          ok: false,

          error:
            "Mercado Pago rechazó la creación de la suscripción.",

          status:
            mercadoPagoResponse.status,

          detail:
            mercadoPagoData?.message ||
            mercadoPagoData?.error ||
            mercadoPagoData?.cause ||
            responseText ||
            "Respuesta vacía de Mercado Pago.",
        },
        {
          status:
            mercadoPagoResponse.status,
        }
      );
    }

    /*
     * =====================================================
     * 10. OBTENER CHECKOUT
     * =====================================================
     */

    const checkoutUrl =
      mercadoPagoData?.init_point ||
      mercadoPagoData?.sandbox_init_point ||
      null;

    if (!checkoutUrl) {
      console.error(
        "Mercado Pago no devolvió init_point:",
        mercadoPagoData
      );

      return NextResponse.json(
        {
          ok: false,

          error:
            "Mercado Pago no devolvió una URL de pago.",

          detail:
            mercadoPagoData,
        },
        {
          status: 502,
        }
      );
    }

    /*
     * =====================================================
     * 11. RESPUESTA
     * =====================================================
     */

    return NextResponse.json({
      ok: true,

      testMode,

      subscriptionId:
        mercadoPagoData.id ||
        null,

      status:
        mercadoPagoData.status ||
        "pending",

      checkoutUrl,

      payerEmail,

      externalReference,
    });
  } catch (
    error: unknown
  ) {
    console.error(
      "Error en /api/mercadopago/subscription:",
      error
    );

    const detail =
      error instanceof Error
        ? error.message
        : "Error desconocido.";

    return NextResponse.json(
      {
        ok: false,

        error:
          "No se pudo crear la suscripción Premium.",

        detail,
      },
      {
        status: 500,
      }
    );
  }
}