import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

function safeEmailKey(email: string) {
  return email.toLowerCase().replace(/[.#$[\]]/g, "_");
}

export async function POST(request: NextRequest) {
  try {
    // 1. Obtener el token de Firebase
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401 }
      );
    }

    const firebaseToken = authorization.substring(7);

    // 2. Verificar usuario
    const decodedToken = await adminAuth.verifyIdToken(firebaseToken);
    const email = decodedToken.email;

    if (!email) {
      return NextResponse.json(
        { error: "El usuario no tiene un email asociado" },
        { status: 400 }
      );
    }

    const emailKey = safeEmailKey(email);

    // 3. Referencia única del usuario
    const externalReference = `mioficio_${emailKey}`;

    // 4. URL de retorno
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    // 5. Verificar Access Token
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

    // 7. Crear suscripción en Mercado Pago
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

    // 8. Leer respuesta de forma segura
    const responseText = await response.text();

    let data: any = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      console.error(
        "Mercado Pago devolvió una respuesta que no es JSON:",
        responseText
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago devolvió una respuesta inesperada.",
          status: response.status,
          response: responseText.substring(0, 500),
        },
        { status: 502 }
      );
    }

    // 9. Error de Mercado Pago
    if (!response.ok) {
      console.error(
        "Error Mercado Pago:",
        JSON.stringify(data, null, 2)
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago rechazó la creación de la suscripción.",
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
          details: data,
        },
        { status: 502 }
      );
    }

    // 11. Respuesta al frontend
    return NextResponse.json({
      success: true,
      subscriptionId: data.id,
      checkoutUrl: data.init_point,
      externalReference,
    });
  } catch (error) {
    console.error(
      "Error creando suscripción Premium:",
      error
    );

    return NextResponse.json(
      {
        error:
          "No se pudo crear la suscripción Premium.",
      },
      { status: 500 }
    );
  }
}