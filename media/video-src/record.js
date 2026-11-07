// Records Dalil on the live site like a human: visible cursor, natural mouse paths, real typing.
// Frames come from the CDP screencast of every page (main tab, PayPal popups, Mom's phone).
// Output: rec/<stream>/<n>.jpg + rec/<stream>.json (timestamps) + rec/events.json (scene/zoom/speed markers).
// PP_USER / PP_PASS come from env only.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'https://paypalai-m.vercel.app';
const OUT = path.join(__dirname, process.env.OUT || 'rec');
const QUERY = 'Find the best price for Sony WH-1000XM5 wireless headphones';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const now = () => Date.now() / 1000;
const T0 = now();
const events = [];
let curMode = 'normal';
const ev = (type, data = {}) => {
  if (type === 'fast' || type === 'normal') {
    if (curMode === type) return;
    curMode = type;
  }
  events.push({ t: now(), type, ...data });
  console.log(`[${(now() - T0).toFixed(1)}s] ${type}`, Object.keys(data).length ? JSON.stringify(data) : '');
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 1));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

/* ---------------- cursor overlay + privacy blur (runs in every page) ---------------- */
function overlay({ email }) {
  const touch = !!window.__touch;
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = `
      #__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform;transition:none}
      #__cur svg{display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      #__cur.touch{width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(10,10,10,.28);border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.25)}
      .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid rgba(10,10,10,.55);background:rgba(10,10,10,.08);animation:__rip .55s ease-out forwards}
      @keyframes __rip{to{transform:scale(4.2);opacity:0}}
      ${location.hostname.includes('paypal') ? 'input[type=email],input[type=password],input[name=login_email],input[name=login_password],#email,#password,.__pii{filter:blur(7px)!important}' : ''}
    `;
    document.documentElement.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cur';
    if (touch) c.className = 'touch';
    else
      c.innerHTML =
        '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L8.6 18.8 L12.6 27.4 L16.4 25.7 L12.5 17.3 L20.2 17.3 Z" fill="#0a0a0a" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    let p = { x: -100, y: -100 };
    try {
      p = JSON.parse(sessionStorage.getItem('__cur') || 'null') || p;
    } catch {}
    const put = (x, y) => {
      c.style.transform = `translate(${x}px,${y}px)`;
      try {
        sessionStorage.setItem('__cur', JSON.stringify({ x, y }));
      } catch {}
    };
    put(p.x, p.y);
    addEventListener('mousemove', (e) => put(e.clientX, e.clientY), true);
    addEventListener(
      'mousedown',
      (e) => {
        const r = document.createElement('div');
        r.className = '__rip';
        r.style.left = e.clientX + 'px';
        r.style.top = e.clientY + 'px';
        document.documentElement.appendChild(r);
        setTimeout(() => r.remove(), 700);
        if (touch) c.style.background = 'rgba(10,10,10,.5)';
      },
      true,
    );
    addEventListener('mouseup', () => touch && (c.style.background = 'rgba(10,10,10,.28)'), true);
    if (location.hostname.includes('paypal') && email) {
      const scan = () => {
        const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) if (n.nodeValue && n.nodeValue.includes(email) && n.parentElement) n.parentElement.classList.add('__pii');
      };
      new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      scan();
    }
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mk);
  else mk();
}

/* ---------------- screencast per page ---------------- */
const streams = {};
async function capture(ctx, page, name) {
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  const s = (streams[name] = { frames: [], cdp: await ctx.newCDPSession(page) });
  const vp = page.viewportSize();
  s.cdp.on('Page.screencastFrame', (f) => {
    const i = s.frames.length;
    fs.writeFileSync(path.join(dir, `${i}.jpg`), Buffer.from(f.data, 'base64'));
    s.frames.push(f.metadata.timestamp);
    s.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await s.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
  const flush = () => fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ size: vp, frames: s.frames }));
  s.flush = flush;
  // keep the frame list on disk as we go
  s.timer = setInterval(flush, 2000);
  page.on('close', () => {
    flush();
    clearInterval(s.timer);
  });
  return s;
}

