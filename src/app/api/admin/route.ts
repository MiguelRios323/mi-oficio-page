import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { requireAdministrator } from "@/lib/admin-access";
import {
  applyPayment,
  emailKey,
  matchesOrder,
  type Entitlement,
  type Order,
  type Payment,
} from "@/lib/mercadopago-core";
import {
  errorResponse,
  HttpError,
  liveMode,
  mp,
} from "@/lib/mercadopago-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Event = {
  at: number;
  actor: string;
  action: string;
  reason: string;
  uid: string;
  [key: string]: unknown;
};
type ManagedEntitlement = Entitlement & {
  adminEvents?: Record<string, Event>;
};
type StoredOrder = Order & {
  status?: string;
  paymentId?: string;
  createdAt?: number;
};
function fail(error: unknown) {
  const result = errorResponse(error);
  return NextResponse.json(
    {
      ok: false,
      error: result.message,
    },
    {
      status: result.status,
      headers,
    }
  );
}
function text(value: unknown, max = 500): string {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}
function validateUid(uid: string) {
  if (!uid || /[.#$\[\]\/]/.test(uid)) {
    throw new HttpError(400, "Usuario inválido.");
  }
}
export async function GET(request: NextRequest) {
  try {
    await requireAdministrator(request);
    const db = getAdminDb();
    const section =
      request.nextUrl.searchParams.get("section") || "users";
    if (section === "users") {
      const cursor =
        request.nextUrl.searchParams.get("cursor") || undefined;
      const page = await getAdminAuth().listUsers(50, cursor);
      const users = await Promise.all(
        page.users.map(async (user) => {
          const [benefit, profile] = await Promise.all([
            db.ref(`mercadopago_entitlements/${user.uid}`).get(),
            user.email
              ? db
                  .ref(
                    `usuarios_data/${emailKey(user.email)}/perfil`
                  )
                  .get()
              : Promise.resolve(null),
          ]);
          const entitlement =
            benefit.val() as ManagedEntitlement | null;
          const data = profile?.val();
          return {
            uid: user.uid,
            email: user.email || "",
            name:
              user.displayName ||
              data?.nombre_comercial ||
              "",
            disabled: user.disabled,
            createdAt: user.metadata.creationTime,
            lastLogin:
              user.metadata.lastSignInTime || "",
            premium:
              !!entitlement &&
              !entitlement.revoked &&
              Number(entitlement.expiresAt) > Date.now(),
            expiresAt:
              Number(entitlement?.expiresAt) || null,
            history: entitlement?.adminEvents || {},
          };
        })
      );
      return NextResponse.json(
        {
          ok: true,
          users,
          cursor: page.pageToken || null,
        },
        { headers }
      );
    }
    if (section === "payments") {
      const snapshot = await db
        .ref("mercadopago_orders")
        .orderByChild("createdAt")
        .limitToLast(200)
        .get();
      const entries = Object.entries(
        snapshot.val() || {}
      ) as [string, StoredOrder][];
      const benefits = new Map<
        string,
        ManagedEntitlement | null
      >();
      const uids = [
        ...new Set(entries.map(([, order]) => order.uid)),
      ];
      await Promise.all(
        uids.map(async (uid) => {
          const benefit = await db
            .ref(`mercadopago_entitlements/${uid}`)
            .get();
          benefits.set(
            uid,
            benefit.val() as ManagedEntitlement | null
          );
        })
      );
      const orders = entries
        .map(([id, order]) => {
          const entitlement = benefits.get(order.uid);
          const applied =
            !!order.paymentId &&
            entitlement?.payments?.[order.paymentId]
              ?.status === "approved";
          return {
            ...order,
            id,
            needsReview:
              order.status === "approved" && !applied,
          };
        })
        .sort(
          (a, b) =>
            (b.createdAt || 0) - (a.createdAt || 0)
        );
      return NextResponse.json(
        {
          ok: true,
          orders,
          scope:
            "Últimas 200 órdenes; no representa todo el historial.",
        },
        { headers }
      );
    }
    if (section === "notes" || section === "history") {
      const path =
        section === "notes" ? "admin_notes" : "admin_audit";
      const snapshot = await db
        .ref(path)
        .orderByChild("at")
        .limitToLast(200)
        .get();
      const data = snapshot.val() || {};
      const items = Object.entries(data)
        .map(([id, item]) => ({
          ...(item as Event),
          id,
        }))
        .sort((a, b) => b.at - a.at);
      return NextResponse.json(
        { ok: true, items },
        { headers }
      );
    }
    throw new HttpError(400, "Sección inválida.");
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const administrator =
      await requireAdministrator(request);
    const body = await request.json().catch(() => null);
    const action = text(body?.action, 40);
    const uid = text(body?.uid, 128);
    const reason = text(body?.reason);
    const operationId = text(body?.operationId, 36);
    if (!uuid.test(operationId)) {
      throw new HttpError(
        400,
        "Identificador de operación inválido."
      );
    }
    if (reason.length < 5) {
      throw new HttpError(
        400,
        "Ingresá un motivo de al menos cinco caracteres."
      );
    }
    const db = getAdminDb();
    const now = Date.now();
    const audit: Event = {
      at: now,
      actor: administrator.uid,
      action,
      reason,
      uid,
    };
    if (action === "grant" || action === "free") {
      validateUid(uid);
      const account = await getAdminAuth().getUser(uid);
      const expiresAt = Number(body.expiresAt);
      if (
        action === "grant" &&
        (
          !Number.isSafeInteger(expiresAt) ||
          expiresAt <= now ||
          expiresAt > now + 3660 * 86400000
        )
      ) {
        throw new HttpError(
          400,
          "Elegí un vencimiento futuro válido."
        );
      }
      const target = db.ref(
        `mercadopago_entitlements/${uid}`
      );
      const result = await target.transaction(
        (current: ManagedEntitlement | null) => {
          const value = current || {};
          if (value.adminEvents?.[operationId]) {
            return value;
          }
          const event: Event = {
            ...audit,
            beforeExpiresAt: value.expiresAt || 0,
            beforeRevoked: value.revoked || false,
            afterExpiresAt:
              action === "grant" ? expiresAt : 0,
          };
          return {
            ...value,
            uid,
            email: account.email || "",
            expiresAt:
              action === "grant" ? expiresAt : 0,
            revoked: action === "free",
            adminEvents: {
              ...value.adminEvents,
              [operationId]: event,
            },
          };
        }
      );
      if (!result.committed) {
        throw new HttpError(
          409,
          "No se pudo aplicar el cambio."
        );
      }
      const saved =
        result.snapshot.val() as ManagedEntitlement;
      await db
        .ref(`admin_audit/${operationId}`)
        .set(saved.adminEvents![operationId]);
    } else if (action === "reprocess") {
      const orderId = text(body.orderId, 36);
      if (!uuid.test(orderId)) {
        throw new HttpError(400, "Orden inválida.");
      }
      const target = db.ref(
        `mercadopago_orders/${orderId}`
      );
      const order =
        (await target.get()).val() as StoredOrder | null;
      if (!order) {
        throw new HttpError(404, "Orden inexistente.");
      }
      validateUid(order.uid);
      const paymentId =
        text(body.paymentId, 30) ||
        String(order.paymentId || "");
      if (!/^\d+$/.test(paymentId)) {
        throw new HttpError(
          400,
          "Ingresá el identificador numérico del pago."
        );
      }
      const seller = await mp<{ id: number | string }>("/users/me");
      console.info("MP diagnóstico de cuenta:", {
        vendedorDelToken: String(seller.id),
        vendedorDeLaOrden: String(order.collectorId),
        coincide: String(seller.id) === String(order.collectorId),
        paymentId,
        orderId,
      });
      const payment = await mp<Payment>(
        `/v1/payments/${paymentId}`
      );
      const configuredLiveMode = liveMode();
      if (String(payment.id) !== paymentId) {
        throw new HttpError(
          400,
          "El identificador del pago no coincide."
        );
      }
      if (payment.external_reference !== orderId) {
        throw new HttpError(
          400,
          "Este pago pertenece a otra orden o no contiene la referencia de esta orden de MiOficio."
        );
      }
      if (payment.live_mode !== configuredLiveMode) {
        throw new HttpError(
          400,
          `Entorno diferente: el pago es ${
            payment.live_mode ? "production" : "test"
          } y el servidor está en ${
            configuredLiveMode ? "production" : "test"
          }.`
        );
      }
      // Excepción limitada al caso verificado en esta conversación.
      // No habilita cambios de entorno para otras órdenes o pagos.
      const canReconcileEnvironment =
        orderId === "76aa98b3-9a84-4041-81fe-99ac5b85af57" &&
        paymentId === "183071427562" &&
        String(order.collectorId) === "3698378668" &&
        order.uid === "amnQcIaTsybytOoqt6xdn1Ru96f2" &&
        order.plan === "weekly" &&
        order.amount === 2799 &&
        order.currency === "ARS" &&
        order.liveMode === false &&
        payment.live_mode === true &&
        configuredLiveMode === true;

      const needsEnvironmentCorrection =
        payment.live_mode !== order.liveMode;

      if (needsEnvironmentCorrection && !canReconcileEnvironment) {
        throw new HttpError(
          400,
          "El entorno del pago no coincide con el guardado en la orden. Este caso no está autorizado para reconciliación."
        );
      }

      const validatedOrder: StoredOrder = needsEnvironmentCorrection
        ? { ...order, liveMode: payment.live_mode }
        : order;

      if (
        String(payment.collector_id) !==
        String(order.collectorId)
      ) {
        throw new HttpError(
          400,
          "El vendedor que recibió el pago no coincide con el de la orden."
        );
      }
      if (
        payment.transaction_amount !== order.amount
      ) {
        throw new HttpError(
          400,
          `Importe diferente: pago ${payment.transaction_amount}; orden ${order.amount}.`
        );
      }
      if (payment.currency_id !== order.currency) {
        throw new HttpError(
          400,
          "La moneda del pago no coincide con la orden."
        );
      }
      if (!matchesOrder(payment, validatedOrder)) {
        throw new HttpError(
          400,
          "La orden no cumple la validación del plan y su precio configurado."
        );
      }
      if (payment.status !== "approved") {
        throw new HttpError(
          409,
          `Pago no aprobado (${payment.status}). No se modificó Premium.`
        );
      }
      // Comprobar también la fecha antes de modificar cualquier registro.
      if (!Number.isFinite(Date.parse(payment.date_approved || ""))) {
        throw new HttpError(400, "El pago no tiene una fecha de aprobación válida.");
      }

      if (needsEnvironmentCorrection) {
        const correctionId = `environment_${paymentId}`;
        const correction = {
          at: now,
          actor: administrator.uid,
          action: "reconcile_environment",
          reason: "Corrección de entorno de orden histórica tras verificar el pago aprobado en Mercado Pago.",
          uid: order.uid,
          orderId,
          paymentId,
          beforeLiveMode: order.liveMode,
          afterLiveMode: payment.live_mode,
        };

        // Conserva la evidencia junto a la orden en la misma transacción.
        const reconciliation = await target.transaction(
          (current: (StoredOrder & { environmentCorrections?: Record<string, Event> }) | null) => {
            // Firebase puede invocar primero con una caché local vacía.
            // Devolver null permite sincronizar y reintentar; undefined aborta.
            if (current === null) return null;
            if (current.uid !== order.uid ||
                current.email !== order.email || current.plan !== order.plan ||
                current.amount !== order.amount || current.currency !== order.currency ||
                String(current.collectorId) !== String(order.collectorId) ||
                (current.paymentId && String(current.paymentId) !== paymentId)) {
              return;
            }
            if (current.liveMode === payment.live_mode &&
                current.environmentCorrections?.[correctionId]?.paymentId === paymentId) {
              return current;
            }
            if (current.liveMode !== order.liveMode) return;
            return {
              ...current,
              liveMode: payment.live_mode,
              paymentId,
              updatedAt: now,
              environmentCorrections: {
                ...current.environmentCorrections,
                [correctionId]: correction,
              },
            };
          }
        );

        if (!reconciliation.committed ||
            !reconciliation.snapshot.exists() ||
            reconciliation.snapshot.child("liveMode").val() !== payment.live_mode ||
            reconciliation.snapshot.child(`environmentCorrections/${correctionId}/paymentId`).val() !== paymentId) {
          throw new HttpError(409, "La orden cambió durante la revisión. Actualizá el panel antes de reintentar.");
        }

        const savedCorrection = reconciliation.snapshot
          .child(`environmentCorrections/${correctionId}`).val();
        await db.ref(`admin_audit/${correctionId}`).set(savedCorrection);
      }

      const result = await db
        .ref(`mercadopago_entitlements/${order.uid}`)
        .transaction(
          (current: Entitlement | null) =>
            applyPayment(current, payment, validatedOrder, now)
        );
      if (!result.committed) {
        throw new HttpError(
          409,
          "No se pudo procesar el beneficio."
        );
      }
      await target.update({
        paymentId,
        status: payment.status,
        updatedAt: now,
      });
      await db
        .ref(`admin_audit/${operationId}`)
        .set({
          ...audit,
          uid: order.uid,
          orderId,
          paymentId,
        });
    } else if (action === "note") {
      validateUid(uid);
      await getAdminAuth().getUser(uid);
      await db
        .ref(`admin_notes/${operationId}`)
        .set(audit);
      await db
        .ref(`admin_audit/${operationId}`)
        .set(audit);
    } else {
      throw new HttpError(400, "Acción inválida.");
    }
    return NextResponse.json(
      { ok: true },
      { headers }
    );
  } catch (error) {
    return fail(error);
  }
}