import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',

  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,

  // Image optimization for static export
  images: {
    unoptimized: true,
  },

  // Experimental: optimize package imports for better tree-shaking
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-scroll-area', '@radix-ui/react-separator', '@radix-ui/react-slot'],
  },
};

export default nextConfig;
