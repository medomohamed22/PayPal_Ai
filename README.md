# Dalil — the AI shopping agent that pays with PayPal, safely

> **Dalil** ("guide") finds the best deal for a product from a **name, a link or a photo**, checks that the price is real, negotiates with the store's own agent, and **only pays with your approval through PayPal**. The money is **held first, not taken**, so you can cancel. After you buy, it keeps protecting you: price-drop refunds, price watches, one-approval multi-store carts, family approval and group buys.

**Live app:** https://paypalai-m.vercel.app · press **Demo** (or open https://paypalai-m.vercel.app/?demo=1)
**Demo video (2:53):** https://youtu.be/2jD_28eN1iY · also in the repo: [`media/dalil-demo.mp4`](media/dalil-demo.mp4)
**Built for:** PayPal AI Hackathon 2026 · **AI:** Meta Muse Spark (`muse-spark-1.3-contributor`, Meta Model API) · **Payments:** PayPal sandbox · **Market:** United States, English

---

## The problem
AI shopping agents are racing to "buy faster", but people don't trust an AI with their money: only about 4 in 10 people would let an AI buy for them. They want hard spending limits, a way to cancel, prices that weren't made up, and no sponsored bias. Dalil is built around that trust gap, with **PayPal as the safety layer**: every payment is approved by the buyer in PayPal, held before it's captured, and checked by server code the AI can't override.

## What it does
| Feature | How it works |
|---|---|
| **Real AI search** | Meta Muse Spark runs a tool-calling loop: Channel3 catalog (100M+ US products), web search, store pages, and a real headless Chromium that can open product pages and check live price and stock |
| **Signed prices** | Every offer the AI shows is HMAC-signed by the server with the price it actually saw. Checkout refuses anything changed in the browser or invented by the model |
| **Store trust + fake-deal check** | Deterministic ranking (price, Bayesian rating, store trust, distance; no sponsored results). Flags too-good-to-be-true prices and inflated "was" prices |
| **Buy now or wait?** | Verdict from price history and the sales calendar (Black Friday, 11.11…), with a one-tap price watch at the suggested target |
| **Spending mandate** | Max per purchase + verified stores only, enforced in **server code at the moment money moves**. Even if the AI proposes a purchase, an over-limit payment is refused |
| **Agent-to-agent negotiation** | Dalil's buyer agent haggles with the store's seller agent over HTTP (`/api/seller-agent`), cites cheaper competitors, and returns a newly signed lower price |
| **PayPal hold → capture** | Orders v2 `AUTHORIZE`: funds are held, a 10-minute cancel window, then capture (or void). Pay Later is offered inside PayPal |
| **Trust receipt** | After paying: why this offer, what was compared, which guarantees were enforced, and the PayPal ids |
| **Price protection (14 days)** | Dalil keeps checking the price after the purchase. If it drops, the difference is sent back automatically as a **partial PayPal refund** on the original capture. No claim, no form |
| **Price watch** | Set a target price; Dalil checks in the background (GitHub Actions every 10 min + Vercel cron) and alerts you, or auto-buys within your mandate with a vaulted PayPal wallet (Vault v3) |
| **Multi-store cart** | Items from different stores → **one PayPal order with one `purchase_unit` per store** → one approval, one capture per store. Cancel any one store within 10 minutes for a full refund of just that store |
| **Family approval** | Dalil drafts the purchase; you send a link; a parent or partner approves on **their own phone** and **pays from their own PayPal**, within a limit you set |
| **Group buy** | Split a purchase 2–6 ways with a share link. Each share is a PayPal hold; all are captured only when everyone has paid |
| **Purchases & savings** | Dashboard (AG Grid) of every purchase, negotiated savings and price-drop refunds |
| **Guided demo** | One **Demo** button runs every feature above on the live sandbox with the real AI, step by step |

