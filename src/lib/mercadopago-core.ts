import { createHmac, timingSafeEqual } from "node:crypto";

export const PLANS = {
  daily: { amount: 399, days: 1, label: "Diario" },
  weekly: { amount: 2799, days: 7, label: "Semanal" },
  monthly: { amount: 11999, days: 30, label: "Mensual" },
  yearly: { amount: 139999, days: 365, label: "Anual" },
} as const;

export type Plan = keyof typeof PLANS;

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && Object.hasOwn(PLANS, value);
}

export function emailKey(email: string): string {
  return email.toLowerCase().replace(/[.#$\[\]]/g, "_");
}

export function validSignature(
  id: string,
  requestId: string,
  signature: string,
  secret: string
): boolean {
  const dataId = id.trim().toLowerCase();
  const requestIdValue = requestId.trim();

  const entries = signature.split(",").map((part) => {
    const separator = part.indexOf("=");

    if (separator < 0) {
      return ["", ""] as const;
    }

    return [
      part.slice(0, separator).trim(),
      part.slice(separator + 1).trim(),
    ] as const;
  });

  const ts = entries.find(([key]) => key === "ts")?.[1] || "";

  const hashes = entries
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);

  if (
    !dataId ||
    !requestIdValue ||
    !secret ||
    !/^\d+$/.test(ts)
  ) {
    console.warn("MP firma: datos incompletos o inválidos.");
    return false;
  }

  const manifest =
    `id:${dataId};request-id:${requestIdValue};ts:${ts};`;

  const expected = createHmac("sha256", secret)
    .update(manifest, "utf8")
    .digest();

  const valid = hashes.some((hash) => {
    if (!/^[a-f0-9]{64}$/i.test(hash)) return false;

    return timingSafeEqual(expected, Buffer.from(hash, "hex"));
  });

  console.info("MP datos para validar firma:", {
    revision: "parser-firma-3",
    dataId,
    requestId: requestIdValue,
    timestamp: ts,
    cantidadHashes: hashes.length,
    espaciosEnId: id !== id.trim(),
    espaciosEnRequestId: requestId !== requestIdValue,
    firmaValida: valid,
  });

  return valid;
}

export interface Order {
  uid: string;
  email: string;
  plan: Plan;
  amount: number;
  currency: string;
  collectorId: string;
  liveMode: boolean;
}

export interface Payment {
  id: number | string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  collector_id: number | string;
  live_mode: boolean;
  external_reference: string;
  date_approved?: string;
}

export function matchesOrder(
  payment: Payment,
  order: Order
): boolean {
  return (
    isPlan(order.plan) &&
    order.amount === PLANS[order.plan].amount &&
    payment.transaction_amount === order.amount &&
    payment.currency_id === order.currency &&
    order.currency === "ARS" &&
    String(payment.collector_id) === order.collectorId &&
    payment.live_mode === order.liveMode
  );
}

export interface Entitlement {
  uid?: string;
  email?: string;
  expiresAt?: number;
  payments?: Record<
    string,
    {
      status: string;
      expiresAt: number;
      activatedAt: number;
    }
  >;
  revoked?: boolean;
}

export function applyPayment(
  current: Entitlement | null,
  payment: Payment,
  order: Order,
  now: number
): Entitlement {
  const value = current || {};
  const key = String(payment.id);
  const previous = value.payments?.[key];

  const reversals = ["refunded", "charged_back", "cancelled"];

  if (previous) {
    // Conserva el comportamiento existente:
    // una reversión de un pago registrado revoca todo el acceso.
    if (reversals.includes(payment.status)) {
      return {
        ...value,
        expiresAt: 0,
        revoked: true,
        payments: {
          ...value.payments,
          [key]: {
            ...previous,
            status: payment.status,
          },
        },
      };
    }

    // Una aprobación repetida no suma días nuevamente.
    return value;
  }

  if (payment.status !== "approved") {
    if (reversals.includes(payment.status)) {
      return {
        ...value,
        payments: {
          ...value.payments,
          [key]: {
            status: payment.status,
            expiresAt: 0,
            activatedAt: 0,
          },
        },
      };
    }

    return value;
  }

  const approved = Date.parse(payment.date_approved || "");

  if (!Number.isFinite(approved)) {
    throw new Error("Fecha de aprobación inválida");
  }

  const activatedAt = Math.min(approved, now);

  const expiresAt =
    Math.max(activatedAt, value.expiresAt || 0) +
    PLANS[order.plan].days * 86400000;

  return {
    ...value,
    uid: order.uid,
    email: order.email,
    expiresAt,
    revoked: false,
    payments: {
      ...value.payments,
      [key]: {
        status: "approved",
        expiresAt,
        activatedAt,
      },
    },
  };
}