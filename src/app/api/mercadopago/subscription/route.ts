import { NextRequest, NextResponse } from "next/server";

function safeEmailKey(email: string) {
  return email.toLowerCase().replace(/[.#$[\]]/g, "_");
}

export async function POST(request: NextRequest) {
  try {
    console.log("=== INICIO MERCADOPAGO SUBSCRIPTION ===");

    // Firebase Admin se carga dentro del try.
    // Esto permite capturar errores de inicialización en Vercel.
    const { adminAuth } = await import("@/lib/firebase-admin");

    // 1. Obtener token de Firebase
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

    // 2. Verificar usuario
    const decodedToken =
      await adminAuth.verifyIdToken(firebaseToken);

    const email = decodedToken.email;

    console.log(
      "Usuario Firebase verificado:",
      email ? "OK" : "SIN EMAIL"
    );

    if (!email) {
      return NextResponse.json(
        {
          error: "El usuario no tiene un email asociado",
          step: "firebase-email",
        },
        { status: 400 }
      );
    }

    const emailKey = safeEmailKey(email);

    // 3. Referencia única
    const externalReference = `mioficio_${emailKey}`;

    // 4. URL de retorno
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://mioficio-sepia.vercel.app";

    // 5. Access Token de Mercado Pago
    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN;

    console.log(
      "Configuración Mercado Pago:",
      {
        accessTokenConfigurado: Boolean(accessToken),
        appUrl,
      }
    );

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

    // 6. Datos de la suscripción
    const subscriptionData = {
      reason: "MiOficio Premium",
      external_reference: externalReference,
      payer_email: email,

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
        email,
        externalReference,
        back_url: appUrl,
      }
    );

    // 7. Crear suscripción
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

    // 8. Leer respuesta
    const responseText = await response.text();

    console.log(
      "Respuesta MP recibida:",
      responseText.substring(0, 500)
    );

    let data: any = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch (parseError) {
      console.error(
        "Mercado Pago devolvió algo que no es JSON:",
        parseError
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago devolvió una respuesta inesperada.",
          step: "mercadopago-response",
          status: response.status,
        },
        { status: 502 }
      );
    }

    // 9. Error de Mercado Pago
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
          details: data,
        },
        { status: response.status }
      );
    }

    // 10. Verificar init_point
    if (!data.init_point) {
      console.error(
        "Mercado Pago no devolvió init_point:",
        data
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

    // 11. Respuesta exitosa
    console.log(
      "=== SUSCRIPCIÓN CREADA CORRECTAMENTE ==="
    );

    return NextResponse.json({
      success: true,
      subscriptionId: data.id,
      checkoutUrl: data.init_point,
      externalReference,
    });
  } catch (error) {
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

// Endpoint de prueba.
// Permite comprobar desde el navegador si Vercel está cargando
// correctamente este Route Handler.

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "mercadopago-subscription",
    message: "MiOficio API funcionando correctamente",
  });
}