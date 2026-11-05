// Shared types used by both the client UI and the API routes.

export type Role = "user" | "assistant";

export type StepStatus = "running" | "done" | "error";

export interface Step {
  id: string;
  tool: string;
  label: string;
  detail?: string;
  status: StepStatus;
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
  | { type: "steps"; steps: Step[] }
  | { type: "products"; offers: Offer[]; note?: string }
  | {
      type: "approval";
      offer: Offer;
      status: ApprovalStatus;
      orderId?: string;
      authorizationId?: string;
      holdExpiresAt?: number;
      message?: string;
    }
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
};

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
  | { type: "block"; block: Block }
  | { type: "error"; message: string }
  | { type: "done" };

/** Message format the client sends to /api/chat (already trimmed for the model). */
export interface WireMessage {
  role: Role;
  text: string;
  images?: string[]; // data URLs, only sent for the latest user turn
}
