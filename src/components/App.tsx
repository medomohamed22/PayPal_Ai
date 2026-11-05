"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { Menu, Moon, PanelLeft, Plus, Settings2, Sun, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, loadSettings, requestPersistence, saveSettings, uid } from "@/lib/db";
import { t } from "@/lib/i18n";
import {
  DEFAULT_SETTINGS,
  type AgentEvent,
  type Block,
  type ChatMessage,
  type Offer,
  type Settings,
  type Step,
  type WireMessage,
} from "@/lib/types";
import Composer, { type ComposerPayload } from "./Composer";
import Logo from "./Logo";
import MessageView, { type ApprovalAction } from "./MessageView";
import SettingsSheet from "./SettingsSheet";

/** Convert stored messages into the compact form the model sees. */
function toWire(messages: ChatMessage[]): WireMessage[] {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return messages.slice(-30).map((m) => {
    const parts: string[] = [];
    const images: string[] = [];
    for (const b of m.blocks) {
      if (b.type === "text") parts.push(b.text);
      if (b.type === "link") parts.push(`[link] ${b.preview.url}${b.preview.title ? ` — ${b.preview.title}` : ""}`);
      if (b.type === "image") {
        if (m === lastUser) images.push(b.dataUrl);
        else parts.push("[photo attached earlier]");
      }
      if (b.type === "products")
        parts.push(
          "[Offers shown to user]\n" +
            b.offers
              .map((o, i) => `${i + 1}. ${o.title} | ${o.store} | total ${o.total} ${o.currency} | trust ${o.trust}${o.url ? ` | ${o.url}` : ""}`)
              .join("\n"),
        );
      if (b.type === "approval") parts.push(`[Purchase approval for "${b.offer.title}" at ${b.offer.store}: ${b.status}]`);
    }
    return { role: m.role, text: parts.join("\n\n"), images: images.length ? images : undefined };
  });
}

