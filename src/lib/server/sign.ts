import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Offer } from "../types";
import { toChargeable } from "./paypal";

/**
 * Offers are signed when the agent shows them, so the browser cannot tamper
 * with the price/store before checkout. Checkout re-verifies the signature.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.OFFER_SIGNING_SECRET ?? process.env.PAYPAL_CLIENT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("OFFER_SIGNING_SECRET or PAYPAL_CLIENT_SECRET must be set");
  }
  return "dalil-local-dev-secret";
}

function payload(o: Offer, exp: number): string {
  return JSON.stringify([
    o.id, o.title, o.store, o.url ?? "", o.image ?? "", o.price, o.shipping ?? 0,
    o.total, o.currency, o.trust, o.chargeAmount ?? "", o.chargeCurrency ?? "", exp,
  ]);
}

function mac(o: Offer, exp: number): string {
  return createHmac("sha256", secret()).update(payload(o, exp)).digest("base64url");
}

export function prepareOffer(o: Offer): Offer {
  const charge = toChargeable(o.total, o.currency);
  const withCharge: Offer = {
    ...o,
    chargeAmount: Number(charge.value),
    chargeCurrency: charge.currency,
    fxRate: charge.rate,
  };
  const exp = Date.now() + TTL_MS;
  return { ...withCharge, sig: `${exp}.${mac(withCharge, exp)}` };
}

export function prepareOffers(offers: Offer[]): Offer[] {
  return offers.map(prepareOffer);
}

export function verifyOffer(o: Offer): boolean {
  if (!o?.sig) return false;
  const [expStr, sig] = o.sig.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  const expected = Buffer.from(mac(o, exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