/* ---------------- human input ---------------- */
const pos = new WeakMap();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function moveTo(page, x, y, speed = 1) {
  const p = pos.get(page) || { x: page.viewportSize().width * 0.55, y: page.viewportSize().height * 0.6 };
  const dx = x - p.x, dy = y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  const dur = Math.min(1150, 260 + dist * 0.55) / speed;
  const steps = Math.max(8, Math.round(dur / 14));
  // curved path: control points pushed off the straight line
  const nx = -dy / (dist || 1), ny = dx / (dist || 1);
  const bend = rnd(-0.18, 0.18) * dist;
  const c1 = { x: p.x + dx * 0.3 + nx * bend, y: p.y + dy * 0.3 + ny * bend };
  const c2 = { x: p.x + dx * 0.75 + nx * bend * 0.5, y: p.y + dy * 0.75 + ny * bend * 0.5 };
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps), u = 1 - t;
    const bx = u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * x;
    const by = u * u * u * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * y;
    await page.mouse.move(bx, by);
    await sleep(dur / steps);
  }
  pos.set(page, { x, y });
}
async function box(loc) {
  await loc.waitFor({ state: 'visible', timeout: 60000 });
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}
/** Wheel-scroll (like a person) until the element is comfortably in view. */
async function scrollTo(page, loc, where = 0.45) {
  const vh = page.viewportSize().height;
  for (let i = 0; i < 80; i++) {
    const b = await box(loc);
    const target = vh * where - b.height / 2;
    const diff = b.y - Math.max(70, target);
    if (Math.abs(diff) < 40 || (b.y > 70 && b.y + b.height < vh - 120 && Math.abs(diff) < 220)) return b;
    // the wheel scrolls whatever is under the cursor: keep it over the chat/page body
    const p = pos.get(page);
    const W = page.viewportSize().width;
    const inBody = p && (W < 600 ? p.y > 60 && p.y < vh - 90 : p.x > 300 && p.x < W - 40 && p.y > 70 && p.y < vh - 130);
    if (!inBody) await moveTo(page, W < 600 ? W * 0.6 : Math.min(W - 80, b.x + b.width + 120), vh * rnd(0.45, 0.6));
    await page.mouse.wheel(0, Math.max(-140, Math.min(140, diff)));
    await sleep(28);
  }
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  return box(loc);
}
async function click(page, loc, { scroll = true, pause = 220 } = {}) {
  let b = scroll ? await scrollTo(page, loc) : await box(loc);
  // wait for layout to settle (new cards, auto-scroll, animations)
  const stable = async () => {
    let prev = await box(loc);
    for (let i = 0; i < 25; i++) {
      await sleep(140);
      const cur = await box(loc);
      if (Math.abs(cur.x - prev.x) < 1 && Math.abs(cur.y - prev.y) < 1 && Math.abs(cur.height - prev.height) < 1) return cur;
      prev = cur;
    }
    return prev;
  };
  b = await stable();
  const x = b.x + b.width / 2 + rnd(-Math.min(8, b.width / 5), Math.min(8, b.width / 5));
  const y = b.y + b.height / 2 + rnd(-Math.min(4, b.height / 5), Math.min(4, b.height / 5));
  await moveTo(page, x, y);
  await sleep(pause + rnd(0, 140));
  // if it moved while the cursor travelled, follow it
  for (let i = 0; i < 4; i++) {
    const nb = await stable();
    const p = pos.get(page);
    if (p.x >= nb.x + 2 && p.x <= nb.x + nb.width - 2 && p.y >= nb.y + 2 && p.y <= nb.y + nb.height - 2) break;
    await moveTo(page, nb.x + nb.width / 2, nb.y + nb.height / 2, 1.6);
    await sleep(150);
  }
  await page.mouse.down();
  await sleep(rnd(60, 110));
  await page.mouse.up();
}
async function typeText(page, text, min = 45, max = 115) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(rnd(min, max) + (ch === ' ' ? rnd(10, 60) : 0));
  }
}
async function hover(page, loc, ms = 600) {
  const b = await box(loc);
  await moveTo(page, b.x + b.width * rnd(0.35, 0.65), b.y + b.height * rnd(0.35, 0.65));
  await sleep(ms);
}
async function zoom(stream, loc, opts = {}) {
  const b = await box(loc);
  ev('zoom', { stream, x: b.x, y: b.y, w: b.width, h: b.height, max: opts.max || 1.6, pad: opts.pad ?? 40 });
}
const unzoom = (stream) => ev('unzoom', { stream });
async function until(fn, ms, what) {
  const t = Date.now();
  const wasNormal = curMode === 'normal';
  for (;;) {
    try {
      const v = await fn();
      if (v) {
        // a visible wait for the server: speed it up in the edit
        if (wasNormal && curMode === 'normal' && Date.now() - t > 1300) {
          events.push({ t: t / 1000 + 0.45, type: 'fast', auto: true }, { t: now() - 0.15, type: 'normal', auto: true });
          events.sort((a, b) => a.t - b.t);
        }
        return v;
      }
    } catch {}
    if (Date.now() - t > ms) throw new Error('Timed out: ' + what);
    await sleep(400);
  }
}