## How AI and PayPal are used (tools)
- **Meta Muse Spark** (`muse-spark-1.3-contributor`) via the Meta Model API (OpenAI-compatible): the shopping agent. It plans, calls tools in parallel (catalog, web, browser, offers, approval cards, family link, watch), explains its choice, and negotiates with seller agents. The model is pinned on the server and runs on the server's key, so judges need no key.
- **PayPal developer platform (sandbox):**
  - **OAuth 2.0** client credentials
  - **Orders v2**: create with `AUTHORIZE` (`shipping_preference: GET_FROM_FILE`, `user_action: PAY_NOW`), authorize, **track** (shipment tracking)
  - **Orders v2 with several `purchase_units`** (`CAPTURE`): one order for a multi-store cart
  - **Payments v2**: capture, void, refund (full, and **partial** for price protection), capture details
  - **Vault v3**: setup tokens → payment tokens for watch auto-buy
  - `PayPal-Request-Id` idempotency on every money-moving call
- **Channel3**: US product catalog, visual search from a photo, and live price lookups for watches.
- **AG Grid**: the purchases & savings table.
- **Vercel** (Next.js hosting + cron), **Upstash Redis** (watches, protections, family and group requests), **GitHub Actions** (10-minute price checks).

## Try it as a judge
1. Open **https://paypalai-m.vercel.app** and press **Demo** (top bar or the big button on the home screen).
2. Press **Start the demo**. The tour drives the normal app with the real AI, about 5 minutes:
   1. Real AI search for Sony WH-1000XM5 · signed prices · store trust
   2. Buy now or wait?
   3. Spending mandate: a $5 limit makes the server refuse the payment
   4. Agent-to-agent negotiation
   5. **Approve with PayPal**: *you click* (browsers only open PayPal from a real click). Log in with the PayPal **sandbox** buyer shown in the panel
   6. Hold → capture → trust receipt
   7. Price protection: a simulated drop sends a real partial PayPal refund
   8. Price watch: simulated drop → "Price dropped!"
   9. Multi-store cart: two stores, *one* PayPal approval, then cancel one store (full refund)
   10. Family approval: "Mom's phone" opens next to the chat; *you click* Approve & pay as Mom
   11. Group buy link
   12. Purchases & savings
3. Or just type what you want to buy. **Settings** only holds your spending limit (max per purchase, verified stores only).

Everything runs on the PayPal **sandbox** (play money). "Simulate price drop" buttons exist only on the sandbox.

## How the money flows
**Single purchase**
```
Approve ─► POST /api/paypal/create-order   verify signature + mandate → Orders v2 (AUTHORIZE)
        ─► PayPal popup (buyer approves) ─► POST /api/paypal/authorize   funds HELD
        ─► 10-min cancel window ─► /api/paypal/capture  (or /api/paypal/void)
        ─► /api/paypal/track · /api/paypal/refund
```
**Price protection**
```
captured purchase ─► POST /api/protection   offer must match the PayPal order; amount read back from PayPal
14 days: cron / open app ─► live price below the last protected price?
   ─► Payments v2 refund {amount: difference} on the same capture ─► "Price dropped — refunded"
   (implausible drops > 50% are recorded but never auto-refunded)
```
**Multi-store cart**
```
cart (≤10 signed offers) ─► POST /api/paypal/cart   every signature + mandate on the total
   ─► Orders v2 CAPTURE, one purchase_unit per store ─► one PayPal approval
   ─► /api/paypal/cart/capture ─► one capture per store ─► cancel a store within 10 min = full refund
```
**Family approval**
```
requester: signed offer + limit ─► POST /api/family ─► share link /f/{id}
approver (own phone) ─► re-verify signature + limit; requester's device refused
   ─► PayPal approval from the approver's own account ─► hold, 10-minute window ─► capture
```
**Price watch**
```
target price + mode (notify | auto) + max total
cron / open app ─► price ≤ target?
   notify ─► push "Price dropped — buy?" ─► normal approve flow
   auto   ─► Vault order (AUTHORIZE) within mandate ─► "Bought, cancel within 10 min" ─► capture
```

## Run locally
```bash
npm install
cp .env.example .env.local   # PayPal sandbox keys, OFFER_SIGNING_SECRET, META_API_KEY (others optional)
npm run dev                   # http://localhost:3000
```

## Deploy on Vercel
1. Import the repo (production branch `main`; `vercel.json` sets the Next.js preset and the daily cron).
2. **Settings → Environment Variables**:

