import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['duckdb'],
  // Disable Turbopack — DuckDB native addon requires Webpack for proper externals handling
  bundlePagesRouterDependencies: false,
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        'duckdb',
      ]
    }
    return config
  },
};

export default nextConfig;
