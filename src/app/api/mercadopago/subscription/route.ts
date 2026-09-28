import { getAdminAuth } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MERCADO_PAGO_API = "https://api.mercadopago.com";

function getTokenType(token: string): "TEST" | "APP_USR" | "UNKNOWN" {
  if (token.startsWith("TEST-")) return "TEST";
  if (token.startsWith("APP_USR-")) return "APP_USR";
  return "UNKNOWN";
}

function safeExternalReference(email: string): string {
  return (
    "mioficio_" +
    email
      .toLowerCase()
      .replace(/[.#$[\]\\/]/g, "_")
      .slice(0, 100)
  );
}

function parseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET() {
  const accessToken =
    process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? "";

  const testMode =
    process.env.MERCADOPAGO_TEST_MODE === "true";

  const testPayerEmail =
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL?.trim() ?? "";

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";

  return Response.json({
    ok: true,
    route: "mercadopago-subscription",

    testMode,

    tokenConfigured: Boolean(accessToken),

    tokenType: accessToken
      ? getTokenType(accessToken)
      : "NOT_CONFIGURED",

    testPayerConfigured: Boolean(testPayerEmail),

    testPayerEmail:
      testMode && testPayerEmail
        ? testPayerEmail
        : null,

    firebaseConfigured:
      Boolean(process.env.FIREBASE_PROJECT_ID) &&
      Boolean(process.env.FIREBASE_CLIENT_EMAIL) &&
      Boolean(process.env.FIREBASE_PRIVATE_KEY) &&
      Boolean(process.env.FIREBASE_DATABASE_URL),

    appUrl,
  });
}

export async function POST(request: Request) {
  try {
    /*
     * ---------------------------------------------------------
     * 1. MERCADO PAGO ACCESS TOKEN
     * ---------------------------------------------------------
     */

    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

    if (!accessToken) {
      return Response.json(
        {
          ok: false,
          error:
            "Falta MERCADOPAGO_ACCESS_TOKEN en las variables de entorno.",
        },
        { status: 500 }
      );
    }

    const testMode =
      process.env.MERCADOPAGO_TEST_MODE === "true";

    const tokenType = getTokenType(accessToken);

    /*
     * ---------------------------------------------------------
     * 2. FIREBASE AUTH
     * ---------------------------------------------------------
     */

    const authorization =
      request.headers.get("authorization");

    if (!authorization) {
      return Response.json(
        {
          ok: false,
          error:
            "No se recibió el token de autenticación de Firebase.",
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
          error:
            "El encabezado Authorization no tiene formato Bearer.",
        },
        { status: 401 }
      );
    }

    const firebaseIdToken =
      authorization.slice(7).trim();

    if (!firebaseIdToken) {
      return Response.json(
        {
          ok: false,
          error:
            "El token de Firebase está vacío.",
        },
        { status: 401 }
      );
    }

    const adminAuth = getAdminAuth();

    const decodedToken =
      await adminAuth.verifyIdToken(
        firebaseIdToken
      );

    const firebaseEmail =
      decodedToken.email
        ?.trim()
        .toLowerCase();

    if (!firebaseEmail) {
      return Response.json(
        {
          ok: false,
          error:
            "La cuenta de Firebase no tiene un correo electrónico asociado.",
        },
        { status: 400 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 3. EMAIL DEL PAGADOR
     * ---------------------------------------------------------
     *
     * En modo prueba usamos el usuario de prueba
     * configurado en Mercado Pago.
     */

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
              "MERCADOPAGO_TEST_MODE está activo pero falta MERCADOPAGO_TEST_PAYER_EMAIL.",
          },
          { status: 500 }
        );
      }

      payerEmail = testPayerEmail;
    }

    /*
     * ---------------------------------------------------------
     * 4. URL DE RETORNO
     * ---------------------------------------------------------
     */

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      "http://localhost:3000";

    let backUrl: string;

    try {
      const parsedUrl = new URL(appUrl);

      backUrl = parsedUrl.toString().replace(/\/$/, "");
    } catch {
      return Response.json(
        {
          ok: false,
          error:
            "NEXT_PUBLIC_APP_URL no contiene una URL válida.",
          appUrl,
        },
        { status: 500 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 5. REFERENCIA INTERNA
     * ---------------------------------------------------------
     */

    const externalReference =
      safeExternalReference(firebaseEmail);

    /*
     * ---------------------------------------------------------
     * 6. BODY PARA MERCADO PAGO
     * ---------------------------------------------------------
     */

    const subscriptionBody = {
      reason: "MiOficio Premium",

      external_reference:
        externalReference,

      payer_email: payerEmail,

      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 4999,
        currency_id: "ARS",
      },

      back_url: backUrl,

      status: "pending",
    };

    /*
     * ---------------------------------------------------------
     * 7. HEADERS
     * ---------------------------------------------------------
     */

    const mercadoPagoHeaders: Record<
      string,
      string
    > = {
      Authorization:
        `Bearer ${accessToken}`,

      "Content-Type":
        "application/json",

      Accept:
        "application/json",
    };

    /*
     * IMPORTANTE:
     *
     * Mercado Pago documenta X-scope: stage
     * para operaciones de prueba con tokens TEST-
     * en determinados flujos de suscripciones.
     */

    if (
      testMode &&
      tokenType === "TEST"
    ) {
      mercadoPagoHeaders["X-scope"] =
        "stage";
    }

    /*
     * ---------------------------------------------------------
     * 8. CREAR SUSCRIPCIÓN
     * ---------------------------------------------------------
     */

    const mercadoPagoResponse =
      await fetch(
        `${MERCADO_PAGO_API}/preapproval`,
        {
          method: "POST",

          headers:
            mercadoPagoHeaders,

          body: JSON.stringify(
            subscriptionBody
          ),

          cache: "no-store",
        }
      );

    /*
     * ---------------------------------------------------------
     * 9. LEER RESPUESTA COMPLETA
     * ---------------------------------------------------------
     */

    const rawResponse =
      await mercadoPagoResponse.text();

    const mercadoPagoData =
      parseJson(rawResponse) as
        | Record<string, unknown>
        | null;

    /*
     * ---------------------------------------------------------
     * 10. SI MERCADO PAGO DEVUELVE ERROR
     * ---------------------------------------------------------
     */

    if (!mercadoPagoResponse.ok) {
      console.error(
        "Mercado Pago rechazó /preapproval:",
        {
          status:
            mercadoPagoResponse.status,

          tokenType,

          testMode,

          payerEmail,

          response:
            mercadoPagoData ??
            rawResponse,
        }
      );

      return Response.json(
        {
          ok: false,

          error:
            "Mercado Pago rechazó la creación de la suscripción.",

          mpStatus:
            mercadoPagoResponse.status,

          mpError:
            mercadoPagoData?.error ??
            null,

          mpMessage:
            mercadoPagoData?.message ??
            null,

          mpCause:
            mercadoPagoData?.cause ??
            null,

          mpResponse:
            mercadoPagoData ??
            rawResponse ??
            "Respuesta vacía de Mercado Pago.",

          debug: {
            testMode,
            tokenType,
            payerEmail,
            backUrl,
          },
        },
        {
          status: 502,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 11. VERIFICAR RESPUESTA
     * ---------------------------------------------------------
     */

    if (!mercadoPagoData) {
      return Response.json(
        {
          ok: false,

          error:
            "Mercado Pago respondió correctamente pero la respuesta no pudo interpretarse.",

          rawResponse,
        },
        { status: 502 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 12. OBTENER CHECKOUT
     * ---------------------------------------------------------
     */

    const checkoutUrl =
      typeof mercadoPagoData.init_point ===
      "string"
        ? mercadoPagoData.init_point
        : typeof mercadoPagoData.sandbox_init_point ===
          "string"
        ? mercadoPagoData.sandbox_init_point
        : null;

    if (!checkoutUrl) {
      console.error(
        "Mercado Pago no devolvió init_point:",
        mercadoPagoData
      );

      return Response.json(
        {
          ok: false,

          error:
            "Mercado Pago creó la respuesta, pero no devolvió una URL de checkout.",

          subscriptionId:
            mercadoPagoData.id ??
            null,

          mercadoPago:
            mercadoPagoData,
        },
        { status: 502 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 13. RESPUESTA FINAL A MIOFICIO
     * ---------------------------------------------------------
     */

    return Response.json({
      ok: true,

      testMode,

      tokenType,

      subscriptionId:
        mercadoPagoData.id ??
        null,

      status:
        mercadoPagoData.status ??
        "pending",

      checkoutUrl,

      payerEmail,

      externalReference,

      backUrl,
    });
  } catch (error) {
    console.error(
      "Error interno creando suscripción Premium:",
      error
    );

    return Response.json(
      {
        ok: false,

        error:
          "Error interno al crear la suscripción Premium.",

        detail:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}