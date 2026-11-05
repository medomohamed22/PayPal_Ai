# Dalil — a trustworthy AI shopping agent on PayPal

> **Dalil** (دليل, "guide") finds the best deal for a product — from a **photo, a link, or a name** — across online stores *and* stores in your city, flags fake deals, and **only pays with your approval** through PayPal. Funds are **held (authorized), not captured**, so you can cancel instantly. It can also **watch prices** and notify you — or auto-buy within limits you set.

Built for the **PayPal AI Hackathon 2026** · AI: **Meta Muse Spark 1.3** (Meta Model API) · Markets: **Egypt 🇪🇬 & United States 🇺🇸** · Live: **https://paypalai-m.vercel.app**

## Why Dalil
Shopping agents (Grok, ChatGPT, Perplexity, Google, Amazon) race to "buy faster". Surveys show the real blocker is **trust**: only ~39% of people trust AI to buy for them; they want spending caps, instant cancellation, and no sponsored bias. Dalil is built around that.

| Feature | How |
|---|---|
| 🛡️ Hold, don't charge | Orders v2 `intent: AUTHORIZE` → 10-minute cancel window → capture, or one-tap **void** |
| 💰 Spending mandate | Max total + verified stores only — enforced in **server code**, not in the prompt |
| ✍️ Signed offers | HMAC-signed prices; checkout rejects anything tampered with in the browser |
| 🔍 Deal truth check | Flags too-good-to-be-true prices, inflated "was" prices, few-perfect-reviews stores |
| 📊 Transparent ranking | Deterministic score: price 50% · rating 25% (Bayesian) · trust 15% · proximity 10%; no sponsored results |
| 📍 Local & bilingual | City + GPS aware (pickup distance vs delivery), Arabic (RTL) + English |
| 🔔 Price watches | Notify-then-approve, or **auto-buy** with a vaulted PayPal wallet (Vault v3) and the same 10-minute hold |
| 📦 After the purchase | Tracking added to the PayPal order (Orders `/track`); one-tap refund for order problems |

## PayPal APIs used
- **OAuth 2.0** client credentials
- **Orders v2**: create (`AUTHORIZE`, `shipping_preference: GET_FROM_FILE`, `user_action: PAY_NOW`), authorize, **track**
- **Payments v2**: capture, void, refund
- **Vault v3**: setup tokens → payment tokens (save PayPal for auto-buy, no purchase needed), `vault_id` merchant-initiated orders

## How a purchase works
```
Approve ─► POST /api/paypal/create-order   verify signature + mandate → Orders v2 (AUTHORIZE)
        ─► PayPal popup (buyer approves) ─► /paypal/return
        ─► POST /api/paypal/authorize       funds HELD · shipping from PayPal
        ─► 10-min cancel window ─► /api/paypal/capture   (or /api/paypal/void)
        ─► /api/paypal/track · /api/paypal/refund
```

## How a price watch works
```
🔔 on a product ─► target price + mode (notify | auto) + max total
cron / open app ─► check price ─► ≤ target?
   notify ─► push "Price dropped — buy?" ─► normal approve flow
   auto   ─► Vault order (AUTHORIZE) within mandate ─► push "Bought, cancel within 10 min" ─► capture
```

## Run locally
```bash
npm install
cp .env.example .env.local   # fill in PayPal sandbox keys (others optional)
npm run dev                   # http://localhost:3000
```
Open **Settings** → paste your Meta Model API key (stored only in your browser's IndexedDB) → **Fetch models** → pick a model → **Save**. Or toggle **Demo mode** to try everything without a key.

## Deploy on Vercel
1. Import the repo (production branch `main`; `vercel.json` sets the Next.js preset and the daily cron).
2. **Settings → Environment Variables**:

| Name | Required | Value |
|---|---|---|
| `PAYPAL_ENV` | ✅ | `sandbox` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | ✅ | Developer Dashboard → Apps & Credentials → Sandbox (enable **Vault** for auto-buy) |
| `OFFER_SIGNING_SECRET` | ✅ | `openssl rand -hex 32` |
| `EGP_PER_USD` | | e.g. `50` (PayPal doesn't settle EGP) |
| Upstash Redis | for watches | **Storage → Upstash → Redis** (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`) |
| `CRON_SECRET` | for watches | any random string |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | for push | `npx web-push generate-vapid-keys` |

3. Redeploy and check `GET /api/paypal/status` → `{"configured": true, "env": "sandbox"}`.
4. Vercel Hobby runs the cron once a day. For checks every 15 minutes, create a free job at cron-job.org → `GET https://<your-app>/api/cron` with header `Authorization: Bearer <CRON_SECRET>`. While the app is open it also checks watches every 30 s.

## Testing as a judge
1. Open the app → **Settings** → enable **Demo mode** (or add a Meta Model API key).
2. Ask: `buy airpods pro 3` → **Approve with PayPal** → log in with a PayPal **sandbox personal** account → you get the 10-minute hold → **Cancel** or **Confirm now** → **Track order** / **Problem with order?**
3. Ask: `watch airpods pro 3 and tell me if it drops under 11500` → **Set up** → open 🔔 → **Simulate price drop** → **Buy now**.

## Architecture
- **Next.js 15 (App Router) on Vercel**, Tailwind v4, Framer Motion, Dexie (IndexedDB)
- `src/app/api/chat` — streams NDJSON agent events (activity, text, cards)
- `src/lib/server/agent.ts` — tool-calling loop over the Meta Model API (OpenAI-compatible); tools run in parallel
- `src/lib/server/browse.ts` — SSRF-safe page fetcher (JSON-LD / OpenGraph); page text treated as untrusted
- `src/lib/server/rank.ts` — deterministic ranking & fake-deal detection
- `src/lib/server/paypal.ts` — PayPal REST client (Orders, Payments, Vault)
- `src/lib/server/sign.ts` — HMAC-signed offers
- `src/lib/server/watches.ts` — price watches, auto-buy, cron
- Chats, images and settings stay on the device (IndexedDB); only watches live on the server.

## Security notes
- The Meta API key is kept in the browser and sent per request; it is never stored or logged on the server.
- Web content is data, not instructions (prompt-injection guard in the system prompt + deterministic server checks).
- Vault payment tokens are stored server-side only, keyed by a hashed device id.

## License
MIT
