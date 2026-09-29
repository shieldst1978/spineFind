import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WebAssembly Postgres build; load it from node_modules at
  // runtime instead of bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    // Film posters from TMDB.
    remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org", pathname: "/t/p/**" }],
  },
};

export default nextConfig;
