import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright", "nodemailer"],
  // Local ./data/*.sqlite is created at runtime (and /tmp on Vercel); never bundle it.
  outputFileTracingExcludes: {
    "*": ["./data/*.sqlite", "./data/*.sqlite-*", "./data/*.db"],
  },
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
