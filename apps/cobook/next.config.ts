import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@codoc/core"],
  webpack(config) {
    // Map .js extensions to .ts for @codoc/core (ESM convention)
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts"],
      ".jsx": [".jsx", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
