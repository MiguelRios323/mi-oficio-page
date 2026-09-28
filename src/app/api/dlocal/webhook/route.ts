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

/**
 * Extrae la firma enviada por dLocal.
 *
 * Formato esperado:
 *
 * Authorization:
 * V2-HMAC-SHA256, Signature: <64 caracteres hex>
 */
function getSignature(request: Request): string {
  const authorization =
    request.headers.get("authorization");

  if (authorization) {
    const value = authorization.trim();

    const match = value.match(
      /Signature\s*:\s*([a-fA-F0-9]{64})/i
    );

    if (match) {
      return match[1].toLowerCase();
    }

    if (/^[a-fA-F0-9]{64}$/.test(value)) {
      return value.toLowerCase();
    }
  }

  /**
   * Compatibilidad adicional por si dLocal
   * enviara la firma en un header separado.
   */
  const signatureHeader =
    request.headers.get("signature");

  if (signatureHeader) {
    const value =
      signatureHeader.trim();

    const match = value.match(
      /Signature\s*:\s*([a-fA-F0-9]{64})/i
    );

    if (match) {
      return match[1].toLowerCase();
    }

    if (/^[a-fA-F0-9]{64}$/.test(value)) {
      return value.toLowerCase();
    }
  }

  return "";
}

/**
 * Comparación segura de firmas.
 */
