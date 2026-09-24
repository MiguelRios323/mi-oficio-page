import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEmailKey(email: string): string {
  return email
    .toLowerCase()
    .replace(/[.#$[\]]/g, "_")
    .slice(0, 100);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "mobbex-subscription",
    message: "MiOficio Mobbex API funcionando correctamente",

    testMode:
      process.env.MOBBEX_TEST_MODE === "true",

    apiKeyConfigured:
      Boolean(process.env.MOBBEX_API_KEY),

    accessTokenConfigured:
      Boolean(process.env.MOBBEX_ACCESS_TOKEN),

    appUrl:
      process.env.NEXT_PUBLIC_APP_URL || null,
  });
}

export async function POST(request: Request) {
  try {
    const authorization =
      request.headers.get("authorization");

    if (!authorization) {
      return NextResponse.json(
        {
          ok: false,
          error: "No autenticado.",
          detail:
            "Falta el header Authorization.",
        },
        { status: 401 }
      );
    }

    if (
      !authorization
        .toLowerCase()
        .startsWith("bearer ")
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Authorization inválido.",
          detail:
            "Se esperaba Bearer <token>.",
        },
        { status: 401 }
      );
    }

    const firebaseToken =
      authorization.slice(7).trim();

    if (!firebaseToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Token de Firebase vacío.",
        },
        { status: 401 }
      );
    }

    const { getAdminAuth } =
      await import("@/lib/firebase-admin");

    const adminAuth = getAdminAuth();

    const decodedToken =
      await adminAuth.verifyIdToken(
        firebaseToken
      );

    const firebaseEmail =
      decodedToken.email
        ?.trim()
        .toLowerCase();

    if (!firebaseEmail) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "La cuenta de Firebase no tiene email.",
        },
        { status: 400 }
      );
    }

    const apiKey =
      process.env.MOBBEX_API_KEY?.trim();

    const accessToken =
      process.env.MOBBEX_ACCESS_TOKEN?.trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Mobbex no está configurado.",
          detail:
            "Falta MOBBEX_API_KEY.",
        },
        { status: 500 }
      );
    }

    if (!accessToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Mobbex no está configurado.",
          detail:
            "Falta MOBBEX_ACCESS_TOKEN.",
        },
        { status: 500 }
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      "https://mioficio-sepia.vercel.app";

    const testMode =
      process.env.MOBBEX_TEST_MODE === "true";

    const emailKey =
      safeEmailKey(firebaseEmail);

    /*
     * Cada suscripción tendrá una referencia
     * propia para poder identificarla.
     */
    const reference =
      `mioficio_premium_${emailKey}_${Date.now()}`;

    const subscriptionBody = {
      total: 4999,

      currency: "ARS",

      setupfee: 0,

      type: "dynamic",

      name: "MiOficio Premium",

      description:
        "Suscripción mensual MiOficio Premium",

      interval: "1m",

      trial: 0,

      limit: 0,

      reference,

      test: testMode,

      return_url:
        `${appUrl}?mobbex=success`,

      webhook:
        `${appUrl}/api/mobbex/webhook`,
    };

    console.log(
      "Creando suscripción Mobbex:",
      {
        email: firebaseEmail,
        reference,
        testMode,
      }
    );

    const response = await fetch(
      "https://api.mobbex.com/p/subscriptions",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Accept":
            "application/json",

          "x-api-key":
            apiKey,

          "x-access-token":
            accessToken,

          "x-lang":
            "es",
        },

        body: JSON.stringify(
          subscriptionBody
        ),

        cache: "no-store",
      }
    );

    const responseText =
      await response.text();

    let data: any = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      console.error(
        "Mobbex devolvió una respuesta no JSON:",
        responseText
      );

      return NextResponse.json(
        {
          ok: false,
          error:
            "Mobbex devolvió una respuesta inesperada.",
          response:
            responseText.slice(0, 1000),
        },
        { status: 502 }
      );
    }

    if (
      !response.ok ||
      data?.result !== true
    ) {
      console.error(
        "Mobbex rechazó la suscripción:",
        {
          status: response.status,
          data,
        }
      );

      return NextResponse.json(
        {
          ok: false,

          error:
            "Mobbex rechazó la creación de la suscripción.",

          status:
            response.status,

          detail:
            data?.message ||
            data?.error ||
            data?.data ||
            "Respuesta inesperada de Mobbex.",
        },
        {
          status:
            response.status >= 400
              ? response.status
              : 502,
        }
      );
    }

    const subscription =
      data?.data || {};

    const checkoutUrl =
      subscription?.url ||
      subscription?.shorten_url ||
      subscription?.shortenUrl ||
      null;

    if (!checkoutUrl) {
      console.error(
        "Mobbex no devolvió URL de suscripción:",
        data
      );

      return NextResponse.json(
        {
          ok: false,
          error:
            "Mobbex no devolvió una URL de suscripción.",
          detail: data,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,

      testMode,

      subscriptionId:
        subscription?.uid || null,

      checkoutUrl,

      reference,

      email:
        firebaseEmail,
    });
  } catch (error: unknown) {
    console.error(
      "Error en /api/mobbex/subscription:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          "No se pudo iniciar MiOficio Premium.",

        detail:
          error instanceof Error
            ? error.message
            : "Error desconocido.",
      },
      { status: 500 }
    );
  }
}