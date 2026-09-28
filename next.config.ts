import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },

  serverExternalPackages: [
    "firebase-admin",
    "jwks-rsa",
    "jose",
  ],
};

export default nextConfig;