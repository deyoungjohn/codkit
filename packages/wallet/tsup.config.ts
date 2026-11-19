import { defineConfig } from "tsup";
import { packageConfig } from "../../tsup.config.base";

// Every module here uses React hooks or browser wallets: mark the output for Next.js' App Router.
export default defineConfig(packageConfig(import.meta.dirname, { banner: { js: '"use client";' } }));