| Name | Required | Value |
|---|---|---|
| `PAYPAL_ENV` | yes | `sandbox` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | yes | Developer Dashboard → Apps & Credentials → Sandbox (enable **Vault** for auto-buy) |
| `OFFER_SIGNING_SECRET` | yes | `openssl rand -hex 32` |
| `META_API_KEY` | yes | Meta Model API key; the agent always runs on it with `muse-spark-1.3-contributor` |
| `HOSTED_DAILY_LIMIT` / `HOSTED_GLOBAL_DAILY_LIMIT` | | AI requests per visitor / in total per day (defaults `40` / `500`) |
| `CHANNEL3_API_KEY` | recommended | trychannel3.com → Dashboard → API (US catalog + visual search) |
| Upstash Redis | for watches | **Storage → Upstash → Redis** (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`) |
| `CRON_SECRET` | for watches | any random string |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | for push | `npx web-push generate-vapid-keys` |
| `DEMO_PAYPAL_BUYER_EMAIL` / `DEMO_PAYPAL_BUYER_PASSWORD` | for the demo | a PayPal **sandbox** personal account shown to judges in the demo panel (never shown when `PAYPAL_ENV=live`) |
| `BROWSER_WS_ENDPOINT` | | optional remote browser instead of the bundled Chromium |
| `DALIL_BROWSER` | | `off` disables the real-browser tools |

3. Redeploy and check `GET /api/paypal/status` → `{"configured": true, "env": "sandbox"}` and `GET /api/config` → `"hostedAI": true`.
4. Vercel Hobby runs the cron once a day, so `.github/workflows/price-watch.yml` calls `/api/cron` **every 10 minutes**. Add a repository secret `CRON_SECRET` (same value as in Vercel) and optionally a variable `APP_URL`.

## Testing
- [`TESTING.md`](TESTING.md): 158 scenarios, including real-model + real-PayPal-sandbox runs on the live site.
- Latest results on the live site: guided demo **12/12 steps** (real AI, 3 PayPal approvals, 0 page errors) · API + attack suite **113/113** · locally **145/145**.
- Scripts in `tests/scenarios/` (`tour.js` plays the judge through the demo; credentials only from env vars).

## Architecture
- **Next.js 15 (App Router) on Vercel**, React 19, Tailwind v4, Framer Motion, Dexie (IndexedDB)
- `src/app/api/chat`: streams the agent's events (activity, text, cards) as NDJSON
- `src/lib/server/agent.ts`: tool-calling loop over the Meta Model API; tools run in parallel
- `src/lib/server/hosted.ts`: server key, pinned model, per-visitor and global daily limits
- `src/lib/server/channel3.ts`: Channel3 catalog (search, visual search, price lookup)
- `src/lib/server/browser.ts` / `browse.ts`: real Chromium and an SSRF-safe page fetcher; page text treated as untrusted
- `src/lib/server/rank.ts`: deterministic ranking and fake-deal detection
- `src/lib/server/sign.ts`: HMAC-signed offers and order/hold/capture tokens
- `src/lib/server/paypal.ts`: PayPal REST client (Orders, Payments, Vault)
- `src/lib/server/protection.ts`, `watches.ts`, `family.ts`: price protection, watches + auto-buy, family approval
- `src/app/api/paypal/cart`: multi-store cart as one PayPal order
- `src/components/DemoTour.tsx`: the guided judge demo
- `media/`: the demo video, its captions, and the scripts that recorded and edited it
- Chats, images and settings stay on the device (IndexedDB); only watches, group buys, family requests and price protections live on the server.

## Security
- Money only moves after the buyer approves in PayPal; the mandate, signatures and order ownership are re-checked on the server every time money moves.
- The AI never sets prices it can't prove: offers are signed server-side, and store domains for catalog links come from Channel3's data, not from the model.
- Web content is data, not instructions (prompt-injection guard + deterministic server checks).
- The model key, model and market are fixed on the server; anything the browser sends for them is ignored.
- Vault payment tokens are stored server-side only, keyed by a hashed device id.

## Made during the hackathon
Dalil was built from scratch during the submission period (November 2026): the agent, PayPal hold/capture, mandate and signed offers; then negotiation, buy-now-or-wait, trust receipt, group buy and voice/barcode input; then price protection, the multi-store cart and family approval; and finally the guided judge demo, the English/US-only hosted setup and the demo video.

## License
MIT
