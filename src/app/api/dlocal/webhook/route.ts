import { NextResponse } from "next/server";
import crypto from "crypto";

import {
  getAdminAuth,
  getAdminDb,
} from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]\\/]/g, "_")
    .slice(0, 100);
}

function getSignature(request: Request): string {
  const signatureHeader =
    request.headers.get("signature");

  if (signatureHeader) {
    const value = signatureHeader.trim();

    // Formato:
    // V2-HMAC-SHA256, Signature: abc123...
    const match = value.match(
      /Signature\s*:\s*([a-fA-F0-9]{64})/i
    );

    if (match) {
      return match[1].toLowerCase();
    }

    // Formato:
    // abc123...
    if (/^[a-fA-F0-9]{64}$/.test(value)) {
      return value.toLowerCase();
    }
  }

  const authorization =
    request.headers.get("authorization");

  if (authorization) {
    // Formato:
    // V2-HMAC-SHA256, Signature: abc123...
    const match = authorization.match(
      /Signature\s*:\s*([a-fA-F0-9]{64})/i
    );

    if (match) {
      return match[1].toLowerCase();
    }
  }

  return "";
}

function verifySignature(
  received: string,
  expected: string
): boolean {
  const receivedBuffer = Buffer.from(
    received,
    "utf8"
  );

  const expectedBuffer = Buffer.from(
    expected,
    "utf8"
  );

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    const xLogin =
      process.env.DLOCAL_X_LOGIN?.trim();

    const secretKey =
      process.env.DLOCAL_SECRET_KEY?.trim();

    const xDate =
      request.headers.get("x-date")?.trim();

    if (!xLogin || !secretKey) {
      console.error(
        "Webhook dLocal: faltan variables de entorno."
      );

      return NextResponse.json(
        {
          error:
            "Configuración dLocal incompleta.",
        },
        { status: 500 }
      );
    }

    if (!xDate) {
      console.error(
        "Webhook dLocal: falta X-Date."
      );

      return NextResponse.json(
        {
          error: "Falta X-Date.",
        },
        { status: 401 }
      );
    }

    const receivedSignature =
      getSignature(request);

    // Diagnóstico seguro:
    // NO mostramos secretos ni la firma completa.
    console.log(
      "Webhook dLocal diagnóstico:",
      {
        hasSignatureHeader:
          Boolean(
            request.headers.get("signature")
          ),

        hasAuthorizationHeader:
          Boolean(
            request.headers.get(
              "authorization"
            )
          ),

        hasXDate:
          Boolean(
            request.headers.get("x-date")
          ),

        xDate:
          xDate,

        bodyLength:
          rawBody.length,

        signatureDetected:
          Boolean(receivedSignature),

        signatureLength:
          receivedSignature.length,
      }
    );

    if (!receivedSignature) {
      console.error(
        "Webhook dLocal: falta Signature."
      );

      return NextResponse.json(
        {
          error: "Falta Signature.",
        },
        { status: 401 }
      );
    }

    const dataToSign =
      xLogin + xDate + rawBody;

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(dataToSign, "utf8")
        .digest("hex")
        .toLowerCase();

    if (
      !verifySignature(
        receivedSignature,
        expectedSignature
      )
    ) {
      console.error(
        "Webhook dLocal: firma inválida."
      );

      return NextResponse.json(
        {
          error: "Firma inválida.",
        },
        { status: 401 }
      );
    }

    console.log(
      "Webhook dLocal: firma válida."
    );

    let notification: any;

    try {
      notification = JSON.parse(rawBody);
    } catch {
      console.error(
        "Webhook dLocal: JSON inválido."
      );

      return NextResponse.json(
        {
          error: "JSON inválido.",
        },
        { status: 400 }
      );
    }

    const paymentId =
      notification?.id;

    const orderId =
      notification?.order_id;

    const status =
      notification?.status;

    const amount =
      notification?.amount ?? null;

    const currency =
      notification?.currency ?? null;

    const payer =
      notification?.payer ?? {};

    const userReference =
      payer?.user_reference ?? "";

    const payerEmail =
      typeof payer?.email === "string"
        ? payer.email.trim()
        : "";

    if (!paymentId || !orderId) {
      console.error(
        "Webhook dLocal: faltan id u order_id."
      );

      return NextResponse.json(
        {
          error:
            "Faltan datos obligatorios.",
        },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    await db
      .ref(
        `dlocal_payments/${paymentId}`
      )
      .set({
        ...notification,
        received_at:
          new Date().toISOString(),
        signature_verified: true,
      });

    console.log(
      "Webhook dLocal guardado:",
      paymentId
    );

    if (status !== "PAID") {
      console.log(
        "Webhook dLocal: estado:",
        status
      );

      return NextResponse.json(
        {
          received: true,
          premiumActivated: false,
          status,
        },
        { status: 200 }
      );
    }

    let userEmail = payerEmail;

    if (userReference) {
      try {
        const auth = getAdminAuth();

        const firebaseUser =
          await auth.getUser(
            userReference
          );

        if (firebaseUser.email) {
          userEmail =
            firebaseUser.email.trim();
        }
      } catch (error) {
        console.error(
          "Webhook dLocal: no se pudo obtener el usuario Firebase.",
          error
        );
      }
    }

    if (!userEmail) {
      console.error(
        "Webhook dLocal: no se pudo identificar el usuario."
      );

      return NextResponse.json(
        {
          received: true,
          premiumActivated: false,
        },
        { status: 200 }
      );
    }

    const emailKey =
      safeEmailKey(userEmail);

    const perfilRef =
      db.ref(
        `usuarios_data/${emailKey}/perfil`
      );

    const perfilSnapshot =
      await perfilRef.once("value");

    const perfilActual =
      perfilSnapshot.exists()
        ? perfilSnapshot.val()
        : {};

    await perfilRef.set({
      ...perfilActual,

      es_premium: true,

      premium_activado_at:
        new Date().toISOString(),

      premium_payment_id:
        paymentId,

      premium_order_id:
        orderId,

      premium_amount:
        amount,

      premium_currency:
        currency,

      premium_provider:
        "dlocal",
    });

    console.log(
      "Webhook dLocal: PREMIUM ACTIVADO.",
      {
        emailKey,
        paymentId,
        orderId,
      }
    );

    return NextResponse.json(
      {
        received: true,
        premiumActivated: true,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Webhook dLocal: error interno.",
      error
    );

    return NextResponse.json(
      {
        error:
          "Error interno del webhook.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service:
      "MiOficio dLocal webhook",
    endpoint:
      "/api/dlocal/webhook",
  });
}