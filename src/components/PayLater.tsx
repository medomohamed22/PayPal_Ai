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
  const [state, setState] = useState<"loading" | "sdk" | "fallback">("loading");
  const eligible = currency === "USD" && amount >= 30 && amount <= 10000;

  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    const timer = setTimeout(() => alive && setState((s) => (s === "loading" ? "fallback" : s)), 5000);
    loadSdk().then(async (pp) => {
      if (!alive) return;
      if (!pp || !ref.current) return setState("fallback");
      try {
        const dark = document.documentElement.classList.contains("dark");
        await pp
          .Messages({
            amount,
            currency: "USD",
            placement: "payment",
            style: { layout: "text", logo: { type: "inline" }, text: { color: dark ? "white" : "monochrome", size: 12 } },
          })
          .render(ref.current);
        if (alive) setState(ref.current?.childElementCount ? "sdk" : "fallback");
      } catch {
        if (alive) setState("fallback");
      }
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [amount, eligible]);

  if (!eligible) return null;
  const ar = lang === "ar";
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <div ref={ref} className={state === "fallback" ? "hidden" : "min-h-[18px]"} dir="ltr" />
      {state === "fallback" && (
        <div className="flex items-center gap-2 text-[12px] text-fg-soft" dir="auto">
          <CalendarClock className="size-3.5 shrink-0" />
          <span>
            {ar
              ? `أو قسّطها مع PayPal Pay Later: ٤ دفعات × ${formatMoney(Math.round((amount / 4) * 100) / 100, "USD", "en")} من غير فوايد — اختار «Pay Later» في شباك PayPal`
              : `Or pay later with PayPal: 4 interest-free payments of ${formatMoney(Math.round((amount / 4) * 100) / 100, "USD", "en")} — choose “Pay Later” in the PayPal window`}
          </span>
        </div>
      )}
    </div>
  );
}
