// Edits the recording into the final video: fits every scene to its voiceover, speeds up waits,
// cuts hidden parts, smooth zooms, 3D intro/outro, side captions, then mixes the voiceover.
// STILLS="5,30,61" → only write PNG stills at those output seconds (for checking).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const DIR = __dirname;
const REC = path.join(DIR, process.env.REC || 'rec');
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(__dirname, 'voiceover');
const FPS = 30;
const OUT = path.join(DIR, process.env.OUTFILE || 'dalil-demo.mp4');

const SCRIPT = {
  '01_intro': "Meet Dalil: an AI shopping agent that finds the best deal, negotiates for you, and pays with PayPal, with guardrails the AI can't bypass.",
  '02_search': "I just ask in plain English. Dalil searches a live product catalog and the web, then compares real offers. Every price is signed by the server, so the AI can't make one up, and every store gets a trust rating. It even reads the price history and tells me whether to buy now, or wait.",
  '03_mandate': 'Now, a spending limit. I set my maximum to five dollars. The AI still proposes the purchase, but the server enforces my mandate and blocks the payment. My rules beat the model.',
  '04_negotiation': "Next, Dalil negotiates agent to agent with the store's own seller agent. It asks for a better deal, and comes back with a lower, signed price. No haggling on my side.",
  '05_paypal': "When I'm ready, I approve with PayPal, on the real PayPal checkout, here in the sandbox. Dalil authorizes first, so the money is only held, not taken, and I get a short window to cancel. Then the payment is captured, and I get a trust receipt showing exactly what was checked before I paid.",
  '06_protection': 'For fourteen days after I buy, Dalil keeps watching the price. If it drops, I automatically get the difference back as a partial PayPal refund. A real refund, with no forms to fill.',
  '07_watch': 'Not ready to buy yet? I set a target price, and Dalil watches it for me. The moment the price drops, I get an alert.',
  '08_cart': 'Shopping from more than one store? Dalil builds a multi-store cart and pays every store with one single PayPal approval. Each store is tracked on its own, so if I change my mind about one, I cancel just that store and get a full refund.',
  '09_family': "Sometimes, someone else pays. With family approval, I send a link to my mom. She sees exactly what I'm buying, approves on her own phone, and pays from her own PayPal account, within a limit I set.",
  '10_group_savings': 'Buying with friends? One group link splits the cost. And every dollar Dalil saves me is tracked in one place.',
  '11_outro': 'Dalil. An AI that shops like an expert, and pays with PayPal, safely. Try the live demo today.',
};
const CHAPTERS = {
  '02_search': ['AI search', 'Real AI · live catalog · signed prices · store trust · buy now or wait'],
  '03_mandate': ['Spending mandate', 'Your limit is enforced by the server, at the moment money moves'],
  '04_negotiation': ['Agent-to-agent negotiation', "Dalil haggles with the store's seller agent"],
  '05_paypal': ['Pay with PayPal', 'Authorize → hold → capture, then a trust receipt'],
  '06_protection': ['Price protection', '14 days · automatic partial PayPal refund'],
  '07_watch': ['Price watch', 'Target price → instant alert'],
  '08_cart': ['Multi-store cart', 'One PayPal approval · per-store refunds'],
  '09_family': ['Family approval', 'Someone else approves and pays from their own PayPal'],
  '10_group_savings': ['Group buy & savings', 'Split with friends · every saving tracked'],
};
const CH_KEYS = Object.keys(CHAPTERS);

/* ---------------- load ---------------- */
const events = JSON.parse(fs.readFileSync(path.join(REC, 'events.json'), 'utf8'));
const streams = {};
for (const f of fs.readdirSync(REC)) if (f.endsWith('.json') && f !== 'events.json') streams[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(REC, f), 'utf8'));
const audioFiles = fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3')).sort((a, b) => a.match(/T(\d\d_\d\d_\d\d)/)[1].localeCompare(b.match(/T(\d\d_\d\d_\d\d)/)[1]));
const audioDur = audioFiles.map((f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(AUDIO_DIR, f)]).toString()));

const allFrames = Object.values(streams).flatMap((x) => x.frames).sort((a, b) => a - b);
const scenesEv = events.filter((e) => e.type === 'scene');
const endT = (events.find((e) => e.type === 'end') || events[events.length - 1]).t;
if (scenesEv.length !== 11) console.warn('WARNING: only ' + scenesEv.length + ' scenes');

