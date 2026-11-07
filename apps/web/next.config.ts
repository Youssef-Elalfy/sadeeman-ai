import type { NextConfig } from "next";

const target = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";

const localTarget = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(target);
const backend = new URL(target);
const remoteTarget =
  backend.protocol === "https:" &&
  backend.origin === target &&
  !backend.username &&
  !backend.password &&
  backend.hostname.endsWith(".up.railway.app");
if (
  (!localTarget && !remoteTarget) ||
  (process.env.VERCEL_ENV === "production" && !remoteTarget)
) {
  throw new Error(
    "API_ORIGIN must be an HTTPS Railway origin for Vercel production, or loopback for local development",
  );
}

const config: NextConfig = {
  poweredByHeader: false,

  experimental: {
    // Cover the API's maximum allowed 120s turn plus its SSE close grace.
    // Agent budgets stay unchanged. Heartbeats still run every 15s.
    proxyTimeout: 125_000,
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${target}/api/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "microphone=(self), camera=()",
          },
        ],
      },
    ];
  },
};

export default config;
