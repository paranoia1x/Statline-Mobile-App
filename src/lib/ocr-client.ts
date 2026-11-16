"use client";

/**
 * Screenshot OCR in the browser (self-hosted Tesseract assets under /ocr).
 *
 * Pick'em boards are dark-themed grids of cards, which raw OCR reads poorly:
 * it runs straight across columns and misses light text on dark backgrounds.
 * So the image is first split into card columns at the background gutters,
 * then each column is converted to dark-on-light, upscaled and read separately.
 */

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

interface Strip {
  canvas: HTMLCanvasElement;
}

function luminance(d: Uint8ClampedArray, i: number) {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/**
 * Split an image into vertical columns separated by background gutters.
 * First pass treats card backgrounds (slightly lighter than the page) as content, which isolates
 * each card column; second pass uses text only; otherwise the whole image is one column.
 */
function columnRanges(data: ImageData): [number, number][] {
  const { width: w, height: h, data: d } = data;
  const border: number[] = [];
  for (let x = 0; x < w; x += 4) border.push(luminance(d, x * 4), luminance(d, ((h - 1) * w + x) * 4));
  for (let y = 0; y < h; y += 4) border.push(luminance(d, y * w * 4), luminance(d, (y * w + w - 1) * 4));
  border.sort((a, b) => a - b);
  const bg = border[Math.floor(border.length / 2)];
  const step = Math.max(1, Math.floor(h / 400));
  const minWidth = Math.max(40, w * 0.08);
  for (const [threshold, frac] of [
    [6, 0.02],
    [14, 0.02],
  ]) {
    const busy: boolean[] = [];
    for (let x = 0; x < w; x++) {
      let n = 0;
      let total = 0;
      for (let y = 0; y < h; y += step) {
        total++;
        if (Math.abs(luminance(d, (y * w + x) * 4) - bg) > threshold) n++;
      }
      busy.push(n / total > frac);
    }
    const ranges: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const b = x < w && busy[x];
      if (b && start < 0) start = x;
      if (!b && start >= 0) {
        if (ranges.length && start - ranges[ranges.length - 1][1] < 6) ranges[ranges.length - 1][1] = x;
        else ranges.push([start, x]);
        start = -1;
      }
    }
    const cols = ranges.filter(([a, b]) => b - a >= minWidth);
    // a single column covering nearly everything is not a split
    if (cols.length > 1) return cols;
  }
  return [[0, w]];
}

/** Grayscale, invert dark themes to dark-on-light, stretch contrast and upscale for OCR. */
function prepareStrip(src: HTMLCanvasElement, x0: number, x1: number): Strip {
  const h = src.height;
  const scale = Math.min(3, Math.max(1, 1400 / Math.max(1, x1 - x0)));
  const c = document.createElement("canvas");
  c.width = Math.round((x1 - x0 + 16) * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, Math.max(0, x0 - 8), 0, x1 - x0 + 16, h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 16) sum += luminance(d, i);
  const dark = sum / (d.length / 16) < 128;
  for (let i = 0; i < d.length; i += 4) {
    let v = luminance(d, i);
    if (dark) v = 255 - v;
    v = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c };
}

async function loadCanvas(file: File | Blob) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d", { willReadFrequently: true })!.drawImage(bmp, 0, 0);
  return c;
}

async function toFullStrip(file: File | Blob): Promise<Strip[]> {
  const c = await loadCanvas(file);
  return [prepareStrip(c, 0, c.width)];
}

async function toStrips(file: File | Blob): Promise<Strip[]> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const cols = columnRanges(ctx.getImageData(0, 0, c.width, c.height));
  return cols.map(([a, b]) => prepareStrip(c, a, b));
}

interface Seg {
  text: string;
  x0: number;
  y0: number;
  y1: number;
}

/**
 * Rebuild visual rows from Tesseract's line boxes. Bet slips put the odds right-aligned, far
 * from the leg text; Tesseract's layout analysis reads them as a separate column. Segments that
 * overlap vertically by at least half their height are joined left-to-right into one row.
 */
function rowsFromLines(segs: Seg[]): string {
  const rows: { y0: number; y1: number; segs: Seg[] }[] = [];
  for (const s of [...segs].sort((a, b) => a.y0 - b.y0)) {
    const h = s.y1 - s.y0;
    const row = rows.find((r) => Math.min(r.y1, s.y1) - Math.max(r.y0, s.y0) >= 0.5 * Math.min(h, r.y1 - r.y0));
    if (row) {
      row.segs.push(s);
      row.y0 = Math.min(row.y0, s.y0);
      row.y1 = Math.max(row.y1, s.y1);
    } else rows.push({ y0: s.y0, y1: s.y1, segs: [s] });
  }
  return rows
    .sort((a, b) => a.y0 - b.y0)
    .map((r) => r.segs.sort((a, b) => a.x0 - b.x0).map((s) => s.text).join("   "))
    .join("\n");
}

export interface OcrOptions {
  /**
   * "grid" (default): pick'em boards — split into card columns and read each.
   * "rows": bet slips — read the full width and keep each visual row together (leg text + odds).
   */
  layout?: "grid" | "rows";
}

export async function ocrImage(file: File | Blob, onProgress?: (p: number) => void, opts: OcrOptions = {}): Promise<string> {
  const { createWorker, PSM } = await import("tesseract.js");
  const rows = opts.layout === "rows";
  let strips: Strip[];
  try {
    strips = rows ? await toFullStrip(file) : await toStrips(file);
  } catch (e) {
    console.warn("[ocr] preprocessing failed, reading original image:", e);
    strips = []; // preprocessing unsupported: read the original image
  }
  let done = 0;
  const parts = Math.max(1, strips.length);
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && onProgress?.((done + m.progress) / parts),
  });
  try {
    // automatic page segmentation keeps large, isolated numbers (the lines) that "single block" mode drops
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    if (rows) {
      const { data } = await worker.recognize(strips[0]?.canvas ?? file, {}, { text: true, blocks: true });
      const segs: Seg[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) if (l.text.trim()) segs.push({ text: l.text.trim(), x0: l.bbox.x0, y0: l.bbox.y0, y1: l.bbox.y1 });
      return segs.length ? rowsFromLines(segs) : data.text;
    }
    if (!strips.length) return (await worker.recognize(file)).data.text;
    const texts: string[] = [];
    for (const s of strips) {
      texts.push((await worker.recognize(s.canvas)).data.text);
      done++;
    }
    return texts.join("\n\n");
  } finally {
    await worker.terminate();
  }
}
