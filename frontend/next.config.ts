import type { NextConfig } from "next";

// NEXT_PUBLIC_* values are baked in at build time. On Vercel a missing one would silently ship the
// localhost default (src/lib/env.ts), so fail the build instead. Local dev keeps the defaults.
if (process.env.VERCEL) {
  const required = ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}: set them in Vercel -> Project -> Settings -> Environment Variables (see DEPLOY.md).`);
  }
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["@coral-xyz/anchor"],

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
