"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, ImagePlus, Link2, Loader2, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Strings } from "@/lib/i18n";
import type { LinkPreview } from "@/lib/types";

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** Downscale images client-side so they stay small in IndexedDB and in requests. */
async function compressImage(file: File, max = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export interface ComposerPayload {
  text: string;
  images: string[];
  links: LinkPreview[];
}

export default function Composer({
  s,
  busy,
  onSend,
  onStop,
  prefill,
}: {
  s: Strings;
  busy: boolean;
  onSend: (p: ComposerPayload) => void;
  onStop: () => void;
  prefill?: { text: string; n: number };
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, LinkPreview | "loading">>({});
  const [drag, setDrag] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      taRef.current?.focus();
    }
  }, [prefill]);

  // Auto-grow
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [text]);

  // Fetch link previews for pasted URLs (debounced)
  const urls = Array.from(new Set(text.match(URL_RE) ?? [])).slice(0, 3);
  const urlsKey = urls.join(" ");
  useEffect(() => {
    const id = setTimeout(() => {
      for (const u of urlsKey ? urlsKey.split(" ") : []) {
        if (previews[u]) continue;
        setPreviews((p) => ({ ...p, [u]: "loading" }));
        fetch(`/api/preview?url=${encodeURIComponent(u)}`)
          .then((r) => r.json())
          .then((pv: LinkPreview) => setPreviews((p) => ({ ...p, [u]: { ...pv, url: pv.url ?? u } })))
          .catch(() => setPreviews((p) => ({ ...p, [u]: { url: u } })));
      }
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, 4 - images.length);
    const out = await Promise.all(list.map((f) => compressImage(f)));
    setImages((x) => [...x, ...out].slice(0, 4));
  }

  function send() {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed && !images.length) return;
    const links = urls
      .map((u) => previews[u])
      .map((p, i) => (p && p !== "loading" ? p : { url: urls[i] }));
    onSend({ text: trimmed, images, links });
    setText("");
    setImages([]);
    setPreviews({});
  }

  const canSend = !!(text.trim() || images.length);

  return (
    <div
      className={`relative rounded-[1.6rem] border bg-bg shadow-card transition-colors ${drag ? "border-fg" : "border-line"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <AnimatePresence>
        {(images.length > 0 || urls.length > 0) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3"
          >
            {images.map((src, i) => (
              <motion.div key={i} layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="size-16 rounded-xl border border-line object-cover" />
                <button
                  onClick={() => setImages((x) => x.filter((_, j) => j !== i))}
                  className="absolute -end-1.5 -top-1.5 rounded-full bg-inv-bg p-0.5 text-inv-fg"
                  aria-label="Remove"
                >
                  <X className="size-3" />
                </button>
              </motion.div>
            ))}
            {urls.map((u) => {
              const p = previews[u];
              const pv = p && p !== "loading" ? p : undefined;
              let host = u;
              try {
                host = new URL(u).hostname.replace(/^www\./, "");
              } catch {}
              return (
                <motion.div
                  key={u}
                  layout
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex h-16 w-60 shrink-0 items-center gap-2 overflow-hidden rounded-xl border border-line bg-bg-soft pe-2"
                >
                  {pv?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pv.image} alt="" referrerPolicy="no-referrer" className="h-full w-16 bg-white object-contain" />
                  ) : (
                    <div className="flex h-full w-12 items-center justify-center text-fg-muted">
                      {p === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-fg-muted">{host}</div>
                    <div className="line-clamp-2 text-xs font-medium leading-tight">{pv?.title ?? u}</div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-1.5 p-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="mb-0.5 shrink-0 rounded-full p-2.5 text-fg-muted transition-colors hover:bg-bg-soft hover:text-fg"
          aria-label={s.attach}
          title={s.attach}
        >
          <ImagePlus className="size-5" strokeWidth={1.75} />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          dir="auto"
          value={text}
          placeholder={s.placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-[200px] min-h-[2.75rem] flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-6 outline-none placeholder:text-fg-muted"
        />
        <AnimatePresence mode="wait" initial={false}>
          {busy ? (
            <motion.button
              key="stop"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              onClick={onStop}
              className="mb-0.5 shrink-0 rounded-full bg-inv-bg p-2.5 text-inv-fg"
              aria-label={s.stop}
            >
              <Square className="size-4 fill-current" />
            </motion.button>
          ) : (
            <motion.button
              key="send"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              whileTap={{ scale: 0.9 }}
              onClick={send}
              disabled={!canSend}
              className="mb-0.5 shrink-0 rounded-full bg-inv-bg p-2.5 text-inv-fg transition-opacity disabled:opacity-25"
              aria-label={s.send}
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