/* ---------------- PayPal (human) ---------------- */
async function paypal(pp, name, quick) {
  await pp.waitForLoadState('domcontentloaded').catch(() => {});
  const email = pp.locator('#email, input[name=login_email]').first();
  const pw = pp.locator('#password, input[name=login_password]').first();
  const payBtn = pp
    .locator('#payment-submit-btn, button[data-testid=submit-button-initial], button:has-text("Complete Purchase"), button:has-text("Continue to Review Order"), button:has-text("Pay Now"), button:has-text("Agree & Continue")')
    .first();
  const first = await Promise.race([
    email.waitFor({ timeout: 60000 }).then(() => 'email'),
    pw.waitFor({ timeout: 60000 }).then(() => 'password'),
    payBtn.waitFor({ timeout: 60000 }).then(() => 'pay'),
  ]).catch(() => 'none');
  if (!quick) ev('normal');
  await sleep(700);
  if (first === 'email' || first === 'password') {
    if (first === 'email') {
      await click(pp, email, { scroll: false });
      await pp.keyboard.press('Control+A');
      await typeText(pp, process.env.PP_USER, 25, 60);
      await sleep(300);
      const next = pp.locator('#btnNext');
      if (await next.isVisible().catch(() => false)) {
        await click(pp, next, { scroll: false });
        ev('fast');
      }
    }
    await pw.waitFor({ state: 'visible', timeout: 30000 });
    if (!quick) ev('normal');
    await sleep(400);
    await click(pp, pw, { scroll: false });
    await typeText(pp, process.env.PP_PASS, 40, 90);
    await sleep(250);
    const login = pp.getByRole('button', { name: /^(Log In|Login)$/ });
    await click(pp, login, { scroll: false });
    ev('fast');
  }
  const got = await Promise.race([
    payBtn.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'pay'),
    pp.waitForURL(/genericError/, { timeout: 90000 }).then(() => 'err'),
  ]);
  if (got === 'err') throw new Error('PP_RETRY');
  await sleep(1200);
  ev('normal');
  await sleep(1300);
  ev('zoomwide', { stream: name });
  await click(pp, payBtn);
  ev('fast');
  await pp.waitForEvent('close', { timeout: 90000 }).catch(() => console.log('popup did not close'));
}

