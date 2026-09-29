import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the container image (.next/standalone).
  output: "standalone",
  // Load these from node_modules at runtime instead of bundling them: PGlite
  // ships a WebAssembly Postgres build, and the container's start script
  // (scripts/start.mjs) imports drizzle's migrator and pg directly.
  serverExternalPackages: ["@electric-sql/pglite", "drizzle-orm", "pg"],
  images: {
    // Film posters from TMDB.
    remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org", pathname: "/t/p/**" }],
  },
};

export default nextConfig;