function applyEvent(blocks: Block[], e: AgentEvent): Block[] {
  const next = [...blocks];
  if (e.type === "step") {
    let idx = next.findIndex((b) => b.type === "steps");
    // Start a new steps group if text/cards were emitted since the last one.
    if (idx === -1 || idx !== next.length - 1) {
      const lastSteps = idx;
      const running = lastSteps >= 0 && (next[lastSteps] as Extract<Block, { type: "steps" }>).steps.some((s) => s.id === e.step.id);
      if (!running) {
        next.push({ type: "steps", steps: [] });
        idx = next.length - 1;
      }
    }
    const sb = next[idx] as Extract<Block, { type: "steps" }>;
    const steps: Step[] = [...sb.steps];
    const at = steps.findIndex((s) => s.id === e.step.id);
    if (at >= 0) steps[at] = { ...steps[at], ...e.step, detail: e.step.detail ?? steps[at].detail };
    else steps.push(e.step);
    next[idx] = { type: "steps", steps };
  } else if (e.type === "text") {
    const last = next[next.length - 1];
    if (last?.type === "text") next[next.length - 1] = { type: "text", text: last.text + e.delta };
    else next.push({ type: "text", text: e.delta });
  } else if (e.type === "block") {
    next.push(e.block);
  } else if (e.type === "error") {
    next.push({ type: "error", text: e.message });
  }
  return next;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [live, setLive] = useState<ChatMessage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebar, setDesktopSidebar] = useState(true);
  const [dark, setDark] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; n: number }>();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const s = t(settings.lang);

  useEffect(() => {
    loadSettings().then((st) => {
      setSettings(st);
      setReady(true);
    });
    requestPersistence();
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = settings.lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("dalil-lang", settings.lang);
    } catch {}
  }, [settings.lang]);

  const toggleTheme = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    try {
      localStorage.setItem("dalil-theme", d ? "dark" : "light");
    } catch {}
  };

  const conversations = useLiveQuery(() => db().conversations.orderBy("updatedAt").reverse().toArray(), []) ?? [];
  const storedQ =
    useLiveQuery(
      () =>
        convId
          ? db().messages.where("[conversationId+createdAt]").between([convId, 0], [convId, Infinity]).toArray()
          : Promise.resolve([] as ChatMessage[]),
      [convId],
    );
  const stored = useMemo(() => storedQ ?? [], [storedQ]);

  const messages = useMemo(() => {
    if (!live) return stored;
    return [...stored.filter((m) => m.id !== live.id), live];
  }, [stored, live]);

  // Keep scrolled to bottom while streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (nearBottom || live) el.scrollTo({ top: el.scrollHeight, behavior: live ? "auto" : "smooth" });
  }, [messages, live]);

  const busy = !!live;

  const newChat = () => {
    abortRef.current?.abort();
    setConvId(null);
    setSidebarOpen(false);
  };

  const ensureConversation = async (title: string) => {
    if (convId) {
      await db().conversations.update(convId, { updatedAt: Date.now() });
      return convId;
    }
    const id = uid();
    await db().conversations.put({ id, title: title.slice(0, 60) || "…", createdAt: Date.now(), updatedAt: Date.now() });
    setConvId(id);
    return id;
  };

  const send = useCallback(
    async (p: ComposerPayload) => {
      if (busy) return;
      if (!settings.apiKey && !settings.demoMode) {
        setSettingsOpen(true);
        return;
      }
      const cid = await ensureConversation(p.text || p.links[0]?.title || "📷");
      const now = Date.now();
      const userBlocks: Block[] = [
        ...p.images.map((dataUrl) => ({ type: "image" as const, dataUrl })),
        ...p.links.map((preview) => ({ type: "link" as const, preview })),
        ...(p.text ? [{ type: "text" as const, text: p.text }] : []),
      ];
      const userMsg: ChatMessage = { id: uid(), conversationId: cid, role: "user", blocks: userBlocks, createdAt: now };
      await db().messages.put(userMsg);

      const history = toWire([...(await db().messages.where("conversationId").equals(cid).sortBy("createdAt"))]);
      let assistant: ChatMessage = { id: uid(), conversationId: cid, role: "assistant", blocks: [], createdAt: now + 1 };
      setLive(assistant);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let lastSave = 0;
      const persist = async (force = false) => {
        if (!force && Date.now() - lastSave < 500) return;
        lastSave = Date.now();
        await db().messages.put(assistant);
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-model-api-key": settings.apiKey },
          body: JSON.stringify({
            history,
            settings: {
              baseUrl: settings.baseUrl,
              model: settings.model,
              reasoningEffort: settings.reasoningEffort,
              market: settings.market,
              city: settings.city,
              lang: settings.lang,
              demoMode: settings.demoMode,
            },
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let ev: AgentEvent;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.type === "error" && ev.message === "NO_API_KEY") ev = { ...ev, message: s.needKey };
            assistant = { ...assistant, blocks: applyEvent(assistant.blocks, ev) };
            setLive(assistant);
            persist();
          }
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          assistant = { ...assistant, blocks: applyEvent(assistant.blocks, { type: "error", message: String((err as Error).message ?? err) }) };
        }
      } finally {
        // Mark any still-running steps as done (e.g. after Stop)
        assistant = {
          ...assistant,
          blocks: assistant.blocks.map((b) =>
            b.type === "steps" ? { ...b, steps: b.steps.map((x) => (x.status === "running" ? { ...x, status: "done" as const } : x)) } : b,
          ),
        };
        await persist(true);
        await db().conversations.update(cid, { updatedAt: Date.now() });
        setLive(null);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, settings, convId, s],
  );

  /** Clicking "Buy" on a product card opens an approval box directly (no LLM round-trip). */
  const onBuy = async (offer: Offer) => {
    if (!convId) return;
    await db().messages.put({
      id: uid(),
      conversationId: convId,
      role: "assistant",
      blocks: [{ type: "approval", offer, status: "pending" }],
      createdAt: Date.now(),
    });
  };

  const updateBlock = async (msgId: string, idx: number, patch: Partial<Extract<Block, { type: "approval" }>>) => {
    const m = await db().messages.get(msgId);
    if (!m) return;
    const blocks = [...m.blocks];
    const b = blocks[idx];
    if (b?.type !== "approval") return;
    blocks[idx] = { ...b, ...patch };
    await db().messages.put({ ...m, blocks });
  };

  const onApproval = async (msgId: string, idx: number, action: ApprovalAction) => {
    if (action === "decline") return updateBlock(msgId, idx, { status: "declined" });
    // PayPal checkout is wired in the next milestone.
    await updateBlock(msgId, idx, { status: "processing" });
    setTimeout(
      () =>
        updateBlock(msgId, idx, {
          status: "error",
          message: settings.lang === "ar" ? "الدفع بـ PayPal لسه بيتجهز" : "PayPal checkout is not configured yet",
        }),
      600,
    );
  };

  const deleteConversation = async (id: string) => {
    await db().messages.where("conversationId").equals(id).delete();
    await db().conversations.delete(id);
    if (id === convId) setConvId(null);
  };

  const onSaveSettings = async (st: Settings) => {
    setSettings(st);
    await saveSettings(st);
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <span className="text-[15px] font-semibold tracking-tight">{settings.lang === "ar" ? "دليل" : "Dalil"}</span>
        </div>
        <button className="rounded-lg p-1.5 hover:bg-bg-muted md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-3">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm font-medium shadow-card transition-colors hover:border-line-strong"
        >
          <Plus className="size-4" /> {s.newChat}
        </motion.button>
      </div>
      <div className="mt-4 px-3 text-[11px] font-semibold uppercase tracking-widest text-fg-muted">{s.chats}</div>
      <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        <AnimatePresence initial={false}>
          {conversations.map((c) => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className={`group flex items-center rounded-lg ${c.id === convId ? "bg-bg-muted" : "hover:bg-bg-muted/60"}`}
            >
              <button
                onClick={() => {
                  setConvId(c.id);
                  setSidebarOpen(false);
                }}
                className="min-w-0 flex-1 truncate px-2.5 py-2 text-start text-sm"
                dir="auto"
              >
                {c.title}
              </button>
              <button
                onClick={() => deleteConversation(c.id)}
                className="me-1 rounded-md p-1 text-fg-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 max-md:opacity-60"
                aria-label={s.deleteChat}
              >
                <Trash2 className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </nav>
      <div className="border-t border-line p-2">
        <button
          onClick={() => {
            setSettingsOpen(true);
            setSidebarOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-bg-muted"
        >
          <Settings2 className="size-4" />
          {s.settings}
          <span className="ms-auto truncate font-mono text-[10px] text-fg-muted" dir="ltr">
            {settings.demoMode ? "demo" : settings.model}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <AnimatePresence initial={false}>
        {desktopSidebar && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 272, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="hidden shrink-0 overflow-hidden border-e border-line bg-bg-soft md:block"
          >
            <div className="h-full w-[272px]">{sidebar}</div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30 bg-black/30 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 start-0 z-40 w-[82%] max-w-[300px] border-e border-line bg-bg-soft md:hidden"
              initial={{ x: settings.lang === "ar" ? "100%" : "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: settings.lang === "ar" ? "100%" : "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
          <button className="rounded-lg p-2 hover:bg-bg-soft md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Menu">
            <Menu className="size-5" />
          </button>
          <button
            className="hidden rounded-lg p-2 text-fg-muted hover:bg-bg-soft hover:text-fg md:block"
            onClick={() => setDesktopSidebar((v) => !v)}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="size-[18px] rtl:-scale-x-100" />
          </button>
          <div className="flex items-center gap-2 md:hidden">
            <span className="text-[15px] font-semibold">{settings.lang === "ar" ? "دليل" : "Dalil"}</span>
          </div>
          <div className="ms-auto flex items-center gap-1">
            {settings.demoMode && (
              <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Demo
              </span>
            )}
            <button onClick={newChat} className="rounded-lg p-2 text-fg-muted hover:bg-bg-soft hover:text-fg md:hidden" aria-label={s.newChat}>
              <Plus className="size-5" />
            </button>
            <button onClick={toggleTheme} className="rounded-lg p-2 text-fg-muted hover:bg-bg-soft hover:text-fg" aria-label="Theme">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={dark ? "d" : "l"} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} className="block">
                  {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
                </motion.span>
              </AnimatePresence>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg p-2 text-fg-muted hover:bg-bg-soft hover:text-fg"
              aria-label={s.settings}
            >
              <Settings2 className="size-[18px]" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-3xl px-4 pb-6">
            {messages.length === 0 ? (
              <EmptyState
                s={s}
                ready={ready}
                needsKey={!settings.apiKey && !settings.demoMode}
                onPick={(text) => setPrefill({ text, n: Date.now() })}
                onSettings={() => setSettingsOpen(true)}
              />
            ) : (
              <div className="space-y-7 pt-4">
                {messages.map((m) => (
                  <MessageView
                    key={m.id}
                    msg={m}
                    live={live?.id === m.id}
                    s={s}
                    lang={settings.lang}
                    busy={busy}
                    onBuy={onBuy}
                    onApproval={onApproval}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 bg-gradient-to-t from-bg via-bg to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4">
          <div className="mx-auto max-w-3xl">
            <Composer s={s} busy={busy} onSend={send} onStop={() => abortRef.current?.abort()} prefill={prefill} />
            <p className="mt-2 text-center text-[11px] text-fg-muted">{s.tagline} · PayPal</p>
          </div>
        </div>
      </main>

      <SettingsSheet open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={onSaveSettings} />
    </div>
  );
}

function EmptyState({
  s,
  ready,
  needsKey,
  onPick,
  onSettings,
}: {
  s: ReturnType<typeof t>;
  ready: boolean;
  needsKey: boolean;
  onPick: (t: string) => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col items-center justify-center py-10 text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 16 }}>
        <Logo size={56} />
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        {s.emptyTitle}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14 }}
        className="mt-2 max-w-md text-sm leading-relaxed text-fg-muted"
      >
        {s.emptySub}
      </motion.p>
      {ready && needsKey && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={onSettings}
          className="mt-4 rounded-full border border-line px-3.5 py-1.5 text-xs font-medium hover:bg-bg-soft"
        >
          {s.needKey}
        </motion.button>
      )}
      <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {s.suggestions.map((q, i) => (
          <motion.button
            key={q}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.05 }}
            whileHover={{ y: -2 }}
            onClick={() => onPick(q)}
            dir="auto"
            className="rounded-2xl border border-line bg-bg px-4 py-3 text-start text-sm text-fg-soft shadow-card transition-colors hover:border-line-strong hover:text-fg"
          >
            {q}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
