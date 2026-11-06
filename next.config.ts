import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Real Chromium for the agent's browser tool: keep it out of the bundle and
  // ship its compressed binary with the chat function only.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/chat": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/browser-check": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
