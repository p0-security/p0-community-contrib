#!/usr/bin/env node

import esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["./src/index.ts"],
    // Bundling + minification is the primary reason for adding esbuild, as it cuts
    // down the size of the Lambda function significantly, from >80MB to ~1MB.
    bundle: true,
    minify: true,
    sourcemap: true,
    banner: {
      js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);"
    },
    format: "esm",
    platform: "node",
    // Keep this in sync w/ Lambda runtime!
    target: "es2022",
    outfile: "dist/index.mjs",
  })
  .then(() => {
    console.log("Bundling succeeded.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
