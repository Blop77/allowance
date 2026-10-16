import "server-only";
import { randomUUID } from "node:crypto";

// PayPal REST APIs, sandbox only. Docs: https://developer.paypal.com/api/rest/
const BASE = "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: unknown,
  ) {
    super(message);
  }
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!paypalConfigured()) throw new PayPalError("PayPal sandbox credentials are not configured.", 500, null);
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError("Could not get a PayPal access token.", res.status, body);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = json?.details?.[0]?.description ?? json?.message ?? `PayPal ${method} ${path} failed`;
    throw new PayPalError(msg, res.status, json);
  }
  return json as T;
}

interface Link {
  href: string;
  rel: string;
}

// ---------- Vault: save the company's PayPal account once ----------

/** Step 1: create a setup token and return the URL where the admin approves saving the account. */
export async function createVaultSetupToken(returnUrl: string, cancelUrl: string) {
  const res = await call<{ id: string; links: Link[] }>(
    "POST",
    "/v3/vault/setup-tokens",
    {
      payment_source: {
        paypal: {
          description: "Allowance: AI buying agents pay with this account within your company's rules",
          usage_pattern: "IMMEDIATE",
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          permit_multiple_payment_tokens: false,
          experience_context: {
            brand_name: "Allowance",
            shipping_preference: "NO_SHIPPING",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
    randomUUID(),
  );
  const approve = res.links.find((l) => l.rel === "approve");
  if (!approve) throw new PayPalError("PayPal did not return an approval link.", 500, res);
  return { setupTokenId: res.id, approveUrl: approve.href };
}

/** Step 2: after approval, exchange the setup token for a reusable payment token (vault id). */
export async function createVaultPaymentToken(setupTokenId: string) {
  const res = await call<{
    id: string;
    customer?: { id: string };
    payment_source?: { paypal?: { email_address?: string } };
  }>(
    "POST",
    "/v3/vault/payment-tokens",
    { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
    randomUUID(),
  );
  return {
    paymentTokenId: res.id,
    customerId: res.customer?.id ?? null,
    email: res.payment_source?.paypal?.email_address ?? null,
  };
}

// ---------- Orders: the agent pays with the saved account ----------

interface OrderResponse {
  id: string;
  status: string;
  purchase_units?: { payments?: { captures?: { id: string; status: string }[] } }[];
}

export interface ChargeResult {
  orderId: string;
  orderStatus: string;
  captureId: string | null;
  captureStatus: string | null;
}

function firstCapture(order: OrderResponse) {
  return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}

/**
 * Create an order paid by the vaulted PayPal account, with no buyer present.
 * The idempotency key (PayPal-Request-Id) is the purchase id, so a retry can never double-charge.
 */
export async function chargeVaultedAccount(opts: {
  vaultId: string;
  purchaseId: string;
  amountCents: number;
  currency: string;
  description: string;
  teamName: string;
}): Promise<ChargeResult> {
  const value = (opts.amountCents / 100).toFixed(2);
  let order = await call<OrderResponse>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.purchaseId,
          custom_id: opts.purchaseId,
          description: opts.description.slice(0, 127),
          amount: { currency_code: opts.currency, value },
        },
      ],
      payment_source: { paypal: { vault_id: opts.vaultId } },
    },
    `order-${opts.purchaseId}`,
  );

  // With a vault_id PayPal normally completes the capture in the same call; capture explicitly if not.
  if (order.status === "APPROVED" || order.status === "CREATED") {
    order = await call<OrderResponse>(
      "POST",
      `/v2/checkout/orders/${order.id}/capture`,
      {},
      `capture-${opts.purchaseId}`,
    );
  }
  const capture = firstCapture(order);
  return {
    orderId: order.id,
    orderStatus: order.status,
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null,
  };
}

// ---------- Webhooks ----------

export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const res = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return res.verification_status === "SUCCESS";
}
