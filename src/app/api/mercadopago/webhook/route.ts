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

  // Durante desarrollo podemos dejar la validación
  // desactivada hasta configurar la clave en Mercado Pago.
  if (!secret) {
    console.warn(
      "MERCADOPAGO_WEBHOOK_SECRET no configurado. Firma no validada."
    );
    return true;
  }

  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  if (!xSignature || !xRequestId) {
    return false;
  }

  let ts = "";
  let v1 = "";

  for (const part of xSignature.split(",")) {
    const [key, value] = part.split("=");

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
    return false;
  }

  const manifest =
    `id:${dataId};` +
    `request-id:${xRequestId};` +
    `ts:${ts};`;

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(generatedSignature),
    Buffer.from(v1)
  );
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);

    const type =
      url.searchParams.get("type") ||
      url.searchParams.get("topic");

    const dataId =
      url.searchParams.get("data.id") ||
      url.searchParams.get("id");

    console.log("Webhook Mercado Pago recibido:", {
      type,
      dataId,
    });

    if (!dataId) {
      console.warn("Webhook sin data.id");

      return NextResponse.json(
        { received: true },
        { status: 200 }
      );
    }

    /*
     * Verificamos que la notificación realmente
     * provenga de Mercado Pago.
     */
    const firmaValida = validarFirmaMercadoPago(
      request,
      dataId
    );

    if (!firmaValida) {
      console.error(
        "Firma de Mercado Pago inválida."
      );

      return NextResponse.json(
        { error: "Firma inválida" },
        { status: 401 }
      );
    }

    /*
     * Leemos el body solamente después de validar
     * la información básica de la notificación.
     */
    let body: any = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    /*
     * ==========================================
     * SUSCRIPCIÓN
     * ==========================================
     */
    if (
      type === "subscription_preapproval" ||
      type === "preapproval"
    ) {
      const subscriptionResponse = await fetch(
        `https://api.mercadopago.com/preapproval/${dataId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }
      );

      const subscription =
        await subscriptionResponse.json();

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

      /*
       * Solo activamos Premium cuando Mercado Pago
       * informa que la suscripción está autorizada.
       */
      const premiumActivo =
        subscription.status === "authorized";

      const perfilRef = adminDb.ref(
        `usuarios_data/${emailKey}/perfil/es_premium`
      );

      await perfilRef.set(premiumActivo);

      console.log(
        `Premium ${premiumActivo ? "ACTIVADO" : "DESACTIVADO"} para ${emailKey}`
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

    /*
     * ==========================================
     * PAGOS
     * ==========================================
     *
     * Mercado Pago recomienda recibir también
     * las notificaciones de pagos asociadas
     * a las suscripciones.
     */
    if (type === "payment") {
      const paymentResponse = await fetch(
        `https://api.mercadopago.com/v1/payments/${dataId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }
      );

      const payment =
        await paymentResponse.json();

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

      /*
       * No activamos Premium solamente por recibir
       * una notificación de pago.
       *
       * La activación principal se hace mediante
       * la consulta de la suscripción autorizada.
       */

      return NextResponse.json(
        {
          received: true,
          paymentId: payment.id,
          status: payment.status,
        },
        { status: 200 }
      );
    }

    /*
     * ==========================================
     * OTROS EVENTOS
     * ==========================================
     */

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

    /*
     * Devolvemos 200 para evitar que Mercado Pago
     * quede reintentando indefinidamente mientras
     * depuramos un error interno.
     */
    return NextResponse.json(
      { received: true },
      { status: 200 }
    );
  }
}