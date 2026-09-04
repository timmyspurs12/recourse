import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sandboxed/proxied preview hosts used during development.
  allowedDevOrigins: ["*.e2b.app", "*.localhost"],
};

export default nextConfig;
