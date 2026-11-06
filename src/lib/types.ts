// Shared types used by both the client UI and the API routes.

export type Role = "user" | "assistant";

export type StepStatus = "running" | "done" | "error";

export interface Step {
  id: string;
  tool: string;
  label: string;
  detail?: string;
  status: StepStatus;
  /** Source sites discovered by this step (search results). */
  hosts?: string[];
}

export type TrustLevel = "verified" | "unknown" | "suspicious";

export interface Offer {
  id: string;
  title: string;
  image?: string;
  url?: string;
  store: string;
  storeDomain?: string;
  price: number;
  currency: string;
  shipping?: number;
  total: number;
  rating?: number;
  reviewCount?: number;
  distanceKm?: number;
  pickup?: boolean;
  deliveryDays?: number;
  trust: TrustLevel;
  flags: string[];
  badges: string[];
  reason?: string;
  score?: number;
  /** What PayPal will actually charge (EGP is charged in USD). */
  chargeAmount?: number;
  chargeCurrency?: string;
  fxRate?: number;
  /** Server signature over the offer — checkout refuses tampered offers. */
  sig?: string;
}

export type ApprovalStatus =
  | "pending"
  | "processing"
  | "held"
  | "captured"
  | "voided"
  | "declined"
  | "error";

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site?: string;
  price?: number;
  currency?: string;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; dataUrl: string; name?: string }
  | { type: "link"; preview: LinkPreview }
  | { type: "steps"; steps: Step[]; note?: string; startedAt?: number; endedAt?: number }
  | { type: "products"; offers: Offer[]; note?: string }
  | {
      type: "approval";
      offer: Offer;
      status: ApprovalStatus;
      orderId?: string;
      authorizationId?: string;
      holdExpiresAt?: number;
      message?: string;
      shipping?: { name?: string; address?: string };
      payerEmail?: string;
      captureId?: string;
      /** Set when this approval came from a price watch (server owns the hold). */
      watchId?: string;
      tracking?: { trackingNumber: string; carrier: string; addedAt: number };
      refund?: { id: string; status: string; reason: string; amount?: string; currency?: string };
    }
  | { type: "watchDraft"; offer: Offer; targetPrice?: number; mode?: WatchMode }
  | { type: "error"; text: string };

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  blocks: Block[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type Lang = "ar" | "en";
export type Market = "EG" | "US";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface Settings {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  market: Market;
  city: string;
  lang: Lang;
  demoMode: boolean;
  /** Spending mandate: max total per purchase in market currency (0 = no limit). */
  maxSpend: number;
  verifiedOnly: boolean;
  /** Optional precise location for distance to pickup stores. */
  coords?: { lat: number; lon: number } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  baseUrl: "https://api.meta.ai/v1",
  model: "muse-spark-1.3-contributor",
  reasoningEffort: "low",
  market: "EG",
  city: "Cairo",
  lang: "ar",
  demoMode: false,
  maxSpend: 0,
  verifiedOnly: true,
};

export const HOLD_MINUTES = 10;

export interface Mandate {
  maxSpend: number;
  verifiedOnly: boolean;
}

export const KNOWN_MODELS = [
  "muse-spark-1.3-contributor",
  "muse-spark-1.3",
  "muse-spark-1.2",
  "muse-spark-1.1",
];

/** Events streamed (as NDJSON) from /api/chat to the client. */
export type AgentEvent =
  | { type: "step"; step: Step }
  | { type: "text"; delta: string }
  /** Interim narration from a turn that continued with tools — shown in the activity bar. */
  | { type: "thought"; text: string }
  | { type: "block"; block: Block }
  | { type: "error"; message: string }
  | { type: "done" };

/** Message format the client sends to /api/chat (already trimmed for the model). */
export interface WireMessage {
  role: Role;
  text: string;
  images?: string[]; // data URLs, only sent for the latest user turn
}

/* ---------------- Price watches ---------------- */

export type WatchMode = "notify" | "auto";
export type WatchStatus = "active" | "triggered" | "held" | "bought" | "cancelled" | "error";

export interface PricePoint {
  t: number;
  price: number;
}

export interface WatchHold {
  orderId: string;
  authorizationId: string;
  captureAt: number;
  amount: string;
  currency: string;
  shipping?: { name?: string; address?: string };
}

/** Public view of a watch (what the browser sees). */
export interface Watch {
  id: string;
  title: string;
  store: string;
  url?: string;
  image?: string;
  currency: string;
  market: Market;
  shipping: number;
  trust: TrustLevel;
  targetPrice: number;
  mode: WatchMode;
  maxSpend: number;
  source: "live" | "demo";
  status: WatchStatus;
  lastPrice?: number;
  history: PricePoint[];
  createdAt: number;
  lastCheckedAt?: number;
  /** Signed offer at the triggered price — used for the approve flow. */
  triggeredOffer?: Offer;
  hold?: WatchHold;
  captureId?: string;
  message?: string;
}
