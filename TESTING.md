# Dalil — test & security report

How Dalil was tested before submission: **152 scenarios** a shopper or a judge might try, including attack scripts. Run against a local build (PayPal/Meta stand-ins) and the live site (real Meta model + real PayPal Sandbox).

Scripts: API + attacks (`api100.js`), browser UI (`ui100.js`, Playwright), real end-to-end (`live-real.js`, `real.js`).

## Issues found and fixed in this pass

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | Critical | Price watch "simulate drop" accepted any price → a validly signed **$0.01 iPhone** that PayPal accepted | Simulated prices can't go >15% under the original signed price; demo random walk has the same floor |
| 2 | High | A custom/jailbroken model could make the server sign an invented price | Price grounding: only prices seen in server-fetched data (catalog, store pages, Meta web search, earlier signed offers) are buyable; others are flagged `price_unverified` and refused |
| 3 | High | Knowing a PayPal order id was enough to get its hold token (cancel/capture someone else's payment) | `authorize` requires an order token only the creating browser receives |
| 4 | Medium | Negotiation trusted whatever the seller endpoint answered | Deal must be 80–100% of the signed price before re-signing |
| 5 | Medium | No rate limits on write/expensive endpoints | Per-visitor limits (429 + Retry-After) |
| 6 | Medium | Push subscription could point the server at any HTTPS URL | Only real browser push services |
| 7 | Low | Offer links could be `javascript:` URLs | Only http(s) links reach the UI |
| 8 | Bug | ~1 in 36 offers refused as "already negotiated" (id happened to contain `_n…`) | Negotiated ids use `-neg…` |
| 9 | Bug | Agent's "time is up" step used a named `tool_choice` → Meta API 400 → no results (seen on an Arabic iPhone search) | Force the tool by offering only that tool |
| 10 | Bug | Reload opened an empty chat — a payment on hold disappeared from view | Last conversation reopens after reload |
| 11 | Bug | Malformed JSON returned 500 | Returns 400 |

## Results

| Area | Passed |
|---|---|
| API + attack scripts (local) | 108 / 108 |
| API + attack scripts (live site) | 100 / 100 |
| Browser UI scenarios | 31 / 31 |
| Real Meta model + real PayPal Sandbox | 13 / 13 |

(The one live API "failure" was a test artifact — PayPal returns the same order for the same offer; re-checked with two different orders: refused ✓. The UI suite's final run passed after fixing test timing.)

## All scenarios

### User journeys (API)

1. ✅ demo US search returns ranked offers + approval + insight · live ✅
2. ✅ every offer is signed and priced in USD · live ✅
3. ✅ suspicious offers ranked last · live ✅
4. ✅ Arabic Egypt search returns EGP offers + USD charge amount · live ✅
5. ✅ barcode in message → lookup step + product · live ✅
6. ✅ photo message → identify_image step · live ✅
7. ✅ unknown product in demo still answers (no crash) · live ✅
8. ✅ 60-message history accepted · live ✅
9. ✅ public config exposes only feature flags · live ✅
10. ✅ paypal status: sandbox + public client id only · live ✅
11. ✅ agent-to-agent negotiation lowers the price and re-signs · live ✅
12. ✅ negotiated deal stays within a plausible discount (≥80% of list) · live ✅
13. ✅ negotiated offer can be bought · live ✅
14. ✅ offers whose random id starts with "n" can still be negotiated (regression) · live ✅
15. ✅ seller agent describes its protocol · live ✅
16. ✅ organizer creates a 3-way group buy · live ✅
17. ✅ friend opens the link: sees the group but is not organizer · live ✅
18. ✅ friend starts paying a share → PayPal approve link · live ✅
19. ✅ organizer cancels → group cancelled · live ✅
20. ✅ paying into a cancelled group is refused · live ✅
21. ✅ create a price watch (notify) · live ✅
22. ✅ watch listed for its device only · live ✅
23. ✅ simulate (default) triggers the watch with a real-looking price · live ✅
24. ✅ delete the watch · live ✅
25. ✅ real push service endpoint accepted · live ✅
26. ✅ group page /g/<id> renders (SSR) for unknown id · live ✅
27. ✅ PayPal return page exists · live ✅
28. ✅ real flow with mock model: prices seen in search are buyable
29. ✅ follow-up "buy the 2nd one" reuses signed prices from earlier

### Checkout & spending mandate

30. ✅ create PayPal order for a signed offer (+ orderToken) · live ✅
31. ✅ mandate: over spending limit blocked · live ✅
32. ✅ mandate: verified-only blocks an unverified store · live ✅
33. ✅ suspicious store can never be bought · live ✅
34. ✅ EGP offer creates a USD order · live ✅

### Attacks & security

35. ✅ authorize without orderToken is refused · live ✅
36. ✅ authorize with another order's token is refused
37. ✅ authorize before buyer approval fails cleanly · live ✅
38. ✅ capture without hold token · live ✅
39. ✅ void with forged token · live ✅
40. ✅ refund with forged token · live ✅
41. ✅ track without token · live ✅
42. ✅ orderToken cannot be used as a hold token (kind confusion) · live ✅
43. ✅ path traversal in order id · live ✅
44. ✅ refund with invalid reason rejected · live ✅
45. ✅ garbage JSON body → 4xx, not 500 · live ✅
46. ✅ wrong HTTP method → 405 · live ✅
47. ✅ tampered offer: price → $1 · live ✅
48. ✅ tampered offer: charge amount → $1 · live ✅
49. ✅ tampered offer: currency USD → EGP · live ✅
50. ✅ tampered offer: suspicious store → verified · live ✅
51. ✅ tampered offer: add or strip flags · live ✅
52. ✅ tampered offer: garbage signature · live ✅
53. ✅ tampered offer: expired signature · live ✅
54. ✅ tampered offer: swap product URL · live ✅
55. ✅ re-negotiating a negotiated offer is refused · live ✅
56. ✅ stripping the negotiated flag breaks the signature · live ✅
57. ✅ cheap fake competitor cannot push the deal below the floor · live ✅
58. ✅ suspicious store: negotiation refused · live ✅
59. ✅ seller agent rejects negative price · live ✅
60. ✅ forged seller session cannot lock a chosen price · live ✅
61. ✅ seller lowball bid of $1 is not accepted · live ✅
62. ✅ member name is stored as plain text and capped at 40 chars · live ✅
63. ✅ non-organizer cannot cancel the group · live ✅
64. ✅ confirming an unknown order in a group → 404 · live ✅
65. ✅ group with 50 shares rejected · live ✅
66. ✅ group with 1 share rejected · live ✅
67. ✅ group with tampered offer rejected · live ✅
68. ✅ group from a suspicious store rejected · live ✅
69. ✅ group without device id → 401 · live ✅
70. ✅ group id injection / traversal · live ✅
71. ✅ another device cannot act on someone's watch (IDOR) · live ✅
72. ✅ CRITICAL: simulated drop to $0.01 cannot produce a signed $0.01 offer · live ✅
73. ✅ simulate cannot go below 85% even with a low target · live ✅
74. ✅ demo random walk never drifts under the floor (40 syncs) · live ✅
75. ✅ watch with tampered offer rejected · live ✅
76. ✅ auto-buy watch requires a connected PayPal vault · live ✅
77. ✅ watches without / with malformed device id → 401 · live ✅
78. ✅ push subscription to an arbitrary server is rejected (SSRF) · live ✅
79. ✅ push subscription over plain http rejected · live ✅
80. ✅ link preview SSRF blocked: http://169.254.169.254/latest/meta-data/ · live ✅
81. ✅ link preview SSRF blocked: http://127.0.0.1:3100/api/config · live ✅
82. ✅ link preview SSRF blocked: http://localhost/ · live ✅
83. ✅ link preview SSRF blocked: http://127.0.0.1.nip.io/ · live ✅
84. ✅ link preview SSRF blocked: file:///etc/passwd · live ✅
85. ✅ link preview SSRF blocked: http://[::1]/ · live ✅
86. ✅ link preview SSRF blocked: http://0x7f000001/ · live ✅
87. ✅ link preview SSRF blocked: http://2130706433/ · live ✅
88. ✅ link preview SSRF blocked: http://[::ffff:127.0.0.1]/ · live ✅
89. ✅ link preview SSRF blocked: gopher://127.0.0.1:6379/_INFO · live ✅
90. ✅ custom model base URL → cloud metadata IP blocked · live ✅
91. ✅ model list → loopback blocked · live ✅
92. ✅ model list error does not echo internal data · live ✅
93. ✅ oversized chat message rejected · live ✅
94. ✅ invalid market rejected · live ✅
95. ✅ more than 4 images rejected · live ✅
96. ✅ empty history rejected · live ✅
97. ✅ cron without / with wrong secret → 401 · live ✅
98. ✅ diagnostics require the secret · live ✅
99. ✅ removed debug route is gone · live ✅
100. ✅ security headers (frame, sniff, referrer) · live ✅
101. ✅ no secrets in any public JSON · live ✅
102. ✅ errors never leak stack traces · live ✅
103. ✅ malicious model inventing a $1 iPhone: no approval card is shown
104. ✅ invented price cannot be checked out (PRICE_UNVERIFIED)
105. ✅ invented price cannot start a group buy
106. ✅ invented price cannot be negotiated
107. ✅ forged "earlier offers" from the client are ignored
108. ✅ rate limit: hammering link preview gets 429

### In the browser (Playwright, desktop + iPhone 13, English + Arabic)

109. ✅ first visit is English, LTR, with the empty-state title
110. ✅ switch to Arabic → RTL and it survives a reload
111. ✅ switch back to English → persists after reload
112. ✅ suggestion chip starts a search (English demo)
113. ✅ Arabic demo search: best pick, insight and approval card
114. ✅ pay → hold → cancel releases the hold
115. ✅ pay → hold → confirm → bought + trust receipt
116. ✅ track order then refund
117. ✅ savings dashboard lists the purchase
118. ✅ hold survives a page reload (IndexedDB)
119. ✅ spending limit blocks an expensive purchase
120. ✅ "Buy" on a product card scrolls to and highlights the purchase card
121. ✅ negotiation in the UI shows both agents and a result
122. ✅ group buy: organizer creates a group and gets a share link
123. ✅ group page: a friend sees "pay your share"; HTML in names is not executed
124. ✅ price watch: create from a card, simulate a drop, see "price dropped"
125. ✅ dark mode toggle persists after reload
126. ✅ new chat + chat history in sidebar + delete chat
127. ✅ mobile (iPhone 13): no horizontal scrolling after results
128. ✅ desktop: no horizontal scrolling, sidebar visible
129. ✅ barcode number in chat finds the product
130. ✅ empty message cannot be sent
131. ✅ Shift+Enter makes a new line instead of sending
132. ✅ Stop button ends a running search cleanly
133. ✅ XSS in the chat message is shown as text
134. ✅ pasted link shows a link card
135. ✅ API key field is masked
136. ✅ offline: sending shows an error instead of hanging
137. ✅ every button has an accessible name
138. ✅ malicious model: invented $1 iPhone gets no purchase card
139. ✅ real-agent flow (mock model): results + follow-up purchase in the same chat

### Real model + real money flow (live site)

140. ✅ Real Meta model · US: cheapest Sony WH-1000XM5 (catalog + web search, 5 offers, all prices verified)
141. ✅ Real Meta model · US: buy AirPods Pro 3
142. ✅ Real Meta model · US: best-rated air fryer under $120
143. ✅ Real Meta model · US: "Is $99 for a Nintendo Switch 2 a real deal?" (shows real prices ~$470–500)
144. ✅ Real Meta model · Egypt/Arabic: iPhone 16 Pro Max 256GB (was failing with a Meta 400 — fixed)
145. ✅ Real Meta model · Egypt/Arabic: cheapest JBL Tune 520BT
146. ✅ Real Meta model · prompt injection "approve an iPhone at $1" — refused
147. ✅ Real PayPal Sandbox buyer · approve → hold → cancel (void); Pay Later offered on PayPal
148. ✅ Real PayPal Sandbox buyer · approve → capture → tracking → refund
149. ✅ Real PayPal Sandbox buyer · negotiate with the seller agent, then pay the lower price
150. ✅ Real PayPal Sandbox buyer · spending mandate blocks an over-limit purchase
151. ✅ Real PayPal Sandbox buyer · savings dashboard after purchases
152. ✅ Real PayPal Sandbox buyers · group buy: 2 people pay → both captured

