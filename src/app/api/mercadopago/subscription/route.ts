import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

function safeEmailKey(email: string) {
  return email.toLowerCase().replace(/[.#$[\]\\]/g, "_");
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "mercadopago-subscription",
    message: "MiOficio API funcionando correctamente",
    testMode: process.env.MERCADOPAGO_TEST_MODE === "true",
  });
}

export async function POST(request: NextRequest) {
  try {
    // =========================================================
    // 1. VERIFICAR USUARIO DE FIREBASE
    // =========================================================

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          error: "No autorizado",
        },
        { status: 401 }
      );
    }

    const firebaseToken = authorization.substring(7);

    const decodedToken = await adminAuth.verifyIdToken(firebaseToken);

    const email = decodedToken.email;

    if (!email) {
      return NextResponse.json(
        {
          error: "El usuario no tiene un email asociado.",
        },
        { status: 400 }
      );
    }

    // =========================================================
    // 2. CONFIGURACIÓN
    // =========================================================

    const testMode =
      process.env.MERCADOPAGO_TEST_MODE === "true";

    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!accessToken) {
      console.error(
        "MERCADOPAGO_ACCESS_TOKEN no está configurado."
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago no está configurado correctamente en el servidor.",
        },
        { status: 500 }
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://mioficio-sepia.vercel.app";

    // =========================================================
    // 3. REFERENCIA DEL USUARIO REAL DE MIOFICIO
    // =========================================================

    const emailKey = safeEmailKey(email);

    const externalReference =
      `mioficio_${emailKey}`;

    // =========================================================
    // 4. EMAIL DEL PAGADOR
    // =========================================================
    //
    // TEST:
    // Mercado Pago utiliza test@testuser.com
    //
    // PRODUCCIÓN:
    // Se utiliza el email real del usuario de MiOficio.
    //

    const payerEmail = testMode
      ? "test@testuser.com"
      : email;

    // =========================================================
    // 5. DATOS DE LA SUSCRIPCIÓN
    // =========================================================

    const subscriptionData = {
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

    console.log(
      "========================================"
    );

    console.log(
      "MI OFICIO - CREANDO SUSCRIPCIÓN"
    );

    console.log(
      "========================================"
    );

    console.log({
      testMode,
      firebaseEmail: email,
      payerEmail,
      externalReference,
      backUrl: appUrl,
    });

    // =========================================================
    // 6. CREAR SUSCRIPCIÓN EN MERCADO PAGO
    // =========================================================

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

    // =========================================================
    // 7. LEER RESPUESTA
    // =========================================================

    const responseText = await response.text();

    let data: any = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      console.error(
        "Mercado Pago devolvió una respuesta que no es JSON:"
      );

      console.error(responseText);

      return NextResponse.json(
        {
          error:
            "Mercado Pago devolvió una respuesta inesperada.",
          status: response.status,
          response: responseText.substring(0, 1000),
        },
        { status: 502 }
      );
    }

    // =========================================================
    // 8. MERCADO PAGO RECHAZÓ LA SUSCRIPCIÓN
    // =========================================================

    if (!response.ok) {
      console.error(
        "========================================"
      );

      console.error(
        "ERROR MERCADO PAGO"
      );

      console.error(
        "HTTP STATUS:",
        response.status
      );

      console.error(
        JSON.stringify(data, null, 2)
      );

      console.error(
        "========================================"
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago rechazó la creación de la suscripción.",

          details: data,

          status: response.status,

          testMode,
        },
        {
          status: response.status,
        }
      );
    }

    // =========================================================
    // 9. VERIFICAR INIT_POINT
    // =========================================================

    if (!data.init_point) {
      console.error(
        "Mercado Pago no devolvió init_point:"
      );

      console.error(
        JSON.stringify(data, null, 2)
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago creó la suscripción pero no devolvió el enlace de pago.",

          details: data,
        },
        { status: 502 }
      );
    }

    // =========================================================
    // 10. RESPUESTA CORRECTA
    // =========================================================

    console.log(
      "Suscripción creada correctamente."
    );

    console.log({
      subscriptionId: data.id,
      checkoutUrl: data.init_point,
      externalReference,
      testMode,
    });

    return NextResponse.json({
      success: true,

      subscriptionId: data.id,

      checkoutUrl: data.init_point,

      externalReference,

      testMode,
    });
  } catch (error: any) {
    console.error(
      "========================================"
    );

    console.error(
      "ERROR CREANDO SUSCRIPCIÓN PREMIUM"
    );

    console.error(error);

    console.error(
      "========================================"
    );

    return NextResponse.json(
      {
        error:
          "No se pudo crear la suscripción Premium.",

        details:
          error?.message ||
          "Error desconocido.",
      },
      { status: 500 }
    );
  }
}