/** Clicks something that opens PayPal (popup), records it as `name`, approves. */
async function viaPayPal(ctx, page, loc, name, quick) {
  for (let attempt = 0; ; attempt++) {
    const sname = attempt ? `${name}_r${attempt}` : name;
    const popP = ctx.waitForEvent('page', { timeout: 30000 });
    await click(page, loc);
    const pp = await popP;
    await capture(ctx, pp, sname);
    ev('fast');
    ev('show', { stream: sname });
    try {
      await paypal(pp, sname, quick);
      if (attempt) ev('unhide');
      break;
    } catch (e) {
      if (e.message !== 'PP_RETRY' || attempt >= 3) throw e;
      // PayPal sandbox hiccup: cut it from the video and try again
      console.log('PayPal sandbox error page, retrying');
      if (!attempt) ev('hide');
      ev('show', { stream: streamOf.get(page) });
      await pp.close().catch(() => {});
      await sleep(3000);
      const again = page.getByRole('button', { name: /^Try again$/ }).last();
      if (await again.isVisible().catch(() => false)) {
        await click(page, again);
        await sleep(2000);
      }
    }
  }
  ev('show', { stream: streamOf.get(page) });
}
const streamOf = new WeakMap();

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await ctx.addInitScript(overlay, { email: process.env.PP_USER || '' });
  const page = await ctx.newPage();
  streamOf.set(page, 'main');
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await sleep(1500);
  await capture(ctx, page, 'main');
  ev('show', { stream: 'main' });
  pos.set(page, { x: 1250, y: 760 });
  await page.mouse.move(1250, 760);
  const main = page.locator('main');
  const btn = (re, root = page) => root.getByRole('button', { name: re });
  const approval = () => page.locator('[data-approval-card]').last();
  const verified = () => page.locator('[data-offer-card][data-trust="verified"]');

  try {
    /* 01 intro: a calm look at the home screen */
    ev('scene', { name: '01_intro' });
    await sleep(1200);
    await moveTo(page, 820, 420);
    await sleep(900);
    await hover(page, page.getByRole('button', { name: 'Run the guided demo' }).last(), 700);
    await moveTo(page, 900, 600);
    await sleep(1500);

    /* 02 search */
    ev('scene', { name: '02_search' });
    const ta = page.locator('textarea');
    await click(page, ta, { scroll: false });
    await zoom('main', ta, { max: 1.5, pad: 160 });
    await sleep(300);
    await typeText(page, QUERY);
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(2500);
    unzoom('main');
    ev('fast');
    await until(async () => (await verified().count()) >= 2 && !(await btn(/^Stop$/i).count()), 300000, 'AI results');
    await sleep(1500);
    ev('normal');
    const firstCard = page.locator('[data-offer-card]').first();
    await scrollTo(page, firstCard, 0.35);
    await sleep(500);
    const grid = firstCard.locator('xpath=..');
    await zoom('main', grid, { max: 1.45, pad: 30 });
    await hover(page, firstCard, 1200);
    await hover(page, page.locator('[data-offer-card]').nth(1), 1000);
    if ((await page.locator('[data-offer-card]').count()) > 2) await hover(page, page.locator('[data-offer-card]').nth(2), 900);
    await sleep(800);
    const insight = page.getByText(/^Buy now or wait\?/i).last();
    if (await insight.count()) {
      const ib = insight.locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
      await scrollTo(page, ib, 0.5);
      await zoom('main', ib, { max: 1.6, pad: 40 });
      await hover(page, ib, 2600);
    }
    await sleep(800);
    unzoom('main');

    /* 03 mandate */
    ev('scene', { name: '03_mandate' });
    await click(page, page.getByRole('button', { name: 'Settings', exact: true }).last(), { scroll: false });
    await sleep(900);
    const sheet = page.getByRole('dialog', { name: 'Settings', exact: true });
    await zoom('main', sheet, { max: 1.5, pad: 20 });
    const max = page.locator('#max-spend');
    await click(page, max, { scroll: false });
    await page.keyboard.press('Control+A');
    await typeText(page, '5', 120, 160);
    await sleep(700);
    await click(page, btn(/^Save$/, sheet), { scroll: false });
    await sleep(1200);
    unzoom('main');
    const v0 = verified().first();
    await scrollTo(page, v0, 0.45);
    await sleep(300);
    await click(page, btn(/^Buy$/, v0));
    await until(async () => (await approval().count()) && (await btn(/^Approve with PayPal$/, approval()).count()), 60000, 'purchase card');
    await sleep(900);
    const card1 = approval();
    await scrollTo(page, card1, 0.45);
    await zoom('main', card1, { max: 1.5 });
    // Approving above the mandate: the server refuses (a popup may flash and close)
    const pop = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
    await click(page, btn(/^Approve with PayPal$/, card1));
    await until(async () => /Blocked by your mandate/.test(await card1.innerText()), 60000, 'mandate block');
    (await pop)?.close().catch(() => {});
    await sleep(600);
    await hover(page, card1.getByText(/Blocked by your mandate/).first(), 2600);
    unzoom('main');
    // restore the limit (cut from the video)
    ev('hide');
    await page.locator('[role=dialog]').count();
    await click(page, page.getByRole('button', { name: 'Settings', exact: true }).last(), { scroll: false });
    await sleep(700);
    await click(page, btn(/^No limit$/, sheet), { scroll: false });
    await click(page, btn(/^Save$/, sheet), { scroll: false });
    await sleep(1200);
    const retry = btn(/^Try again$/, card1);
    if (await retry.count()) await click(page, retry);
    await until(async () => btn(/^Approve with PayPal$/, approval()).count(), 30000, 'card back');
    await sleep(600);
    ev('unhide');

    /* 04 negotiation */
    ev('scene', { name: '04_negotiation' });
    const card2 = approval();
    await scrollTo(page, card2, 0.45);
    await zoom('main', card2, { max: 1.45 });
    await click(page, btn(/negotiate a better price/i, card2));
    await sleep(1200);
    ev('fast');
    await until(async () => /You saved|No better price|original stands/i.test(await main.innerText()), 150000, 'negotiation');
    await sleep(1000);
    ev('normal');
    const card3 = await until(async () => {
      const c = approval();
      return (await btn(/^Approve with PayPal$/, c).count()) ? c : null;
    }, 30000, 'negotiated card');
    await scrollTo(page, card3, 0.5);
    await zoom('main', card3, { max: 1.45 });
    const saved = page.getByText(/You saved/i).last();
    if (await saved.count()) await hover(page, saved, 2200);
    else await sleep(2200);

    /* 05 PayPal approve → hold → capture → trust receipt */
    ev('scene', { name: '05_paypal' });
    await viaPayPal(ctx, page, btn(/^Approve with PayPal$/, card3), 'pp1');
    await until(async () => btn(/^Confirm now$/, approval()).count(), 90000, 'hold');
    ev('normal');
    const card4 = approval();
    await scrollTo(page, card4, 0.5);
    await zoom('main', card4, { max: 1.45 });
    await sleep(2200);
    await click(page, btn(/^Confirm now$/, card4));
    ev('fast');
    await until(async () => /Trust receipt/i.test(await card4.innerText()), 90000, 'capture');
    await sleep(800);
    ev('normal');
    const rec = card4.getByText(/Trust receipt/i).first();
    await scrollTo(page, rec, 0.35);
    await zoom('main', card4, { max: 1.4 });
    await hover(page, rec, 1500);
    await page.mouse.wheel(0, 160);
    await sleep(1800);

    /* 06 price protection */
    ev('scene', { name: '06_protection' });
    const sim = btn(/Simulate price drop/i, card4);
    await until(() => sim.count(), 60000, 'price protection');
    await scrollTo(page, sim, 0.5);
    await zoom('main', sim.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), { max: 1.6 });
    await click(page, sim);
    ev('fast');
    await until(async () => /refunded/i.test(await card4.innerText()), 90000, 'refund');
    await sleep(700);
    ev('normal');
    const refunded = card4.getByText(/refunded/i).last();
    await scrollTo(page, refunded, 0.5);
    await zoom('main', refunded.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), { max: 1.6 });
    await hover(page, refunded, 2600);
    unzoom('main');

    /* 07 price watch */
    ev('scene', { name: '07_watch' });
    const oc = page.locator('[data-offer-card]').nth(1);
    await scrollTo(page, oc, 0.45);
    await click(page, btn(/^Watch price$/, oc));
    const startW = btn(/^Start watching$/);
    await until(() => startW.count(), 15000, 'watch form');
    await sleep(500);
    await zoom('main', startW.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), { max: 1.5 });
    await sleep(900);
    await click(page, startW.last(), { scroll: false });
    await sleep(1200);
    unzoom('main');
    await click(page, page.getByRole('button', { name: 'Price watches', exact: true }).first(), { scroll: false });
    await sleep(900);
    const panel = page.getByRole('dialog', { name: 'Price watches', exact: true });
    const simW = btn(/^Simulate price drop$/, panel).first();
    await until(() => simW.count(), 15000, 'watch panel');
    await zoom('main', panel, { max: 1.4, pad: 10 });
    await click(page, simW, { scroll: false });
    await until(async () => /Price dropped!/.test(await page.locator('body').innerText()), 45000, 'price drop alert');
    await sleep(600);
    unzoom('main');
    await sleep(2400);
    await click(page, btn(/^Close$/, panel), { scroll: false });
    await sleep(700);

    /* 08 multi-store cart */
    ev('scene', { name: '08_cart' });
    const stores = await verified().evaluateAll((els) => els.map((e) => e.dataset.store));
    const i1 = 0, i2 = stores.findIndex((s) => s !== stores[0]);
    if (i2 < 0) throw new Error('need two verified stores');
    for (const i of [i1, i2]) {
      const c = verified().nth(i);
      await scrollTo(page, c, 0.45);
      await click(page, btn(/^Add to cart$/, c));
      await sleep(600);
    }
    const checkout = page.getByRole('button', { name: 'Check out cart' });
    await zoom('main', checkout, { max: 1.6, pad: 200 });
    await sleep(500);
    await click(page, checkout, { scroll: false });
    unzoom('main');
    const cartPay = btn(/at once with PayPal/i).last();
    await until(() => cartPay.count(), 30000, 'cart card');
    await sleep(600);
    const cartCard = cartPay.locator('xpath=ancestor::div[contains(@class,"rounded")][last()]');
    await scrollTo(page, cartPay, 0.6);
    await zoom('main', cartPay.locator('xpath=ancestor::div[contains(@class,"rounded")][2]'), { max: 1.4 });
    await sleep(900);
    await viaPayPal(ctx, page, cartPay, 'pp2', true);
    const cancel = btn(/Cancel this store/i).first();
    await until(() => cancel.count(), 90000, 'cart paid');
    ev('normal');
    await scrollTo(page, cancel, 0.55);
    await zoom('main', cancel.locator('xpath=ancestor::div[contains(@class,"rounded")][2]'), { max: 1.4 });
    await sleep(1600);
    await click(page, cancel);
    ev('fast');
    await until(async () => /Refunded/.test(await main.innerText()), 90000, 'store refund');
    await sleep(500);
    ev('normal');
    await hover(page, page.getByText(/Refunded/).last(), 2200);
    unzoom('main');
    void cartCard;

    /* 09 family approval */
    ev('scene', { name: '09_family' });
    const v1 = verified().first();
    await scrollTo(page, v1, 0.45);
    await click(page, btn(/^Buy$/, v1));
    await until(async () => btn(/^Ask family to approve$/, approval()).count(), 60000, 'family button');
    const fc = approval();
    await scrollTo(page, fc, 0.5);
    await zoom('main', fc, { max: 1.45 });
    await click(page, btn(/^Ask family to approve$/, fc));
    const nameIn = fc.locator('input[placeholder^="Your name"]');
    await click(page, nameIn);
    await typeText(page, 'Alex', 90, 150);
    await sleep(400);
    await click(page, btn(/^Create approval link$/, fc));
    const id = await until(async () => (await fc.innerHTML()).match(/(?:\/|%2F)f(?:\/|%2F)([a-z0-9]{12})/i)?.[1], 30000, 'approval link');
    await sleep(1500);
    // Mom's phone: her own browser
    const momCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: false, colorScheme: 'light' });
    await momCtx.addInitScript(() => (window.__touch = true));
    await momCtx.addInitScript(overlay, { email: process.env.PP_USER || '' });
    const mom = await momCtx.newPage();
    streamOf.set(mom, 'mom');
    await mom.goto(`${BASE}/f/${id}`, { waitUntil: 'domcontentloaded' });
    await capture(momCtx, mom, 'mom');
    pos.set(mom, { x: 300, y: 700 });
    await mom.mouse.move(300, 700);
    unzoom('main');
    ev('show', { stream: 'mom' });
    const momPay = btn(/^Approve & pay/, mom);
    await until(() => momPay.count(), 45000, 'approver page');
    await sleep(1800);
    await hover(mom, mom.locator('main, body').first().getByText(/Alex/).first(), 1200).catch(() => {});
    await viaPayPal(momCtx, mom, momPay, 'mompp', true);
    await until(async () => /Funds held/.test(await mom.locator('body').innerText()), 90000, 'mom hold');
    ev('normal');
    await sleep(1200);
    await click(mom, btn(/^Confirm now$/, mom));
    ev('fast');
    await until(async () => /Paid!/.test(await mom.locator('body').innerText()), 90000, 'mom paid');
    await sleep(400);
    ev('normal');
    await sleep(2500);
    ev('show', { stream: 'main' });
    streams.mom.flush();

    /* 10 group buy + savings */
    ev('scene', { name: '10_group_savings' });
    const v2 = verified().first();
    await scrollTo(page, v2, 0.45);
    await click(page, btn(/^Buy$/, v2));
    await until(async () => btn(/^Split it with friends$/, approval()).count(), 60000, 'split button');
    const gc = approval();
    await scrollTo(page, gc, 0.5);
    await zoom('main', gc, { max: 1.45 });
    await click(page, btn(/^Split it with friends$/, gc));
    await sleep(500);
    await click(page, btn(/^Create group link$/, gc));
    await until(async () => /Copy link|Open group page/.test(await gc.innerText()), 30000, 'group link');
    await sleep(1600);
    unzoom('main');
    await click(page, page.getByRole('button', { name: /^Purchases & savings$/ }).first(), { scroll: false });
    await sleep(1000);
    const sp = page.getByRole('dialog', { name: 'My purchases & savings' });
    await zoom('main', sp, { max: 1.3, pad: 10 });
    await hover(page, sp, 2500);

    /* 11 outro */
    ev('scene', { name: '11_outro' });
    unzoom('main');
    await moveTo(page, 800, 450);
    await sleep(4000);
    ev('end');
  } catch (e) {
    ev('error', { message: e.message });
    await page.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
    console.error(e);
  }
  for (const s of Object.values(streams)) s.flush();
  console.log('page errors:', errs);
  await browser.close();
  process.exit(events.some((e) => e.type === 'error') ? 1 : 0);
})();
