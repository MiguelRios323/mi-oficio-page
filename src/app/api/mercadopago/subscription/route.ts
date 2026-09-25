import { getAdminAuth } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PREMIUM_AMOUNT = 4999;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createExternalReference(email: string): string {
  const emailKey = email
    .toLowerCase()
    .replace(/[.#$[\]/]/g, "_")
    .slice(0, 100);

  return `mioficio_${emailKey}`;
}

function getAppUrl(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!appUrl) {
    return "http://localhost:3000";
  }

  return appUrl.replace(/\/+$/, "");
}

export async function GET() {
  const accessToken =
    process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

  const testMode =
    process.env.MERCADOPAGO_TEST_MODE === "true";

  const testPayerEmail =
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL?.trim();

  return Response.json({
    ok: true,
    route: "mercadopago-subscription",
    message: "MiOficio API funcionando correctamente",

    testMode,

    mercadoPagoTokenConfigured:
      Boolean(accessToken),

    testPayerConfigured:
      Boolean(testPayerEmail),

    appUrl: getAppUrl(),

    firebaseConfigured:
      Boolean(process.env.FIREBASE_PROJECT_ID) &&
      Boolean(process.env.FIREBASE_CLIENT_EMAIL) &&
      Boolean(process.env.FIREBASE_PRIVATE_KEY) &&
      Boolean(process.env.FIREBASE_DATABASE_URL),
  });
}

export async function POST(request: Request) {
  try {
    // =====================================================
    // 1. MERCADO PAGO ACCESS TOKEN
    // =====================================================

    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

    if (!accessToken) {
      return Response.json(
        {
          ok: false,
          error: "Mercado Pago no está configurado.",
          detail:
            "Falta MERCADOPAGO_ACCESS_TOKEN.",
        },
        { status: 500 }
      );
    }

    // =====================================================
    // 2. AUTENTICACIÓN FIREBASE
    // =====================================================

    const authorization =
      request.headers.get("authorization");

    if (!authorization) {
      return Response.json(
        {
          ok: false,
          error: "No autenticado.",
          detail:
            "Falta el header Authorization.",
        },
        { status: 401 }
      );
    }

    if (
      !authorization
        .toLowerCase()
        .startsWith("bearer ")
    ) {
      return Response.json(
        {
          ok: false,
          error: "Authorization inválido.",
          detail:
            "Se esperaba Authorization: Bearer <token>.",
        },
        { status: 401 }
      );
    }

    const idToken =
      authorization.slice(7).trim();

    if (!idToken) {
      return Response.json(
        {
          ok: false,
          error:
            "Token de autenticación vacío.",
        },
        { status: 401 }
      );
    }

    const adminAuth = getAdminAuth();

    const decodedToken =
      await adminAuth.verifyIdToken(idToken);

    const firebaseEmail =
      decodedToken.email
        ? normalizeEmail(decodedToken.email)
        : "";

    if (!firebaseEmail) {
      return Response.json(
        {
          ok: false,
          error:
            "La cuenta de Firebase no tiene email.",
        },
        { status: 400 }
      );
    }

    // =====================================================
    // 3. MODO TEST
    // =====================================================

    const testMode =
      process.env.MERCADOPAGO_TEST_MODE === "true";

    let payerEmail = firebaseEmail;

    if (testMode) {
      const configuredTestEmail =
        process.env.MERCADOPAGO_TEST_PAYER_EMAIL
          ?.trim()
          .toLowerCase();

      if (!configuredTestEmail) {
        return Response.json(
          {
            ok: false,
            error:
              "Falta MERCADOPAGO_TEST_PAYER_EMAIL.",
            detail:
              "Configurá el email del usuario de prueba de Mercado Pago.",
          },
          { status: 500 }
        );
      }

      payerEmail = configuredTestEmail;
    }

    // =====================================================
    // 4. REFERENCIA
    // =====================================================

    const externalReference =
      createExternalReference(firebaseEmail);

    // =====================================================
    // 5. URL DE LA APLICACIÓN
    // =====================================================

    const appUrl = getAppUrl();

    // =====================================================
    // 6. BODY DE LA SUSCRIPCIÓN
    // =====================================================

    const subscriptionBody = {
      reason: "MiOficio Premium",

      external_reference:
        externalReference,

      payer_email: payerEmail,

      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount:
          PREMIUM_AMOUNT,
        currency_id: "ARS",
      },

      back_url: appUrl,

      status: "pending",
    };

    console.log(
      "Creando suscripción Mercado Pago:",
      {
        testMode,
        firebaseEmail,
        payerEmail,
        externalReference,
        amount: PREMIUM_AMOUNT,
        appUrl,
      }
    );

    // =====================================================
    // 7. CREAR PREAPPROVAL
    // =====================================================

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

          cache: "no-store",
        }
      );

    // =====================================================
    // 8. LEER RESPUESTA
    // =====================================================

    const responseText =
      await mercadoPagoResponse.text();

    let mercadoPagoData: any = null;

    try {
      mercadoPagoData = responseText
        ? JSON.parse(responseText)
        : null;
    } catch {
      mercadoPagoData = null;
    }

    console.log(
      "Respuesta Mercado Pago:",
      {
        status:
          mercadoPagoResponse.status,

        ok:
          mercadoPagoResponse.ok,

        body:
          mercadoPagoData ??
          responseText,
      }
    );

    // =====================================================
    // 9. MERCADO PAGO DEVOLVIÓ ERROR
    // =====================================================

    if (!mercadoPagoResponse.ok) {
      const mpMessage =
        mercadoPagoData?.message ||
        mercadoPagoData?.error ||
        mercadoPagoData?.cause?.[0]?.description ||
        mercadoPagoData?.cause?.[0]?.code ||
        responseText ||
        "Respuesta vacía de Mercado Pago.";

      console.error(
        "Mercado Pago rechazó la suscripción:",
        {
          status:
            mercadoPagoResponse.status,

          message:
            mpMessage,

          response:
            mercadoPagoData,

          request:
            subscriptionBody,
        }
      );

      return Response.json(
        {
          ok: false,

          error:
            "Mercado Pago rechazó la creación de la suscripción.",

          status:
            mercadoPagoResponse.status,

          detail:
            mpMessage,

          mercadoPagoResponse:
            mercadoPagoData,

          testMode,

          payerEmail,
        },
        {
          status: 502,
        }
      );
    }

    // =====================================================
    // 10. OBTENER CHECKOUT
    // =====================================================

    const checkoutUrl =
      mercadoPagoData?.init_point ||
      mercadoPagoData?.sandbox_init_point ||
      null;

    if (!checkoutUrl) {
      console.error(
        "Mercado Pago no devolvió init_point:",
        mercadoPagoData
      );

      return Response.json(
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

    // =====================================================
    // 11. RESPUESTA EXITOSA
    // =====================================================

    return Response.json(
      {
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
      },
      {
        status: 200,
      }
    );
  } catch (error: unknown) {
    console.error(
      "Error en /api/mercadopago/subscription:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido.";

    return Response.json(
      {
        ok: false,

        error:
          "No se pudo crear la suscripción Premium.",

        detail: message,
      },
      {
        status: 500,
      }
    );
  }
}