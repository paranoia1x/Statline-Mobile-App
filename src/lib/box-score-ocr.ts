import type { ScreenshotWord } from "@/lib/parse/box-score";

export async function recognizeBoxScore(file: File, onProgress: (progress: number) => void): Promise<ScreenshotWord[]> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const assets = new URL("ocr/", new URL(import.meta.env.BASE_URL, window.location.href));
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: new URL("worker.min.js", assets).href,
    corePath: new URL("core/", assets).href,
    langPath: new URL("lang/", assets).href,
    workerBlobURL: false,
    logger: ({ status, progress }) => {
      if (status === "recognizing text") onProgress(progress);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(file, {}, { blocks: true, text: false });
    return (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
    );
  } finally {
    await worker.terminate();
  }
}
