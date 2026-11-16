import type { NextConfig } from "next";

const config: NextConfig = {
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
