"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Eye, EyeOff, Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { KNOWN_MODELS, type Settings } from "@/lib/types";
import { getKV, setKV } from "@/lib/db";

const CITIES: Record<Settings["market"], string[]> = {
  EG: ["Cairo", "Giza", "Alexandria", "Mansoura", "Tanta"],
  US: ["New York", "Los Angeles", "Chicago", "Houston", "San Francisco"],
};

export default function SettingsSheet({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (s: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>(KNOWN_MODELS);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  const s = t(draft.lang);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setSaved(false);
      setFetchMsg(null);
      getKV<string[]>("models").then((m) => m?.length && setModels(m));
    }
  }, [open, settings]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  async function fetchModels() {
    setFetching(true);
    setFetchMsg(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-model-api-key": draft.apiKey },
        body: JSON.stringify({ baseUrl: draft.baseUrl }),
      });
      const j = await res.json();
      if (!res.ok || !Array.isArray(j.models) || !j.models.length) throw new Error(j.error);
      const merged = Array.from(new Set([...j.models])) as string[];
      setModels(merged);
      await setKV("models", merged);
      setFetchMsg(s.modelsFound(merged.length));
      if (!merged.includes(draft.model)) set("model", merged[0]);
    } catch (e) {
      setModels(KNOWN_MODELS);
      setFetchMsg(`${s.modelsFailed}${e instanceof Error && e.message ? ` (${e.message.slice(0, 120)})` : ""}`);
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    await onSave(draft);
    setSaved(true);
    setTimeout(onClose, 450);
  }

  const field = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none transition-colors focus:border-fg";
  const label = "mb-1.5 block text-xs font-medium text-fg-muted";
  const isRtl = draft.lang === "ar";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={s.settings}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] sm:inset-y-0 sm:bottom-auto sm:end-0 sm:start-auto sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-s sm:border-t-0"
            initial={{ y: "100%", x: 0 }}
            animate={{ y: 0, x: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
            <div className="sticky top-0 z-10 flex items-center justify-between bg-bg/90 px-5 py-4 backdrop-blur">
              <h2 className="text-base font-semibold">{s.settings}</h2>
              <button onClick={onClose} className="rounded-full p-1.5 hover:bg-bg-soft" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-7 px-5 pb-6">
              <section className="space-y-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">{s.apiSection}</h3>
                <div>
                  <label className={label}>{s.baseUrl}</label>
                  <input dir="ltr" className={field} value={draft.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
                </div>
                <div>
                  <label className={label}>{s.apiKey}</label>
                  <div className="relative">
                    <input
                      dir="ltr"
                      type={showKey ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-…"
                      className={`${field} pr-10 font-mono`}
                      value={draft.apiKey}
                      onChange={(e) => set("apiKey", e.target.value.trim())}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-fg-muted hover:text-fg"
                      aria-label={showKey ? s.hide : s.show}
                    >
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-fg-muted">{s.keyLocal}</p>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-medium text-fg-muted">{s.model}</label>
                    <button
                      onClick={fetchModels}
                      disabled={!draft.apiKey || fetching}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium transition-colors hover:bg-bg-soft disabled:opacity-40"
                    >
                      {fetching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                      {fetching ? s.fetching : s.fetchModels}
                    </button>
                  </div>
                  <div className="grid gap-1.5">
                    {models.map((m) => (
                      <button
                        key={m}
                        dir="ltr"
                        onClick={() => set("model", m)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-start font-mono text-xs transition-all ${
                          draft.model === m ? "border-fg bg-bg-soft" : "border-line hover:border-line-strong"
                        }`}
                      >
                        {m}
                        {draft.model === m && <Check className="size-3.5" />}
                      </button>
                    ))}
                  </div>
                  <AnimatePresence>
                    {fetchMsg && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1.5 text-[11px] text-fg-muted">
                        {fetchMsg}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                <div>
                  <label className={label}>{s.reasoning}</label>
                  <div className="grid grid-cols-5 gap-1 rounded-xl bg-bg-soft p-1">
                    {(["minimal", "low", "medium", "high", "xhigh"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => set("reasoningEffort", r)}
                        className={`rounded-lg py-1.5 text-[11px] font-medium transition-all ${
                          draft.reasoningEffort === r ? "bg-bg shadow-card" : "text-fg-muted"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">{s.shoppingSection}</h3>
                <div>
                  <label className={label}>{s.market}</label>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg-soft p-1">
                    {(["EG", "US"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          set("market", m);
                          set("city", CITIES[m][0]);
                        }}
                        className={`rounded-lg py-2 text-xs font-medium transition-all ${draft.market === m ? "bg-bg shadow-card" : "text-fg-muted"}`}
                      >
                        {m === "EG" ? (isRtl ? "🇪🇬 مصر · EGP" : "🇪🇬 Egypt · EGP") : isRtl ? "🇺🇸 أمريكا · USD" : "🇺🇸 United States · USD"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={label}>{s.city}</label>
                  <input className={field} list="dalil-cities" value={draft.city} onChange={(e) => set("city", e.target.value)} />
                  <datalist id="dalil-cities">
                    {CITIES[draft.market].map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => {
                      if (!navigator.geolocation) return;
                      setLocating(true);
                      navigator.geolocation.getCurrentPosition(
                        (p) => {
                          set("coords", { lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) });
                          setLocating(false);
                        },
                        () => setLocating(false),
                        { enableHighAccuracy: false, timeout: 10000 },
                      );
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-bg-soft"
                  >
                    {locating ? <Loader2 className="size-3 animate-spin" /> : <MapPin className="size-3" />}
                    {draft.coords
                      ? `${isRtl ? "موقعك" : "Location"}: ${draft.coords.lat}, ${draft.coords.lon}`
                      : isRtl
                        ? "استخدم موقعي الحالي (لحساب المسافة للمحلات)"
                        : "Use my location (distance to stores)"}
                  </button>
                  {draft.coords && (
                    <button type="button" onClick={() => set("coords", null)} className="ms-2 text-[11px] text-fg-muted underline">
                      {isRtl ? "مسح" : "Clear"}
                    </button>
                  )}
                </div>
                <div>
                  <label className={label}>{s.language}</label>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg-soft p-1">
                    {(["ar", "en"] as const).map((l) => (
                      <button
                        key={l}
                        onClick={() => set("lang", l)}
                        className={`rounded-lg py-2 text-xs font-medium transition-all ${draft.lang === l ? "bg-bg shadow-card" : "text-fg-muted"}`}
                      >
                        {l === "ar" ? "العربية" : "English"}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
                  {isRtl ? "حدود الصرف (Mandate)" : "Spending mandate"}
                </h3>
                <div>
                  <label className={label}>
                    {isRtl ? "أقصى إجمالي للشراء الواحد" : "Max total per purchase"} ({draft.market === "EG" ? "EGP" : "USD"})
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    dir="ltr"
                    className={field}
                    placeholder={isRtl ? "0 = من غير حد" : "0 = no limit"}
                    value={draft.maxSpend || ""}
                    onChange={(e) => set("maxSpend", Math.max(0, Number(e.target.value) || 0))}
                  />
                  <p className="mt-1.5 text-[11px] leading-snug text-fg-muted">
                    {isRtl
                      ? "السيرفر بيرفض أي دفع فوق الحد ده — حتى لو الـ AI طلبه."
                      : "The server refuses any payment above this — even if the AI asks for it."}
                  </p>
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3 py-3">
                  <span className="text-sm">{isRtl ? "متاجر موثوقة بس" : "Verified stores only"}</span>
                  <button
                    role="switch"
                    aria-checked={draft.verifiedOnly}
                    onClick={() => set("verifiedOnly", !draft.verifiedOnly)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft.verifiedOnly ? "bg-inv-bg" : "bg-line-strong"}`}
                  >
                    <motion.span
                      layout
                      className="absolute top-0.5 size-5 rounded-full bg-bg shadow"
                      style={{ insetInlineStart: draft.verifiedOnly ? "1.375rem" : "0.125rem" }}
                    />
                  </button>
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3 py-3">
                  <span className="text-sm">{s.demoMode}</span>
                  <button
                    role="switch"
                    aria-checked={draft.demoMode}
                    aria-label="demo-mode"
                    onClick={() => set("demoMode", !draft.demoMode)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft.demoMode ? "bg-inv-bg" : "bg-line-strong"}`}
                  >
                    <motion.span
                      layout
                      className="absolute top-0.5 size-5 rounded-full bg-bg shadow"
                      style={{ insetInlineStart: draft.demoMode ? "1.375rem" : "0.125rem" }}
                    />
                  </button>
                </label>
              </section>
            </div>

            <div className="sticky bottom-0 border-t border-line bg-bg/90 p-4 backdrop-blur">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={save}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-inv-bg py-3 text-sm font-semibold text-inv-fg"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {saved ? (
                    <motion.span key="ok" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2">
                      <Check className="size-4" /> {s.saved}
                    </motion.span>
                  ) : (
                    <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {s.save}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
