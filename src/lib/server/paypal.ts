import "server-only";
import { fetchWithTimeout } from "./net";

/**
 * PayPal REST client (Orders v2 + Payments v2), sandbox by default.
 *
 * Dalil never captures money on approval: orders use intent=AUTHORIZE so the
 * buyer's funds are only HELD. Capture happens after the 10-minute cancel
 * window (or when the user confirms); cancel = void the authorization.
 */

const ENV = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
export const PAYPAL_API =
  process.env.PAYPAL_API_BASE /* tests only */ ??
  (ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

export class PayPalError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code = "PAYPAL_ERROR",
    public debugId?: string,
  ) {
    super(message);
  }
}

export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (!paypalConfigured()) {
    throw new PayPalError("PayPal is not configured on the server", 503, "PAYPAL_NOT_CONFIGURED");
  }
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetchWithTimeout(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    timeoutMs: 15000,
  });
  if (!res.ok) throw new PayPalError(`PayPal auth failed (${res.status})`, 502, "PAYPAL_AUTH_FAILED");
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function pp<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown; requestId?: string } = {},
): Promise<T> {
  const token = await accessToken();
  const res = await fetchWithTimeout(`${PAYPAL_API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    timeoutMs: 30000,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = json?.details?.[0];
    throw new PayPalError(
      detail?.description ?? json?.message ?? `PayPal ${res.status}`,
      res.status,
      detail?.issue ?? json?.name ?? "PAYPAL_ERROR",
      json?.debug_id,
    );
  }
  return json as T;
}

/* ---------------- Money ---------------- */

/** PayPal does not settle EGP, so EGP prices are charged in USD at a fixed, disclosed rate. */
export function toChargeable(amount: number, currency: string): { value: string; currency: string; rate?: number } {
  const cur = currency.toUpperCase();
  if (cur === "EGP") {
    const rate = Number(process.env.EGP_PER_USD) || 50;
    return { value: (Math.ceil((amount / rate) * 100) / 100).toFixed(2), currency: "USD", rate };
  }
  const zeroDecimal = ["JPY", "HUF", "TWD"].includes(cur);
  return { value: zeroDecimal ? Math.round(amount).toFixed(0) : amount.toFixed(2), currency: cur };
}

/* ---------------- Orders ---------------- */

export interface OrderInput {
  referenceId: string;
  title: string;
  store: string;
  url?: string;
  imageUrl?: string;
  price: number;
  shipping: number;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
  /** Save the buyer's PayPal wallet (Vault) for future auto-buys. */
  vault?: boolean;
}

export interface CreatedOrder {
  id: string;
  approveUrl: string;
  charge: { value: string; currency: string };
}

export async function createOrder(input: OrderInput): Promise<CreatedOrder> {
  const item = toChargeable(input.price, input.currency);
  const ship = toChargeable(input.shipping, input.currency);
  const total = (Number(item.value) + Number(ship.value)).toFixed(2);
  const currency = item.currency;

  const safeUrl = (u?: string) => (u && /^https:\/\//.test(u) && u.length < 2000 ? u : undefined);

  const body = {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: input.referenceId.slice(0, 256),
        description: `Dalil agent purchase · ${input.store}`.slice(0, 127),
        soft_descriptor: "DALIL",
        amount: {
          currency_code: currency,
          value: total,
          breakdown: {
            item_total: { currency_code: currency, value: item.value },
            shipping: { currency_code: currency, value: ship.value },
          },
        },
        items: [
          {
            name: input.title.slice(0, 127),
            quantity: "1",
            category: "PHYSICAL_GOODS",
            unit_amount: { currency_code: currency, value: item.value },
            ...(safeUrl(input.url) ? { url: safeUrl(input.url) } : {}),
            ...(safeUrl(input.imageUrl) ? { image_url: safeUrl(input.imageUrl) } : {}),
          },
        ],
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Dalil",
          shipping_preference: "GET_FROM_FILE", // ship to the buyer's PayPal address
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
        ...(input.vault
          ? {
              attributes: {
                vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" },
              },
            }
          : {}),
      },
    },
  };

  const order = await pp<{ id: string; links: Array<{ rel: string; href: string }> }>("/v2/checkout/orders", {
    method: "POST",
    body,
    requestId: `dalil-${input.referenceId}`.slice(0, 108),
  });
  const approve = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!approve) throw new PayPalError("No approval link returned", 502);
  return { id: order.id, approveUrl: approve.href, charge: { value: total, currency } };
}

export interface ShippingInfo {
  name?: string;
  address?: string;
}

export interface Authorized {
  orderId: string;
  authorizationId: string;
  status: string;
  amount: { value: string; currency: string };
  expiresAt?: string;
  shipping: ShippingInfo;
  payerEmail?: string;
  vaultId?: string;
  customerId?: string;
}

type OrderJson = {
  id: string;
  status: string;
  payer?: { email_address?: string };
  payment_source?: {
    paypal?: {
      email_address?: string;
      attributes?: { vault?: { id?: string; status?: string; customer?: { id?: string } } };
    };
  };
  purchase_units?: Array<{
    shipping?: {
      name?: { full_name?: string };
      address?: {
        address_line_1?: string;
        address_line_2?: string;
        admin_area_2?: string;
        admin_area_1?: string;
        postal_code?: string;
        country_code?: string;
      };
    };
    payments?: {
      authorizations?: Array<{
        id: string;
        status: string;
        amount: { value: string; currency_code: string };
        expiration_time?: string;
      }>;
    };
  }>;
};

function formatShipping(o: OrderJson): ShippingInfo {
  const sh = o.purchase_units?.[0]?.shipping;
  const a = sh?.address;
  return {
    name: sh?.name?.full_name,
    address: a
      ? [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code]
          .filter(Boolean)
          .join(", ")
      : undefined,
  };
}

function toAuthorized(o: OrderJson): Authorized {
  const auth = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new PayPalError("Order has no authorization", 409, "NO_AUTHORIZATION");
  return {
    orderId: o.id,
    authorizationId: auth.id,
    status: auth.status,
    amount: { value: auth.amount.value, currency: auth.amount.currency_code },
    expiresAt: auth.expiration_time,
    shipping: formatShipping(o),
    payerEmail: o.payment_source?.paypal?.email_address ?? o.payer?.email_address,
    vaultId: o.payment_source?.paypal?.attributes?.vault?.id,
    customerId: o.payment_source?.paypal?.attributes?.vault?.customer?.id,
  };
}

/** Buyer approved on PayPal → place the hold. */
export async function authorizeOrder(orderId: string): Promise<Authorized> {
  if (!/^[A-Z0-9]{10,25}$/.test(orderId)) throw new PayPalError("Invalid order id", 400, "INVALID_ORDER_ID");
  try {
    const o = await pp<OrderJson>(`/v2/checkout/orders/${orderId}/authorize`, {
      method: "POST",
      body: {},
      requestId: `dalil-auth-${orderId}`,
    });
    return toAuthorized(o);
  } catch (e) {
    // Idempotency: if it was already authorized, return the existing hold.
    if (e instanceof PayPalError && e.code === "ORDER_ALREADY_AUTHORIZED") {
      return toAuthorized(await pp<OrderJson>(`/v2/checkout/orders/${orderId}`));
    }
    throw e;
  }
}

/** Auto-buy: charge a vaulted PayPal wallet without the buyer present (still only a hold). */
export async function createAndAuthorizeWithVault(
  input: Omit<OrderInput, "returnUrl" | "cancelUrl" | "vault"> & { vaultId: string },
): Promise<Authorized> {
  const item = toChargeable(input.price, input.currency);
  const ship = toChargeable(input.shipping, input.currency);
  const total = (Number(item.value) + Number(ship.value)).toFixed(2);
  const o = await pp<OrderJson>("/v2/checkout/orders", {
    method: "POST",
    requestId: `dalil-auto-${input.referenceId}`.slice(0, 108),
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.referenceId.slice(0, 256),
          description: `Dalil auto-buy · ${input.store}`.slice(0, 127),
          amount: {
            currency_code: item.currency,
            value: total,
            breakdown: {
              item_total: { currency_code: item.currency, value: item.value },
              shipping: { currency_code: item.currency, value: ship.value },
            },
          },
          items: [
            {
              name: input.title.slice(0, 127),
              quantity: "1",
              category: "PHYSICAL_GOODS",
              unit_amount: { currency_code: item.currency, value: item.value },
            },
          ],
        },
      ],
      payment_source: { paypal: { vault_id: input.vaultId } },
    },
  });
  // With a vault_id PayPal can complete without redirect; authorize if needed.
  if (o.status === "COMPLETED" || o.purchase_units?.[0]?.payments?.authorizations?.length) return toAuthorized(o);
  return authorizeOrder(o.id);
}

export async function captureAuthorization(authorizationId: string): Promise<{ id: string; status: string }> {
  if (!/^[A-Z0-9]{10,25}$/.test(authorizationId)) throw new PayPalError("Invalid authorization id", 400);
  const r = await pp<{ id: string; status: string }>(`/v2/payments/authorizations/${authorizationId}/capture`, {
    method: "POST",
    body: { final_capture: true },
    requestId: `dalil-cap-${authorizationId}`,
  });
  return { id: r.id, status: r.status };
}

export async function voidAuthorization(authorizationId: string): Promise<{ status: string }> {
  if (!/^[A-Z0-9]{10,25}$/.test(authorizationId)) throw new PayPalError("Invalid authorization id", 400);
  await pp(`/v2/payments/authorizations/${authorizationId}/void`, { method: "POST" });
  const a = await pp<{ status: string }>(`/v2/payments/authorizations/${authorizationId}`);
  return { status: a.status };
}

export async function getAuthorization(authorizationId: string): Promise<{ status: string; expiresAt?: string }> {
  const a = await pp<{ status: string; expiration_time?: string }>(`/v2/payments/authorizations/${authorizationId}`);
  return { status: a.status, expiresAt: a.expiration_time };
}
