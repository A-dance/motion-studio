import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Three.js はブラウザ専用なので SSR を無効化
  transpilePackages: ["three"],
};

export default nextConfig;
