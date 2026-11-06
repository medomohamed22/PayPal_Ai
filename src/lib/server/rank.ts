import type { Offer, TrustLevel } from "../types";

/** Stores we treat as verified for checkout in the demo markets. */
const VERIFIED: Record<string, string[]> = {
  EG: [
    "amazon.eg", "noon.com", "jumia.com.eg", "btech.com", "2b.com.eg",
    "carrefouregypt.com", "raneen.com", "select.com.eg", "elarabygroup.com", "tradelinestores.com",
    "cairosales.com", "dream2000.com", "hubstore.com.eg", "istyle.com.eg", "virginmegastore.com.eg",
    "spinneys-egypt.com", "kimostore.net", "sharafdg.com", "xcite.com", "elgendy.store",
    "dalil-demo.store",
  ],
  US: [
    "amazon.com", "walmart.com", "bestbuy.com", "target.com", "costco.com", "bhphotovideo.com",
    "newegg.com", "homedepot.com", "lowes.com", "adorama.com", "crutchfield.com", "macys.com",
    "kohls.com", "nordstrom.com", "samsclub.com", "staples.com", "officedepot.com", "gamestop.com",
    "dickssportinggoods.com", "rei.com", "wayfair.com", "ikea.com", "sephora.com", "ulta.com",
    "cvs.com", "walgreens.com", "microcenter.com", "verizon.com", "att.com", "t-mobile.com",
    "dalil-demo.store",
  ],
};

/** Official brand stores — trusted in every market. */
const BRANDS = [
  "apple", "samsung", "sony", "lg", "bose", "dell", "hp", "lenovo", "asus", "acer", "microsoft",
  "google", "xiaomi", "mi", "oppo", "realme", "huawei", "honor", "oneplus", "nokia", "motorola",
  "philips", "braun", "dyson", "jbl", "harman", "beats", "anker", "logitech", "razer", "canon",
  "nikon", "fujifilm", "gopro", "garmin", "fitbit", "nintendo", "playstation", "xbox", "nike",
  "adidas", "puma", "tefal", "moulinex", "kenwood", "delonghi", "ninja", "ninjakitchen", "instantbrands",
  "sharp", "toshiba", "panasonic", "tornado", "fresh", "zanussi", "bosch", "whirlpool", "ikea",
];

/** Domain of an official brand store whose brand appears in the product title (e.g. sony.com for "Sony WH-1000XM5"). */
function isOfficialBrand(domain: string, title: string): boolean {
  const labels = domain.split(".");
  const t = title.toLowerCase();
  return labels.some(
    (l) => l.length >= 2 && BRANDS.includes(l) && new RegExp(`(^|[^a-z])${l}([^a-z]|$)`).test(t),
  );
}

export interface RawOffer {
  title: string;
  store: string;
  url?: string;
  image?: string;
  price: number;
  currency: string;
  shipping?: number;
  listPrice?: number;
  rating?: number;
  reviewCount?: number;
  distanceKm?: number;
  pickup?: boolean;
  deliveryDays?: number;
  notes?: string;
}

function domainOf(url?: string): string | undefined {
  if (!url) return;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return;
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Deterministic, explainable ranking. The model gathers facts; the score is
 * computed here so it can't be swayed by page content or "sponsored" text.
 *   price 50% · rating 25% (Bayesian-smoothed) · trust 15% · proximity 10%
 */
export function rankOffers(raw: RawOffer[], market: string): Offer[] {
  const valid = raw.filter((r) => r && r.title && isFinite(r.price) && r.price > 0);
  if (!valid.length) return [];

  const totals = valid.map((r) => r.price + (r.shipping ?? 0));
  const med = median(totals);
  const minT = Math.min(...totals);
  const maxT = Math.max(...totals);
  const verified = VERIFIED[market] ?? [];

  const offers: Offer[] = valid.map((r, i) => {
    const total = Math.round((r.price + (r.shipping ?? 0)) * 100) / 100;
    const domain = domainOf(r.url);
    const flags: string[] = [];

    let trust: TrustLevel =
      domain && (verified.some((v) => domain === v || domain.endsWith("." + v)) || isOfficialBrand(domain, r.title))
        ? "verified"
        : "unknown";

    // Too-good-to-be-true pricing is the classic fake-store pattern.
    if (valid.length >= 3 && total < med * 0.6) {
      trust = "suspicious";
      flags.push("price_far_below_market");
    }
    // Inflated "was" price → likely fake discount.
    if (r.listPrice && r.listPrice > r.price * 1.5 && (r.reviewCount ?? 0) < 20) {
      flags.push("suspicious_discount");
    }
    if (r.rating && r.rating >= 4.9 && (r.reviewCount ?? 0) > 0 && (r.reviewCount ?? 0) < 15) {
      flags.push("few_perfect_reviews");
    }
    if (!r.url) flags.push("no_source_link");

    const priceScore = maxT === minT ? 1 : 1 - (total - minT) / (maxT - minT);
    // Bayesian average: pull ratings with few reviews toward 3.8.
    const n = r.reviewCount ?? 0;
    const bayes = r.rating ? (r.rating * n + 3.8 * 25) / (n + 25) : 3.5;
    const ratingScore = Math.max(0, Math.min(1, (bayes - 3) / 2));
    const trustScore = trust === "verified" ? 1 : trust === "unknown" ? 0.5 : 0;
    const proximity =
      r.distanceKm != null
        ? Math.max(0, 1 - r.distanceKm / 30)
        : r.deliveryDays != null
          ? Math.max(0, 1 - r.deliveryDays / 10)
          : 0.4;
    let raw01 = 0.5 * priceScore + 0.25 * ratingScore + 0.15 * trustScore + 0.1 * proximity;
    // Never let a too-good-to-be-true deal win on price alone.
    if (trust === "suspicious") raw01 *= 0.3;
    else if (flags.includes("suspicious_discount")) raw01 *= 0.7;
    const score = Math.round(raw01 * 1000) / 10;

    return {
      id: `o${i}_${Math.random().toString(36).slice(2, 7)}`,
      title: r.title,
      image: r.image,
      url: r.url,
      store: r.store,
      storeDomain: domain,
      price: r.price,
      currency: r.currency || (market === "EG" ? "EGP" : "USD"),
      shipping: r.shipping,
      total,
      rating: r.rating,
      reviewCount: r.reviewCount,
      distanceKm: r.distanceKm,
      pickup: r.pickup,
      deliveryDays: r.deliveryDays,
      trust,
      flags,
      badges: [],
      reason: r.notes,
      score,
    };
  });

  offers.sort(
    (a, b) =>
      Number(a.trust === "suspicious") - Number(b.trust === "suspicious") || (b.score ?? 0) - (a.score ?? 0),
  );
  const eligible = offers.filter((o) => o.trust !== "suspicious");
  const pool = eligible.length ? eligible : offers;

  const cheapest = [...pool].sort((a, b) => a.total - b.total)[0];
  cheapest?.badges.push("cheapest");
  const rated = pool.filter((o) => o.rating);
  const topRated = [...rated].sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
  )[0];
  topRated?.badges.push("topRated");
  pool[0]?.badges.unshift("bestValue");
  const near = pool.filter((o) => o.distanceKm != null).sort((a, b) => a.distanceKm! - b.distanceKm!)[0];
  near?.badges.push("nearest");

  return offers;
}
