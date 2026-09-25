// Serve the pdf.js worker as a static file instead of bundling it: webpack's
// Terser pass cannot minify the ES-module worker, and keeping it out of git
// keeps the repository small. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const dest = path.join(process.cwd(), "public", "pdf.worker.min.mjs");
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`copied pdf.js worker -> ${path.relative(process.cwd(), dest)}`);
