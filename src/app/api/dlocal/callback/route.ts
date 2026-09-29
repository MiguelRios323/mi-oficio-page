import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://mioficio-sepia.vercel.app";

/**
 * dLocal envía POST al callback_url cuando el usuario
 * termina el flujo de Checkout Redirect.
 *
 * IMPORTANTE:
 * El estado definitivo del pago NO se toma de este callback.
 * El webhook / notification_url es el que actualiza Premium.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType =
      request.headers.get("content-type") || "";

    let paymentId = "";
    let status = "";

    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));

      paymentId =
        typeof body?.paymentId === "string"
          ? body.paymentId
          : typeof body?.payment_id === "string"
            ? body.payment_id
            : "";

      status =
        typeof body?.status === "string"
          ? body.status
          : "";
    } else {
      const formData = await request.formData().catch(() => null);

      if (formData) {
        paymentId =
          String(
            formData.get("paymentId") ||
              formData.get("payment_id") ||
              ""
          );

        status =
          String(
            formData.get("status") || ""
          );
      }
    }

    console.log(
      "dLocal callback recibido:",
      {
        paymentId: paymentId || null,
        status: status || null,
      }
    );

    const params = new URLSearchParams();

    params.set("dlocal", "return");

    if (paymentId) {
      params.set("paymentId", paymentId);
    }

    if (status) {
      params.set("status", status);
    }

    /**
     * 303 See Other:
     *
     * Es importante usar 303 después de un POST.
     * Así el navegador continúa con GET hacia MiOficio
     * y no vuelve a hacer POST sobre la página principal.
     */
    return NextResponse.redirect(
      `${APP_URL}/?${params.toString()}`,
      303
    );
  } catch (error) {
    console.error(
      "Error procesando callback dLocal:",
      error
    );

    return NextResponse.redirect(
      `${APP_URL}/?dlocal=return`,
      303
    );
  }
}

/**
 * También dejamos GET habilitado por compatibilidad.
 */
export async function GET() {
  return NextResponse.redirect(
    `${APP_URL}/?dlocal=return`,
    302
  );
}