/* ---------------- edit decision list ---------------- */
const LEAD = 0.4, TAIL = 0.6, INTRO = 3.7;
let mode = 'normal', hidden = false;
const pieces = []; // {rawA, rawB, outA, outB, scene}
const sceneOut = [];
let out = 0;
const ordered = [...events].sort((a, b) => a.t - b.t);
scenesEv.forEach((sc, i) => {
  const a = sc.t, b = i + 1 < scenesEv.length ? scenesEv[i + 1].t : endT;
  // raw segments
  const segs = [];
  let cur = a;
  const marks = ordered.filter((e) => e.t > a && e.t < b && ['fast', 'normal', 'hide', 'unhide'].includes(e.type));
  for (const m of [...marks, { t: b, type: 'end' }]) {
    if (m.t > cur + 0.01) segs.push({ a: cur, b: m.t, kind: hidden ? 'hidden' : mode });
    cur = m.t;
    if (m.type === 'fast' || m.type === 'normal') mode = m.type;
    if (m.type === 'hide') hidden = true;
    if (m.type === 'unhide') hidden = false;
  }
  const name = sc.name;
  const isIntro = i === 0, isOutro = i === 10;
  const target = isOutro ? LEAD + audioDur[i] + 2.2 : LEAD + audioDur[i] + TAIL;
  const pre = isIntro ? INTRO : 0;
  const avail = target - pre;
  // split normal segments: static stretches (no new frame on any stream for >1.1s) become "idle"
  const vis = [];
  for (const s of segs.filter((s) => s.kind !== 'hidden')) {
    if (s.kind !== 'normal') { vis.push(s); continue; }
    const ts = [s.a, ...allFrames.filter((x) => x > s.a && x < s.b), s.b];
    let cur = s.a;
    for (let j = 1; j < ts.length; j++) {
      if (ts[j] - ts[j - 1] > 1.1) {
        const ia = ts[j - 1] + 0.35, ib = ts[j] - 0.1;
        if (ia > cur) vis.push({ a: cur, b: ia, kind: 'normal' });
        vis.push({ a: ia, b: ib, kind: 'idle' });
        cur = ib;
      }
    }
    if (s.b > cur) vis.push({ a: cur, b: s.b, kind: 'normal' });
  }
  const N = vis.filter((s) => s.kind === 'normal').reduce((x, s) => x + s.b - s.a, 0);
  const fast = vis.filter((s) => s.kind === 'fast');
  const idle = vis.filter((s) => s.kind === 'idle');
  const fdur = (s, sp) => (s.kind === 'fast' ? Math.max(Math.min(s.b - s.a, 0.7), (s.b - s.a) / sp) : Math.max(Math.min(s.b - s.a, 0.6), (s.b - s.a) / Math.min(sp, 6)));
  const fo = (sp) => [...fast, ...idle].reduce((x, s) => x + fdur(s, sp), 0);
  let sp = 1, k = 1;
  if (N + fo(1) > avail) {
    let lo = 1, hi = 400;
    for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (N + fo(m) > avail) lo = m; else hi = m; }
    sp = hi;
    if (N + fo(sp) > avail + 0.05) k = Math.min(1.85, N / Math.max(0.1, avail - fo(sp)));
  }
  sp = Math.max(sp, 2);
  const start = out;
  sceneOut.push({ name, start, audio: audioDur[i], speechAt: start + (isIntro ? 0.6 : LEAD) });
  out += pre;
  if (isIntro) pieces.push({ rawA: vis[0].a, rawB: vis[0].a, outA: start, outB: out, scene: i, speed: 0 });
  for (const s of vis) {
    const raw = s.b - s.a;
    const d = s.kind === 'normal' ? raw / k : s.kind === 'idle' && sp <= 2 ? raw : fdur(s, sp);
    pieces.push({ rawA: s.a, rawB: s.b, outA: out, outB: out + d, scene: i, speed: raw / d, kind: s.kind });
    out += d;
  }
  if (out < start + target) {
    const last = vis[vis.length - 1];
    pieces.push({ rawA: last.b, rawB: last.b, outA: out, outB: start + target, scene: i, speed: 0 });
    out = start + target;
  }
  sceneOut[i].end = out;
  console.log(`${name}: audio ${audioDur[i].toFixed(1)}s → ${(out - start).toFixed(1)}s | normal ${N.toFixed(1)}s ×${k.toFixed(2)} | fast ${fast.reduce((x, s) => x + s.b - s.a, 0).toFixed(1)}s ÷${sp.toFixed(1)}`);
});
const TOTAL = out;
console.log('TOTAL', TOTAL.toFixed(1), 's');

