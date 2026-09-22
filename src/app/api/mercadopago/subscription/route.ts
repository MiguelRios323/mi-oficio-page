import { getAdminAuth } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    route: "mercadopago-subscription",
    message: "MiOficio API funcionando correctamente",
    testMode: process.env.MERCADOPAGO_TEST_MODE === "true",
    mercadoPagoTokenConfigured: Boolean(
      process.env.MERCADOPAGO_ACCESS_TOKEN
    ),
    firebaseConfigured:
      Boolean(process.env.FIREBASE_PROJECT_ID) &&
      Boolean(process.env.FIREBASE_CLIENT_EMAIL) &&
      Boolean(process.env.FIREBASE_PRIVATE_KEY) &&
      Boolean(process.env.FIREBASE_DATABASE_URL),
  });
}

export async function POST(request: Request) {
  try {
    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

    if (!accessToken) {
      return Response.json(
        {
          ok: false,
          error: "Mercado Pago no está configurado.",
          detail: "Falta MERCADOPAGO_ACCESS_TOKEN.",
        },
        { status: 500 }
      );
    }

    const authorization =
      request.headers.get("authorization");

    if (!authorization) {
      return Response.json(
        {
          ok: false,
          error: "No autenticado.",
          detail: "Falta el header Authorization.",
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
          detail: "Se esperaba Bearer <token>.",
        },
        { status: 401 }
      );
    }

    const idToken = authorization
      .slice(7)
      .trim();

    if (!idToken) {
      return Response.json(
        {
          ok: false,
          error: "Token de autenticación vacío.",
        },
        { status: 401 }
      );
    }

    const adminAuth = getAdminAuth();

    const decodedToken =
      await adminAuth.verifyIdToken(idToken);

    const firebaseEmail =
      decodedToken.email
        ?.trim()
        .toLowerCase();

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

    const testMode =
      process.env.MERCADOPAGO_TEST_MODE === "true";

    let payerEmail = firebaseEmail;

    if (testMode) {
      const testPayerEmail =
        process.env.MERCADOPAGO_TEST_PAYER_EMAIL
          ?.trim()
          .toLowerCase();

      if (!testPayerEmail) {
        return Response.json(
          {
            ok: false,
            error:
              "Falta MERCADOPAGO_TEST_PAYER_EMAIL.",
            detail:
              "En modo TEST configurá el email del comprador de prueba de Mercado Pago.",
          },
          { status: 500 }
        );
      }

      payerEmail = testPayerEmail;
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      "https://mioficio-sepia.vercel.app";

    const emailKey = firebaseEmail
      .replace(/[.#$[\]/]/g, "_")
      .slice(0, 100);

    const externalReference =
      "mioficio_" + emailKey;

    const subscriptionBody = {
      reason: "MiOficio Premium",

      external_reference: externalReference,

      payer_email: payerEmail,

      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 4999,
        currency_id: "ARS",
      },

      back_url: appUrl,

      status: "pending",
    };

    const mercadoPagoResponse =
      await fetch(
        "https://api.mercadopago.com/preapproval",
        {
          method: "POST",

          headers: {
            Authorization:
              "Bearer " + accessToken,
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },

          body: JSON.stringify(
            subscriptionBody
          ),
        }
      );

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

    if (!mercadoPagoResponse.ok) {
      console.error(
        "Mercado Pago error:",
        mercadoPagoResponse.status,
        responseText
      );

      return Response.json(
        {
          ok: false,
          error:
            "Mercado Pago rechazó la creación de la suscripción.",
          status:
            mercadoPagoResponse.status,
          detail:
            mercadoPagoData?.message ||
            mercadoPagoData?.error ||
            responseText ||
            "Respuesta vacía de Mercado Pago.",
        },
        { status: 502 }
      );
    }

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
          detail: mercadoPagoData,
        },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,

      testMode,

      subscriptionId:
        mercadoPagoData.id || null,

      status:
        mercadoPagoData.status ||
        "pending",

      checkoutUrl,

      payerEmail,

      externalReference,
    });
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
      { status: 500 }
    );
  }
}