# Dalil — a trustworthy AI shopping agent on PayPal

> **Dalil** (دليل, "guide") finds the best deal for a product — from a **photo, a link, or a name** — across online stores *and* stores in your city, flags fake deals, and **only pays with your approval** through PayPal. Funds are **held (authorized), not captured**, so you can cancel instantly.

Built for the **PayPal AI Hackathon 2026**. AI: **Meta Muse Spark 1.3** via the Meta Model API. Markets: **Egypt 🇪🇬 & United States 🇺🇸**.

## Why Dalil
Shopping agents (Grok, ChatGPT, Perplexity, Google, Amazon) race to "buy faster". Surveys show the real blocker is **trust**: only ~39% of people trust AI to buy for them; they want spending caps, instant cancellation, and no sponsored bias. Dalil is built around that:

| Feature | How |
|---|---|
| 🛡️ Hold, don't charge | PayPal Orders `intent: AUTHORIZE` → capture only after confirmation, one-tap **void** |
| 💰 Spending mandate | Max price / trusted stores only — enforced in server code, not in the prompt |
| 🔍 Deal truth check | Flags too-good-to-be-true prices, inflated "was" prices, few-perfect-reviews |
| 📊 Transparent ranking | Deterministic score: price 50% · rating 25% (Bayesian) · trust 15% · proximity 10%; no sponsored results |
| 📍 Local & bilingual | City-aware (pickup distance vs. delivery), Arabic (RTL) + English |
| 🔁 Price watch & auto-buy | Notify-then-approve, or auto-buy within mandate with a 10-minute cancel window |

## Status
- [x] Chat UI (black & white, animated, responsive), settings (API key, fetch models, save), IndexedDB storage
- [x] Agent loop with Muse Spark: `web_search` (Meta built-in), `browse_url` (our SSRF-safe extractor), `show_offers`, `request_purchase_approval`
- [x] Transparent ranking + fake-deal flags, product & link cards, approval box
- [x] Demo mode (no API key needed)
- [x] PayPal sandbox checkout: Orders v2 `AUTHORIZE` → 10-minute hold with live countdown → auto **capture**, or one-tap **void**
- [x] Shipping address pulled from the buyer's PayPal account (`shipping_preference: GET_FROM_FILE`)
- [x] Signed offers (HMAC) — tampered prices are rejected; spending mandate (max total, verified stores only) enforced server-side
- [x] EGP prices charged in USD at a disclosed rate (PayPal doesn't settle EGP)
- [ ] Price watches (Upstash Redis + cron), PayPal Vault auto-buy, Web Push
- [ ] Shipment tracking & dispute assistant

## Run locally
```bash
npm install
cp .env.example .env.local   # fill in PayPal sandbox + optional keys
npm run dev                   # http://localhost:3000
```
Open **Settings** → paste your Meta Model API key (stored only in your browser's IndexedDB) → **Fetch models** → pick a model → **Save**. Or toggle **Demo mode** to try it without a key.

## Checkout flow
```
Approve ─► POST /api/paypal/create-order   (verify signature + mandate → Orders v2, intent=AUTHORIZE)
        ─► PayPal popup (buyer approves) ─► /paypal/return
        ─► POST /api/paypal/authorize       (funds HELD, shipping from PayPal)
        ─► 10-min cancel window ─► POST /api/paypal/capture   (or /api/paypal/void to release)
```

## Architecture
- **Next.js 15 (App Router) on Vercel**, Tailwind v4, Framer Motion
- `src/app/api/chat` — streams NDJSON agent events (steps, text, cards)
- `src/lib/server/agent.ts` — tool-calling loop over the Meta Model API (OpenAI-compatible)
- `src/lib/server/browse.ts` — fetches product pages (JSON-LD / OpenGraph), page text treated as untrusted
- `src/lib/server/rank.ts` — deterministic ranking & fake-deal detection
- `src/lib/server/paypal.ts` — PayPal REST client (OAuth, Orders v2, authorize / capture / void, Vault)
- `src/lib/server/sign.ts` — HMAC-signed offers so checkout can't be tampered with
- `src/lib/db.ts` — Dexie/IndexedDB: chats, images, settings stay on the device

## License
MIT