const pieceAt = (t) => pieces.find((p) => t >= p.outA && t < p.outB) || pieces[pieces.length - 1];
const rawAt = (t) => { const p = pieceAt(t); return p.rawA + (p.rawB - p.rawA) * ((t - p.outA) / (p.outB - p.outA || 1)); };
const lastEv = (types, raw) => { let r = null; for (const e of ordered) { if (e.t > raw) break; if (types.includes(e.type)) r = e; } return r; };
const frameOf = (name, raw) => {
  const s = streams[name];
  if (!s || !s.frames.length) return null;
  let lo = 0, hi = s.frames.length - 1, idx = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.frames[m] <= raw) { idx = m; lo = m + 1; } else hi = m - 1; }
  return 'file://' + path.join(REC, name, `${idx}.jpg`);
};
const zoomTarget = (stream, raw) => {
  const z = lastEv(['zoom', 'unzoom', 'zoomwide', 'show'], raw);
  const size = streams[stream]?.size || { width: 1600, height: 900 };
  const W = size.width, H = size.height;
  if (!z || z.type !== 'zoom' || z.stream !== stream) return { cx: W / 2, cy: H / 2, s: 1 };
  const pad = z.pad ?? 40;
  let s = Math.min(z.max || 1.6, W / (z.w + 2 * pad), H / (z.h + 2 * pad));
  s = Math.max(1, s);
  const vw = W / s, vh = H / s;
  const cx = Math.max(vw / 2, Math.min(W - vw / 2, z.x + z.w / 2));
  const cy = Math.max(vh / 2, Math.min(H - vh / 2, z.y + Math.min(z.h, vh - 2 * pad) / 2 + (z.h > vh ? 0 : 0)));
  return { cx, cy, s };
};
const sentences = (txt) => txt.match(/[^.!?]+[.!?]+/g).map((s) => s.trim());

/* ---------------- per-frame state ---------------- */
let lastPop = null, popV = 0, lastPhone = 'mom';
let zc = null, lastWinStream = 'main', phoneV = 0, speedV = 0, speedShown = 0, prevPiece = null, cutAt = -1, cutRaw = 0, cutStream = 'main';
function state(t, dt) {
  const p = pieceAt(t);
  const raw = rawAt(t);
  if (prevPiece && p !== prevPiece && Math.abs(p.rawA - prevPiece.rawB) > 0.05 && p.scene === prevPiece.scene) { cutAt = t; cutRaw = prevPiece.rawB; cutStream = lastWinStream; }
  prevPiece = p;
  const shown = lastEv(['show'], raw)?.stream || 'main';
  const phoneOn = shown.startsWith('mom');
  const popOn = shown.startsWith('pp');
  const winStream = phoneOn || popOn ? 'main' : shown;
  if (popOn) lastPop = shown;
  let tgt = phoneOn || popOn ? { cx: 800, cy: 450, s: 1 } : zoomTarget(winStream, raw);
  if (!zc || winStream !== lastWinStream) zc = { ...tgt };
  else {
    const a = 1 - Math.exp(-dt / 0.28);
    zc.cx += (tgt.cx - zc.cx) * a; zc.cy += (tgt.cy - zc.cy) * a; zc.s += (tgt.s - zc.s) * a;
  }
  const switched = winStream !== lastWinStream;
  if (switched) { cutAt = t; cutRaw = raw - 0.001; cutStream = lastWinStream; }
  lastWinStream = winStream;
  phoneV += ((phoneOn ? 1 : 0) - phoneV) * (1 - Math.exp(-dt / 0.2));
  popV += ((popOn ? 1 : 0) - popV) * (1 - Math.exp(-dt / 0.13));
  if (phoneOn) lastPhone = shown;
  const sp = p.kind === 'fast' && p.speed >= 1.6 ? p.speed : 0;
  speedV += ((sp ? 1 : 0) - speedV) * (1 - Math.exp(-dt / 0.12));
  if (sp) speedShown = sp;

  const si = p.scene, sc = sceneOut[si];
  const cut = t - cutAt < 0.35 ? { b: frameOf(cutStream, cutRaw), bo: 1 - (t - cutAt) / 0.35 } : { b: null, bo: 0 };
  // captions
  const sents = sentences(SCRIPT[sc.name]);
  const total = sents.reduce((x, s) => x + s.length, 0);
  let acc = 0;
  const caps = sents.map((s) => {
    const a = sc.speechAt + (acc / total) * sc.audio; acc += s.length;
    const b = sc.speechAt + (acc / total) * sc.audio;
    const o = t < a - 0.15 ? 0 : t < b ? Math.min(1, (t - a + 0.15) / 0.3) : 0.4 + 0.6 * Math.max(0, 1 - (t - b) / 0.4);
    return { text: s, o };
  });
  const chIdx = CH_KEYS.indexOf(sc.name);
  const chapter = chIdx >= 0 ? { key: sc.name, no: `${String(chIdx + 1).padStart(2, '0')} / ${String(CH_KEYS.length).padStart(2, '0')}`, title: CHAPTERS[sc.name][0], sub: CHAPTERS[sc.name][1], age: t - sc.start } : null;
  const progress = chIdx >= 0 ? chIdx + (t - sc.start) / (sc.end - sc.start) : si === 0 ? 0 : CH_KEYS.length;
  const intro = si === 0 ? t : null;
  const winIn = si === 0 ? Math.max(0, t - (INTRO - 0.1)) : null;
  const outroStart = sceneOut[10] ? sceneOut[10].start + 0.35 : Infinity;
  const outroT = t >= outroStart ? t - outroStart : null;
  let side = si === 0 ? Math.min(1, Math.max(0, (t - INTRO - 0.6) / 0.8)) : 1;
  if (outroT != null) side = Math.max(0, 1 - outroT / 0.5);
  const winStreamFrame = frameOf(winStream, raw);
  const phoneStream = phoneOn ? shown : (lastEv(['show'], raw)?.stream === 'main' ? (streams.mompp && raw > (streams.mom?.frames[0] || Infinity) ? 'mom' : 'mom') : 'mom');
  return {
    t,
    a: winStreamFrame,
    b: cut.b,
    bOpacity: cut.bo,
    zoom: { cx: zc.cx, cy: zc.cy, k: (1440 / 1600) * zc.s },
    url: 'paypalai-m.vercel.app',
    pop: popV < 0.01 ? 0 : popV,
    popSrc: popV > 0.01 && lastPop ? frameOf(lastPop, raw) : null,
    phone: phoneV < 0.01 ? 0 : phoneV,
    phoneSrc: phoneV > 0.01 ? frameOf(lastPhone, raw) : null,
    speedOpacity: speedV,
    speedText: `Sped up ${speedShown >= 10 ? Math.round(speedShown / 5) * 5 : Math.round(speedShown)}×`,
    chapter,
    caps: chapter ? caps : [],
    progress,
    progTotal: CH_KEYS.length,
    sideOpacity: side,
    introT: intro,
    winIn: outroT == null ? winIn : null,
    winOut: outroT,
    outroT,
  };
}

