import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase-admin";

function safeEmailKey(email: string) {
  return email.toLowerCase().replace(/[.#$[\]]/g, "_");
}

function validarFirmaMercadoPago(
  request: NextRequest,
  dataId: string
) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  if (!secret) {
    console.warn(
      "MERCADOPAGO_WEBHOOK_SECRET no configurado. Firma no validada."
    );

    return true;
  }

  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  if (!xSignature || !xRequestId) {
    console.error(
      "Faltan headers x-signature o x-request-id."
    );

    return false;
  }

  let ts = "";
  let v1 = "";

  for (const part of xSignature.split(",")) {
    const [key, value] = part.split("=", 2);

    if (!key || !value) continue;

    const trimmedKey = key.trim();
    const trimmedValue = value.trim();

    if (trimmedKey === "ts") {
      ts = trimmedValue;
    }

    if (trimmedKey === "v1") {
      v1 = trimmedValue;
    }
  }

  if (!ts || !v1) {
    console.error(
      "No se pudieron obtener ts o v1 desde x-signature."
    );

    return false;
  }

  // Mercado Pago requiere este formato:
  // id:<data.id>;request-id:<x-request-id>;ts:<ts>;

  const manifest =
    `id:${dataId.toLowerCase()};` +
    `request-id:${xRequestId};` +
    `ts:${ts};`;

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  // Evitar que timingSafeEqual lance una excepción
  // cuando las longitudes sean diferentes.
  const generatedBuffer = Buffer.from(
    generatedSignature,
    "utf8"
  );

  const receivedBuffer = Buffer.from(v1, "utf8");

  if (generatedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    generatedBuffer,
    receivedBuffer
  );
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);

    // Mercado Pago envía data.id como parámetro.
    const dataId =
      url.searchParams.get("data.id") ||
      url.searchParams.get("id") ||
      "";

    const type =
      url.searchParams.get("type") ||
      url.searchParams.get("topic") ||
      "";

    console.log(
      "Webhook Mercado Pago recibido:",
      {
        type,
        dataId,
      }
    );

    if (!dataId) {
      console.warn(
        "Webhook Mercado Pago sin data.id."
      );

      return NextResponse.json(
        { received: true },
        { status: 200 }
      );
    }

    // ==========================================
    // VALIDACIÓN DE FIRMA
    // ==========================================

    const firmaValida = validarFirmaMercadoPago(
      request,
      dataId
    );

    if (!firmaValida) {
      console.error(
        "Firma de Mercado Pago inválida."
      );

      return NextResponse.json(
        {
          error: "Firma inválida",
        },
        { status: 401 }
      );
    }

    // ==========================================
    // LEER BODY
    // ==========================================

    let body: any = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    console.log(
      "Body webhook Mercado Pago:",
      body
    );

    // ==========================================
    // TOKEN MERCADO PAGO
    // ==========================================

    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!accessToken) {
      console.error(
        "MERCADOPAGO_ACCESS_TOKEN no configurado."
      );

      return NextResponse.json(
        {
          error:
            "Mercado Pago no está configurado correctamente.",
        },
        { status: 500 }
      );
    }

    // ==========================================
    // SUSCRIPCIONES
    // ==========================================

    if (
      type === "subscription_preapproval" ||
      type === "preapproval"
    ) {
      const subscriptionResponse = await fetch(
        `https://api.mercadopago.com/preapproval/${dataId}`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },

          cache: "no-store",
        }
      );

      const responseText =
        await subscriptionResponse.text();

      let subscription: any = {};

      try {
        subscription = responseText
          ? JSON.parse(responseText)
          : {};
      } catch {
        console.error(
          "Mercado Pago devolvió una respuesta no JSON al consultar la suscripción:",
          responseText
        );

        return NextResponse.json(
          { received: true },
          { status: 200 }
        );
      }

      if (!subscriptionResponse.ok) {
        console.error(
          "No se pudo consultar la suscripción:",
          subscription
        );

        return NextResponse.json(
          { received: true },
          { status: 200 }
        );
      }

      console.log(
        "Suscripción consultada:",
        {
          id: subscription.id,
          status: subscription.status,
          payer_email: subscription.payer_email,
          external_reference:
            subscription.external_reference,
        }
      );

      const externalReference =
        subscription.external_reference;

      if (
        typeof externalReference !== "string" ||
        !externalReference.startsWith("mioficio_")
      ) {
        console.warn(
          "La suscripción no pertenece a MiOficio:",
          externalReference
        );

        return NextResponse.json(
          { received: true },
          { status: 200 }
        );
      }

      const emailKey =
        externalReference.replace(
          /^mioficio_/,
          ""
        );

      // ==========================================
      // PREMIUM
      // ==========================================

      const premiumActivo =
        subscription.status === "authorized";

      const perfilRef = adminDb.ref(
        `usuarios_data/${emailKey}/perfil/es_premium`
      );

      await perfilRef.set(premiumActivo);

      console.log(
        `Premium ${
          premiumActivo
            ? "ACTIVADO"
            : "DESACTIVADO"
        } para ${emailKey}`
      );

      return NextResponse.json(
        {
          received: true,
          premium: premiumActivo,
          subscriptionId: subscription.id,
          status: subscription.status,
        },
        { status: 200 }
      );
    }

    // ==========================================
    // PAGOS
    // ==========================================

    if (type === "payment") {
      const paymentResponse = await fetch(
        `https://api.mercadopago.com/v1/payments/${dataId}`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },

          cache: "no-store",
        }
      );

      const responseText =
        await paymentResponse.text();

      let payment: any = {};

      try {
        payment = responseText
          ? JSON.parse(responseText)
          : {};
      } catch {
        console.error(
          "Mercado Pago devolvió una respuesta no JSON al consultar el pago:",
          responseText
        );

        return NextResponse.json(
          { received: true },
          { status: 200 }
        );
      }

      if (!paymentResponse.ok) {
        console.error(
          "No se pudo consultar el pago:",
          payment
        );

        return NextResponse.json(
          { received: true },
          { status: 200 }
        );
      }

      console.log(
        "Pago Mercado Pago:",
        {
          id: payment.id,
          status: payment.status,
          status_detail:
            payment.status_detail,
          external_reference:
            payment.external_reference,
        }
      );

      return NextResponse.json(
        {
          received: true,
          paymentId: payment.id,
          status: payment.status,
        },
        { status: 200 }
      );
    }

    // ==========================================
    // OTROS EVENTOS
    // ==========================================

    console.log(
      "Evento Mercado Pago no procesado:",
      {
        type,
        dataId,
        body,
      }
    );

    return NextResponse.json(
      { received: true },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Error procesando webhook de Mercado Pago:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Error interno procesando webhook de Mercado Pago.",
      },
      { status: 500 }
    );
  }
}