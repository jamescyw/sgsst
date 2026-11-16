import type { NextConfig } from "next";

const config: NextConfig = {
  async rewrites() {
    return [{
      source: "/backend/:path*",
      destination: `${process.env.API_URL || "http://127.0.0.1:8000"}/:path*`,
    }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [{
        key: "Content-Security-Policy",
        value: "frame-ancestors https://intranet-v2.crepesywaffles.com",
      }],
    }];
  },
};

export default config;
