import { NextRequest, NextResponse } from "next/server";

function safeEmailKey(email: string) {
  return email.toLowerCase().replace(/[.#$[\]]/g, "_");
}

export async function POST(request: NextRequest) {
  try {
    console.log("=== INICIO MERCADOPAGO SUBSCRIPTION ===");

    const { adminAuth } = await import("@/lib/firebase-admin");

    // ============================================================
    // 1. AUTORIZACIÓN FIREBASE
    // ============================================================

    const authorization = request.headers.get("authorization");

    console.log(
      "Authorization presente:",
      Boolean(authorization)
    );

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          error: "No autorizado",
          step: "authorization",
        },
        { status: 401 }
      );
    }

    const firebaseToken = authorization.substring(7);

    const decodedToken =
      await adminAuth.verifyIdToken(firebaseToken);

    const firebaseEmail = decodedToken.email;

    console.log(
      "Usuario Firebase verificado:",
      firebaseEmail ? "OK" : "SIN EMAIL"
    );

    if (!firebaseEmail) {
      return NextResponse.json(
        {
          error: "El usuario no tiene un email asociado",
          step: "firebase-email",
        },
        { status: 400 }
      );
    }

    // ============================================================
    // 2. CONFIGURACIÓN
    // ============================================================

    const testMode =
      process.env.MERCADOPAGO_TEST_MODE === "true";

    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN;

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://mioficio-sepia.vercel.app";

    console.log("Configuración Mercado Pago:", {
      testMode,
      accessTokenConfigurado: Boolean(accessToken),
      appUrl,
    });

    if (!accessToken) {
      console.error(
        "MERCADOPAGO_ACCESS_TOKEN no está configurado."
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago no está configurado correctamente en el servidor.",
          step: "mercadopago-token",
        },
        { status: 500 }
      );
    }

    // ============================================================
    // 3. EMAIL DEL PAGADOR
    // ============================================================

    /*
     * TEST:
     * Mercado Pago utiliza test@testuser.com para las pruebas.
     *
     * PRODUCCIÓN:
     * Se utiliza el email real del usuario autenticado.
     */

    const payerEmail = testMode
      ? "test@testuser.com"
      : firebaseEmail;

    // ============================================================
    // 4. REFERENCIA EXTERNA
    // ============================================================

    const emailKey = safeEmailKey(firebaseEmail);

    const externalReference = testMode
      ? `mioficio_test_${emailKey}`
      : `mioficio_${emailKey}`;

    // ============================================================
    // 5. DATOS DE LA SUSCRIPCIÓN
    // ============================================================

    const subscriptionData = {
      reason: testMode
        ? "MiOficio Premium TEST"
        : "MiOficio Premium",

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

    console.log(
      "Creando suscripción Mercado Pago:",
      {
        mode: testMode ? "TEST" : "PRODUCCIÓN",
        firebaseEmail,
        payerEmail,
        externalReference,
        backUrl: appUrl,
        amount: 4999,
        currency: "ARS",
      }
    );

    // ============================================================
    // 6. CREAR PREAPPROVAL
    // ============================================================

    const response = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify(subscriptionData),
      }
    );

    console.log(
      "Respuesta Mercado Pago:",
      response.status,
      response.statusText
    );

    // ============================================================
    // 7. LEER RESPUESTA
    // ============================================================

    const responseText = await response.text();

    console.log(
      "Respuesta MP recibida:",
      responseText.substring(0, 1000)
    );

    let data: any = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch (parseError) {
      console.error(
        "Mercado Pago devolvió una respuesta que no es JSON:",
        parseError
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago devolvió una respuesta inesperada.",
          step: "mercadopago-response",
          status: response.status,
          rawResponse: responseText.substring(0, 1000),
        },
        { status: 502 }
      );
    }

    // ============================================================
    // 8. ERROR DE MERCADO PAGO
    // ============================================================

    if (!response.ok) {
      console.error(
        "Mercado Pago rechazó la suscripción:",
        JSON.stringify(data, null, 2)
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago rechazó la creación de la suscripción.",

          step: "mercadopago-api",

          status: response.status,

          details: data,

          mode: testMode
            ? "TEST"
            : "PRODUCCIÓN",

          payerEmail,

          externalReference,
        },
        { status: response.status }
      );
    }

    // ============================================================
    // 9. VALIDAR INIT POINT
    // ============================================================

    if (!data.init_point) {
      console.error(
        "Mercado Pago no devolvió init_point:",
        JSON.stringify(data, null, 2)
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago creó la suscripción pero no devolvió el enlace de pago.",

          step: "missing-init-point",

          details: data,
        },
        { status: 502 }
      );
    }

    // ============================================================
    // 10. RESPUESTA EXITOSA
    // ============================================================

    console.log(
      "=== SUSCRIPCIÓN CREADA CORRECTAMENTE ==="
    );

    console.log({
      subscriptionId: data.id,
      mode: testMode ? "TEST" : "PRODUCCIÓN",
      payerEmail,
      externalReference,
    });

    return NextResponse.json({
      success: true,

      mode: testMode
        ? "TEST"
        : "PRODUCCIÓN",

      subscriptionId: data.id,

      checkoutUrl: data.init_point,

      externalReference,

      payerEmail,
    });

  } catch (error) {
    // ============================================================
    // ERROR GENERAL
    // ============================================================

    console.error(
      "=== ERROR MERCADOPAGO SUBSCRIPTION ==="
    );

    console.error(error);

    return NextResponse.json(
      {
        error:
          "No se pudo crear la suscripción Premium.",

        step: "server",

        message:
          error instanceof Error
            ? error.message
            : "Error desconocido",
      },
      { status: 500 }
    );
  }
}

// ================================================================
// GET — PRUEBA DE LA RUTA
// ================================================================

export async function GET() {
  return NextResponse.json({
    ok: true,

    route:
      "mercadopago-subscription",

    message:
      "MiOficio API funcionando correctamente",

    testMode:
      process.env.MERCADOPAGO_TEST_MODE === "true",
  });
}