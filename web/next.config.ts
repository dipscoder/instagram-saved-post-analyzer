import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared workspace ships TypeScript source, not a build.
  transpilePackages: ['@saved-index/shared'],
};

export default config;
