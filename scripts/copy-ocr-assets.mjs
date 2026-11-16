// Copies the OCR worker, the LSTM WASM cores and English language data into public/ocr so
// screenshot OCR runs self-hosted (no third-party CDN). Only the LSTM cores are copied —
// that is the engine tesseract.js uses by default — to keep the app download small.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "public", "ocr");
fs.mkdirSync(path.join(out, "core"), { recursive: true });
fs.mkdirSync(path.join(out, "lang"), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(out, to));
copy("node_modules/tesseract.js/dist/worker.min.js", "worker.min.js");
const coreDir = "node_modules/tesseract.js-core";
for (const f of fs.readdirSync(path.join(root, coreDir))) if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) copy(`${coreDir}/${f}`, `core/${f}`);
copy("node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz", "lang/eng.traineddata.gz");
console.log("[ocr] assets copied to public/ocr");