function verifySignature(
  received: string,
  expected: string
): boolean {
  const receivedBuffer =
    Buffer.from(received, "utf8");

  const expectedBuffer =
    Buffer.from(expected, "utf8");

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

/**
 * POST
 *
 * Endpoint que recibe las notificaciones
 * de dLocal.
 */
export async function POST(request: Request) {
  try {
    /**
     * IMPORTANTE:
     *
     * El body debe leerse como texto sin modificarlo.
     * El body forma parte de la firma HMAC.
     */
    const rawBody =
      await request.text();

    /**
     * ==================================================
     * VARIABLES DE ENTORNO
     * ==================================================
     */
    const xLogin =
      process.env.DLOCAL_X_LOGIN?.trim();

    const secretKey =
      process.env.DLOCAL_SECRET_KEY?.trim();

    /**
     * ==================================================
     * HEADERS DE DLOCAL
     * ==================================================
     */
    const xDate =
      request.headers
        .get("x-date")
        ?.trim() || "";

    const authorization =
      request.headers
        .get("authorization")
        ?.trim() || "";

    const signatureHeader =
      request.headers
        .get("signature")
        ?.trim() || "";

    /**
     * IMPORTANTE:
     *
     * dLocal realmente está enviando X-Login
     * en el POST real.
     */
    const xLoginHeader =
      request.headers
        .get("x-login")
        ?.trim() || "";

    const xVersion =
      request.headers
        .get("x-version")
        ?.trim() || "";

    /**
     * ==================================================
     * X-LOGIN UTILIZADO PARA LA FIRMA
     * ==================================================
     *
     * Para la firma utilizamos el X-Login enviado
     * por dLocal cuando está disponible.
     *
     * Si por algún motivo no viene, usamos la
     * variable de entorno.
     */
    const signingXLogin =
      xLoginHeader ||
      xLogin ||
      "";

    /**
     * ==================================================
     * FIRMA RECIBIDA
     * ==================================================
     */
    const receivedSignature =
      getSignature(request);

    /**
     * ==================================================
     * DIAGNÓSTICO SEGURO
     * ==================================================
     *
     * NO mostramos:
     *
     * - DLOCAL_SECRET_KEY
     * - DLOCAL_X_LOGIN completo
     * - X-Login completo
     * - Authorization completo
     * - Signature completa
     * - Body
     */
    console.log(
      "========== dLocal WEBHOOK DIAGNÓSTICO =========="
    );

    console.log(
      "Webhook dLocal diagnóstico:",
      {
        method:
          request.method,

        url:
          request.url,

        bodyLength:
          rawBody.length,

        hasAuthorizationHeader:
          Boolean(
            authorization
          ),

        authorizationLength:
          authorization.length,

        authorizationPrefix:
          authorization
            ? authorization
                .slice(0, 25)
                .replace(
                  /Signature.*$/i,
                  "Signature: ***"
                )
            : "",

        hasSignatureHeader:
          Boolean(
            signatureHeader
          ),

        signatureHeaderLength:
          signatureHeader.length,

        hasXDate:
          Boolean(xDate),

        xDateLength:
          xDate.length,

        xDateValue:
          xDate || "NO ENVIADO",

        hasXLoginHeader:
          Boolean(
            xLoginHeader
          ),

        xLoginHeaderLength:
          xLoginHeader.length,

        xVersion:
          xVersion ||
          "NO ENVIADO",

        envHasXLogin:
          Boolean(xLogin),

        envXLoginLength:
          xLogin?.length || 0,

        envHasSecret:
          Boolean(secretKey),

        signingXLoginSource:
          xLoginHeader
            ? "HEADER"
            : xLogin
            ? "ENVIRONMENT"
            : "NONE",

        receivedSignatureDetected:
          Boolean(
            receivedSignature
          ),

        receivedSignatureLength:
          receivedSignature.length,

        contentType:
          request.headers.get(
            "content-type"
          ) || "",

        userAgent:
          request.headers.get(
            "user-agent"
          ) || "",

        allHeaders:
          Array.from(
            request.headers.keys()
          ),
      }
    );

    console.log(
      "================================================="
    );

    /**
     * ==================================================
     * VALIDAR CONFIGURACIÓN
     * ==================================================
     */
    if (
      !xLogin ||
      !secretKey
    ) {
      console.error(
        "Webhook dLocal: faltan variables de entorno."
      );

      return NextResponse.json(
        {
          error:
            "Configuración dLocal incompleta.",
        },
        {
          status: 500,
        }
      );
    }

    /**
     * ==================================================
     * VALIDAR X-DATE
     * ==================================================
     */
    if (!xDate) {
      console.error(
        "Webhook dLocal: falta X-Date."
      );

      return NextResponse.json(
        {
          error:
            "Falta X-Date.",
        },
        {
          status: 401,
        }
      );
    }

    /**
     * ==================================================
     * VALIDAR SIGNATURE
     * ==================================================
     */
    if (!receivedSignature) {
      console.error(
        "Webhook dLocal: no se pudo extraer la firma."
      );

      return NextResponse.json(
        {
          error:
            "Falta Signature/Authorization.",
        },
        {
          status: 401,
        }
      );
    }

    /**
     * ==================================================
     * CALCULAR FIRMA CON X-LOGIN DEL HEADER
     * ==================================================
     *
     * dLocal:
     *
     * X-Login + X-Date + RequestBody
     *
     * HMAC-SHA256
     */
    const dataToSign =
      signingXLogin +
      xDate +
      rawBody;

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(
          dataToSign,
          "utf8"
        )
        .digest("hex")
        .toLowerCase();

    /**
     * ==================================================
     * DIAGNÓSTICO COMPARATIVO
     * ==================================================
     *
     * Calculamos además la firma usando
     * exclusivamente el X-Login de ENVIRONMENT.
     *
     * Así podemos determinar si la diferencia
     * viene del X-Login.
     */
    const expectedWithEnvLogin =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(
          (xLogin || "") +
            xDate +
            rawBody,
          "utf8"
        )
        .digest("hex")
        .toLowerCase();

    /**
     * Firma usando X-Login del HEADER.
     */
    const expectedWithHeaderLogin =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(
          (xLoginHeader || "") +
            xDate +
            rawBody,
          "utf8"
        )
        .digest("hex")
        .toLowerCase();

    console.log(
      "Webhook dLocal comparación de X-Login:",
      {
        envLoginPresent:
          Boolean(xLogin),

        headerLoginPresent:
          Boolean(xLoginHeader),

        sameXLogin:
          Boolean(
            xLogin &&
              xLoginHeader &&
              xLogin ===
                xLoginHeader
          ),

        envLoginLength:
          xLogin?.length || 0,

        headerLoginLength:
          xLoginHeader.length,

        signingXLoginSource:
          xLoginHeader
            ? "HEADER"
            : "ENVIRONMENT",

        receivedPrefix:
          receivedSignature.slice(
            0,
            8
          ),

        expectedEnvPrefix:
          expectedWithEnvLogin.slice(
            0,
            8
          ),

        expectedHeaderPrefix:
          expectedWithHeaderLogin.slice(
            0,
            8
          ),

        matchesEnvLogin:
          receivedSignature ===
          expectedWithEnvLogin,

        matchesHeaderLogin:
          receivedSignature ===
          expectedWithHeaderLogin,
      }
    );

    /**
     * ==================================================
     * COMPARACIÓN FINAL
     * ==================================================
     */
    console.log(
      "Webhook dLocal firma:",
      {
        receivedSignatureLength:
          receivedSignature.length,

        expectedSignatureLength:
          expectedSignature.length,

        receivedSignaturePrefix:
          receivedSignature.slice(
            0,
            8
          ),

        expectedSignaturePrefix:
          expectedSignature.slice(
            0,
            8
          ),

        signaturesMatch:
          receivedSignature ===
          expectedSignature,

        receivedIs64Hex:
          /^[a-fA-F0-9]{64}$/.test(
            receivedSignature
          ),

        expectedIs64Hex:
          /^[a-fA-F0-9]{64}$/.test(
            expectedSignature
          ),
      }
    );

    /**
     * ==================================================
     * VERIFICACIÓN SEGURA
     * ==================================================
     */
    if (
      !verifySignature(
        receivedSignature,
        expectedSignature
      )
    ) {
      console.error(
        "Webhook dLocal: FIRMA INVÁLIDA."
      );

      return NextResponse.json(
        {
          error:
            "Firma inválida.",
        },
        {
          status: 401,
        }
      );
    }

    console.log(
      "Webhook dLocal: FIRMA VÁLIDA."
    );

    /**
     * ==================================================
     * PARSEAR JSON
     * ==================================================
     */
    let notification: any;

    try {
      notification =
        JSON.parse(rawBody);
    } catch (error) {
      console.error(
        "Webhook dLocal: JSON inválido.",
        error
      );

      return NextResponse.json(
        {
          error:
            "JSON inválido.",
        },
        {
          status: 400,
        }
      );
    }

    /**
     * ==================================================
     * DATOS DE LA NOTIFICACIÓN
     * ==================================================
     */
    const paymentId =
      notification?.id || "";

    const orderId =
      notification?.order_id ||
      "";

    const status =
      notification?.status ||
      "";

    const statusCode =
      notification?.status_code ??
      null;

    const statusDetail =
      notification?.status_detail ??
      null;

    const amount =
      notification?.amount ??
      null;

    const currency =
      notification?.currency ??
      null;

    const payer =
      notification?.payer ||
      {};

    const userReference =
      payer?.user_reference ||
      "";

    const payerEmail =
      typeof payer?.email ===
      "string"
        ? payer.email.trim()
        : "";

    /**
     * ==================================================
     * LOG SEGURO DE NOTIFICACIÓN
     * ==================================================
     */
    console.log(
      "Webhook dLocal notificación:",
      {
        paymentId:
          paymentId
            ? String(paymentId)
                .slice(0, 20)
            : "",

        orderId:
          orderId
            ? String(orderId)
                .slice(0, 40)
            : "",

        status,

        statusCode,

        statusDetail,

        amount,

        currency,

        hasPayer:
          Boolean(
            notification?.payer
          ),

        hasUserReference:
          Boolean(
            userReference
          ),

        hasPayerEmail:
          Boolean(
            payerEmail
          ),
      }
    );

    /**
     * ==================================================
     * VALIDAR ID Y ORDER_ID
     * ==================================================
     */
    if (
      !paymentId ||
      !orderId
    ) {
      console.error(
        "Webhook dLocal: faltan id u order_id."
      );

      return NextResponse.json(
        {
          error:
            "Faltan datos obligatorios.",
        },
        {
          status: 400,
        }
      );
    }

    /**
     * ==================================================
     * FIREBASE
     * ==================================================
     */
    const db =
      getAdminDb();

    /**
     * Guardamos la notificación únicamente
     * después de verificar correctamente
     * la firma.
     */
    await db
      .ref(
        `dlocal_payments/${paymentId}`
      )
      .set({
        ...notification,

        received_at:
          new Date().toISOString(),

        signature_verified:
          true,
      });

    console.log(
      "Webhook dLocal: pago guardado en Firebase.",
      paymentId
    );

    /**
     * ==================================================
     * ESTADO DEL PAGO
     * ==================================================
     */
    if (
      status !== "PAID"
    ) {
      console.log(
        "Webhook dLocal: pago recibido con estado:",
        status
      );

      return NextResponse.json(
        {
          received: true,

          premiumActivated:
            false,

          status,
        },
        {
          status: 200,
        }
      );
    }

    /**
     * ==================================================
     * IDENTIFICAR USUARIO
     * ==================================================
     */
    let userEmail =
      payerEmail;

    /**
     * Intentamos primero con
     * payer.user_reference.
     *
     * En MiOficio debería contener
     * el UID de Firebase.
     */
    if (
      userReference
    ) {
      try {
        const auth =
          getAdminAuth();

        const firebaseUser =
          await auth.getUser(
            userReference
          );

        if (
          firebaseUser.email
        ) {
          userEmail =
            firebaseUser.email.trim();
        }

        console.log(
          "Webhook dLocal: usuario Firebase identificado."
        );
      } catch (error) {
        console.error(
          "Webhook dLocal: no se pudo obtener el usuario Firebase.",
          error
        );
      }
    }

    /**
     * Si no podemos identificar al usuario,
     * no activamos Premium.
     */
    if (!userEmail) {
      console.error(
        "Webhook dLocal: no se pudo identificar al usuario."
      );

      return NextResponse.json(
        {
          received: true,

          premiumActivated:
            false,

          reason:
            "Usuario no identificado.",
        },
        {
          status: 200,
        }
      );
    }

    /**
     * ==================================================
     * FIREBASE USER KEY
     * ==================================================
     */
    const emailKey =
      safeEmailKey(
        userEmail
      );

    console.log(
      "Webhook dLocal: emailKey generado."
    );

    /**
     * ==================================================
     * PERFIL
     * ==================================================
     */
    const perfilRef =
      db.ref(
        `usuarios_data/${emailKey}/perfil`
      );

    const perfilSnapshot =
      await perfilRef.once(
        "value"
      );

    const perfilActual =
      perfilSnapshot.exists()
        ? perfilSnapshot.val()
        : {};

    /**
     * ==================================================
     * ACTIVAR PREMIUM
     * ==================================================
     */
    await perfilRef.set({
      ...perfilActual,

      es_premium:
        true,

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
      "Webhook dLocal: PREMIUM ACTIVADO."
    );

    /**
     * ==================================================
     * RESPUESTA A DLOCAL
     * ==================================================
     *
     * HTTP 200 = notificación recibida
     * correctamente.
     */
    return NextResponse.json(
      {
        received: true,

        premiumActivated:
          true,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "Webhook dLocal: ERROR INTERNO.",
      error
    );

    return NextResponse.json(
      {
        error:
          "Error interno del webhook.",
      },
      {
        status: 500,
      }
    );
  }
}

/**
 * GET
 *
 * Sirve solamente para comprobar que
 * el endpoint está publicado.
 *
 * Las notificaciones de dLocal llegan
 * mediante POST.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,

    service:
      "MiOficio dLocal webhook",

    endpoint:
      "/api/dlocal/webhook",

    method:
      "POST",

    message:
      "Webhook activo. Las notificaciones de dLocal llegan mediante POST.",
  });
}