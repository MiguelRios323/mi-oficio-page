import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

function safeEmailKey(email: string) {
  return email.toLowerCase().replace(/[.#$[\]]/g, "_");
}

export async function POST(request: NextRequest) {
  try {
    // 1. Obtener el token de Firebase enviado por MiOficio
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401 }
      );
    }

    const firebaseToken = authorization.substring(7);

    // 2. Verificar que el usuario realmente esté autenticado
    const decodedToken = await adminAuth.verifyIdToken(firebaseToken);

    const email = decodedToken.email;

    if (!email) {
      return NextResponse.json(
        { error: "El usuario no tiene un email asociado" },
        { status: 400 }
      );
    }

    const emailKey = safeEmailKey(email);

    // 3. Crear una referencia única para este usuario
    const externalReference = `mioficio_${emailKey}`;

    // 4. Datos de la suscripción Premium
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

      back_url:
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000",

      status: "pending",
    };

    // 5. Crear la suscripción en Mercado Pago
    const response = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(subscriptionData),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Error Mercado Pago:", data);

      return NextResponse.json(
        {
          error: "Mercado Pago rechazó la creación de la suscripción",
          details: data,
        },
        { status: response.status }
      );
    }

    // 6. Devolver únicamente los datos necesarios al frontend
    return NextResponse.json({
      success: true,
      subscriptionId: data.id,
      checkoutUrl: data.init_point,
      externalReference,
    });
  } catch (error) {
    console.error("Error creando suscripción:", error);

    return NextResponse.json(
      {
        error: "No se pudo crear la suscripción Premium",
      },
      { status: 500 }
    );
  }
}