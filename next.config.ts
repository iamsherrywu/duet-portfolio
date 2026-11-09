import type { NextConfig } from 'next';
import { canonicalSiteUrl } from './src/lib/site-url';

const config: NextConfig = {
  // Deployment metadata can differ between build and function runtime.
  // Capture only the trusted public origin; never inline credentials.
  env: { DUET_DEPLOY_ORIGIN: canonicalSiteUrl(process.env) },
};

export default config;
