import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEmailKey(email: string) {
  return email
    .toLowerCase()
    .replace(/[.#$[\]\\]/g, "_");
}

export async function POST(request: NextRequest) {
  try {
    console.log("========================================");
    console.log("MiOficio - Mercado Pago Subscription API");
    console.log("========================================");

    // =========================================================
    // 1. AUTENTICACIÓN FIREBASE
    // =========================================================

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      console.error("No se recibió Authorization Bearer");

      return NextResponse.json(
        {
          success: false,
          error: "No autorizado",
        },
        { status: 401 }
      );
    }

    const firebaseToken = authorization.substring(7);

    let decodedToken;

    try {
      decodedToken = await adminAuth.verifyIdToken(firebaseToken);
    } catch (error) {
      console.error("Token Firebase inválido:", error);

      return NextResponse.json(
        {
          success: false,
          error: "La sesión de Firebase no es válida.",
        },
        { status: 401 }
      );
    }

    const firebaseEmail = decodedToken.email;

    if (!firebaseEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "El usuario de Firebase no tiene email.",
        },
        { status: 400 }
      );
    }

    // =========================================================
    // 2. CONFIGURACIÓN MERCADO PAGO
    // =========================================================

    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!accessToken) {
      console.error(
        "MERCADOPAGO_ACCESS_TOKEN no está configurado."
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Mercado Pago no está configurado correctamente en el servidor.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 3. MODO TEST
    // =========================================================

    const testMode =
      process.env.MERCADOPAGO_TEST_MODE === "true";

    /*
     * Mercado Pago TEST necesita un comprador de prueba.
     *
     * No usamos directamente el email de Firebase cuando
     * estamos en modo TEST, porque ese email puede ser un
     * usuario real.
     *
     * Mercado Pago documenta test@testuser.com como email
     * de comprador de prueba.
     */

    const payerEmail = testMode
      ? process.env.MERCADOPAGO_TEST_PAYER_EMAIL ||
        "test@testuser.com"
      : firebaseEmail;

    console.log("Configuración Mercado Pago:", {
      testMode,
      firebaseEmail,
      payerEmail,
      tokenConfigured: Boolean(accessToken),
    });

    // =========================================================
    // 4. REFERENCIA DEL USUARIO MIOFICIO
    // =========================================================

    const emailKey = safeEmailKey(firebaseEmail);

    const externalReference =
      `mioficio_${emailKey}`;

    // =========================================================
    // 5. URL DE RETORNO
    // =========================================================

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://mioficio-sepia.vercel.app";

    // =========================================================
    // 6. DATOS DE LA SUSCRIPCIÓN
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
      "Datos enviados a Mercado Pago:",
      {
        reason: subscriptionData.reason,
        external_reference:
          subscriptionData.external_reference,
        payer_email:
          subscriptionData.payer_email,
        amount:
          subscriptionData.auto_recurring
            .transaction_amount,
        currency:
          subscriptionData.auto_recurring.currency_id,
        back_url:
          subscriptionData.back_url,
        testMode,
      }
    );

    // =========================================================
    // 7. CREAR SUSCRIPCIÓN
    // =========================================================

    const mpResponse = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          "Content-Type":
            "application/json",
          Accept:
            "application/json",
        },

        body: JSON.stringify(
          subscriptionData
        ),

        cache: "no-store",
      }
    );

    // =========================================================
    // 8. LEER RESPUESTA UNA SOLA VEZ
    // =========================================================

    const responseText =
      await mpResponse.text();

    console.log(
      "Mercado Pago HTTP status:",
      mpResponse.status
    );

    console.log(
      "Mercado Pago response:",
      responseText.substring(0, 2000)
    );

    let mpData: any = {};

    if (responseText.trim()) {
      try {
        mpData =
          JSON.parse(responseText);
      } catch (error) {
        console.error(
          "Mercado Pago devolvió contenido no JSON:",
          error
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Mercado Pago devolvió una respuesta inesperada.",
            status:
              mpResponse.status,
            response:
              responseText.substring(
                0,
                1000
              ),
          },
          { status: 502 }
        );
      }
    }

    // =========================================================
    // 9. MERCADO PAGO DEVOLVIÓ ERROR
    // =========================================================

    if (!mpResponse.ok) {
      console.error(
        "========================================"
      );

      console.error(
        "ERROR MERCADO PAGO"
      );

      console.error(
        JSON.stringify(
          mpData,
          null,
          2
        )
      );

      console.error(
        "HTTP:",
        mpResponse.status
      );

      console.error(
        "========================================"
      );

      return NextResponse.json(
        {
          success: false,

          error:
            mpData?.message ||
            mpData?.error ||
            "Mercado Pago rechazó la creación de la suscripción.",

          details: mpData,

          status:
            mpResponse.status,
        },
        {
          status:
            mpResponse.status >= 400 &&
            mpResponse.status < 600
              ? mpResponse.status
              : 502,
        }
      );
    }

    // =========================================================
    // 10. VALIDAR RESPUESTA
    // =========================================================

    const subscriptionId =
      mpData?.id;

    const checkoutUrl =
      mpData?.init_point;

    if (!subscriptionId) {
      console.error(
        "Mercado Pago no devolvió ID:",
        mpData
      );

      return NextResponse.json(
        {
          success: false,

          error:
            "Mercado Pago no devolvió el ID de la suscripción.",

          details: mpData,
        },
        { status: 502 }
      );
    }

    if (!checkoutUrl) {
      console.error(
        "Mercado Pago no devolvió init_point:",
        mpData
      );

      return NextResponse.json(
        {
          success: false,

          error:
            "Mercado Pago creó la suscripción pero no devolvió el enlace de pago.",

          details: mpData,
        },
        { status: 502 }
      );
    }

    // =========================================================
    // 11. RESPUESTA AL FRONTEND
    // =========================================================

    console.log(
      "Suscripción creada correctamente:",
      {
        subscriptionId,
        checkoutUrl,
        externalReference,
        payerEmail,
        testMode,
      }
    );

    return NextResponse.json(
      {
        success: true,

        testMode,

        subscriptionId,

        checkoutUrl,

        externalReference,

        payerEmail,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "========================================"
    );

    console.error(
      "ERROR INTERNO MIOFICIO"
    );

    console.error(error);

    console.error(
      "========================================"
    );

    return NextResponse.json(
      {
        success: false,

        error:
          "No se pudo crear la suscripción Premium.",

        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}