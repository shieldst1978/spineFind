import type { NextConfig } from "next";
import { BASE_PATH } from "./src/lib/base-path";

const nextConfig: NextConfig = {
  // Served at tim-shields.com/spinefind.
  basePath: BASE_PATH,
  async redirects() {
    return [
      // The bare domain has nothing else on it (yet), so send visitors to the app.
      { source: "/", destination: BASE_PATH, basePath: false, permanent: false },
      // iPhones also look for the home screen icon at the site root.
      ...["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"].map((source) => ({
        source,
        destination: `${BASE_PATH}/apple-icon.png`,
        basePath: false as const,
        permanent: false,
      })),
      // A server action's redirect() in a plain (pre-JavaScript) form post is sent
      // without the base path, e.g. "/watches?logged=…". Catch those and put the
      // prefix back; with JavaScript running, Next adds it itself.
      ...["/watches/:path*", "/item/:path*", "/box/:path*", "/pick", "/add"].map((source) => ({
        source,
        destination: `${BASE_PATH}${source}`,
        basePath: false as const,
        permanent: false,
      })),
    ];
  },
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
