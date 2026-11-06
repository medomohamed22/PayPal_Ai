"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { formatMoney } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/**
 * PayPal Pay Later messaging (official JS SDK "messages" component) on the
 * approval card. The buyer picks Pay Later inside the PayPal window; this shows
 * the offer up front. Falls back to a plain line if the SDK can't load.
 */
type PayPalNS = {
  Messages: (o: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void> };
};

let sdk: Promise<PayPalNS | null> | null = null;

function loadSdk(): Promise<PayPalNS | null> {
  if (sdk) return sdk;
  sdk = fetch("/api/paypal/status")
    .then((r) => r.json())
    .then((c: { clientId?: string | null; env?: string }) => {
      if (!c.clientId) return null;
      return new Promise<PayPalNS | null>((resolve) => {
        const s = document.createElement("script");
        const params = new URLSearchParams({ "client-id": c.clientId!, components: "messages", currency: "USD" });
        // buyer-country is only honored in sandbox — lets the demo show US offers anywhere.
        if (c.env === "sandbox") params.set("buyer-country", "US");
        s.src = `https://www.paypal.com/sdk/js?${params}`;
        s.async = true;
        s.dataset.namespace = "paypalDalil";
        s.dataset.pageType = "checkout";
        s.onload = () => resolve((window as unknown as { paypalDalil?: PayPalNS }).paypalDalil ?? null);
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    })
    .catch(() => null);
  return sdk;
}

export default function PayLaterMessage({ amount, currency, lang }: { amount: number; currency: string; lang: Lang }) {
  const ref = useRef<HTMLDivElement>(null);
  // Our own line shows immediately; PayPal's official message replaces it only once it really renders.
  const [official, setOfficial] = useState(false);
  const eligible = currency === "USD" && amount >= 30 && amount <= 10000;

  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    let poll: ReturnType<typeof setInterval> | undefined;
    setOfficial(false);
    loadSdk().then(async (pp) => {
      if (!alive || !pp || !ref.current) return;
      try {
        ref.current.innerHTML = "";
        const dark = document.documentElement.classList.contains("dark");
        await pp
          .Messages({
            amount,
            currency: "USD",
            placement: "payment",
            style: { layout: "text", logo: { type: "inline" }, text: { color: dark ? "white" : "monochrome", size: 12 } },
          })
          .render(ref.current);
        let tries = 0;
        poll = setInterval(() => {
          const h = ref.current?.querySelector("iframe")?.getBoundingClientRect().height ?? 0;
          if (h > 8 && alive) setOfficial(true);
          if (h > 8 || ++tries > 16) clearInterval(poll);
        }, 250);
      } catch {
        /* keep our own line */
      }
    });
    return () => {
      alive = false;
      if (poll) clearInterval(poll);
    };
  }, [amount, eligible]);

  if (!eligible) return null;
  const ar = lang === "ar";
  const inFour = amount <= 1500;
  const part = formatMoney(Math.round((amount / 4) * 100) / 100, "USD", "en");
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      {/* Rendered off-screen until PayPal's iframe has real height, then swapped in. */}
      <div ref={ref} className={official ? "" : "pointer-events-none absolute -left-[9999px] w-[340px]"} dir="ltr" />
      {!official && (
        <div className="flex items-center gap-2 text-[12px] text-fg-soft" dir="auto">
          <CalendarClock className="size-3.5 shrink-0" />
          <span>
            {inFour
              ? ar
                ? <>قسّطها مع <b className="font-semibold text-fg">PayPal Pay Later</b>: ٤ دفعات × <bdi dir="ltr">{part}</bdi> من غير فوايد — اختار «Pay Later» في شباك PayPal</>
                : <>Pay later with <b className="font-semibold text-fg">PayPal</b>: 4 interest-free payments of {part} — choose “Pay Later” in the PayPal window</>
              : ar
                ? <>قسّطها شهريًا مع <b className="font-semibold text-fg">PayPal Pay Monthly</b> — اختار «Pay Later» في شباك PayPal</>
                : <>Pay monthly with <b className="font-semibold text-fg">PayPal Pay Later</b> — choose “Pay Later” in the PayPal window</>}
          </span>
        </div>
      )}
    </div>
  );
}
