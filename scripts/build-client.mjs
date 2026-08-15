import { mkdir } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const outdir = path.resolve("public/generated");
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: [path.resolve("client/index.ts")],
  outfile: path.join(outdir, "rich-editor.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  logLevel: "info",
});