/* ---------------- render ---------------- */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(DIR, 'comp.html'));
  await page.evaluate(() => document.fonts.ready);
  const stills = process.env.STILLS ? process.env.STILLS.split(',').map(Number) : null;
  const n = Math.round(TOTAL * FPS);
  let ff = null;
  const tmpVideo = path.join(DIR, 'video-only.mp4');
  if (!stills) {
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmpVideo], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    const t = f / FPS;
    const s = state(t, 1 / FPS);
    if (stills) {
      if (!stills.some((x) => Math.abs(x - t) < 0.5 / FPS)) continue;
      await page.evaluate((st) => window.render(st), s);
      await page.screenshot({ path: path.join(DIR, `still-${t.toFixed(1)}.png`) });
      console.log('still', t);
      continue;
    }
    await page.evaluate((st) => window.render(st), s);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`frame ${f}/${n} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await browser.close();
  if (stills) return;
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));

  // voiceover
  const args = ['-y', '-loglevel', 'error'];
  audioFiles.forEach((f) => args.push('-i', path.join(AUDIO_DIR, f)));
  const filt = audioFiles.map((_, i) => `[${i}:a]aresample=48000,adelay=${Math.round(sceneOut[i].speechAt * 1000)}:all=1[a${i}]`).join(';') + ';' + audioFiles.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${audioFiles.length}:normalize=0,apad=whole_dur=${TOTAL.toFixed(2)}[mix]`;
  args.push('-filter_complex', filt, '-map', '[mix]', '-c:a', 'pcm_s16le', path.join(DIR, 'voice.wav'));
  execFileSync('ffmpeg', args);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmpVideo, '-i', path.join(DIR, 'voice.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT]);
  // captions as a sidecar too
  const srt = [];
  const fmt = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  let k = 1;
  sceneOut.forEach((sc) => {
    const sents = sentences(SCRIPT[sc.name]);
    const total = sents.reduce((x, s) => x + s.length, 0);
    let acc = 0;
    for (const s of sents) { const a = sc.speechAt + (acc / total) * sc.audio; acc += s.length; const b = sc.speechAt + (acc / total) * sc.audio; srt.push(`${k++}\n${fmt(a)} --> ${fmt(b)}\n${s}\n`); }
  });
  fs.writeFileSync(OUT.replace(/\.mp4$/, '.srt'), srt.join('\n'));
  console.log('done', OUT, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
