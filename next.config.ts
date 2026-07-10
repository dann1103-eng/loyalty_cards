import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["passkit-generator"],
  outputFileTracingIncludes: {
    "/api/**": ["./passModels/**/*"],
  },
};

export default nextConfig;
