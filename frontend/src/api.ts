async function readError(res: Response): Promise<string> {
  const { detail } = await res.json().catch(() => ({ detail: "Unknown error" }));
  return detail;
}

// --- Step 1: upload -> normalized/traced SVG (backend POST /trace) ---
export type TraceResult =
  | { status: "ok";    svgText: string }
  | { status: "error"; message: string };

export async function traceFile(file: File, threshold: number): Promise<TraceResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("threshold", String(threshold));

  const res = await fetch("/stitch/api/trace", { method: "POST", body });

  if (!res.ok) {
    return { status: "error", message: await readError(res) };
  }

  return { status: "ok", svgText: await res.text() };
}

// --- Step 2: traced SVG -> DST/PES/threadlist zip (backend POST /stitch) ---
export type ConvertResult =
  | { status: "ok";    blob: Blob; filename: string }
  | { status: "error"; message: string };

export async function stitchSvg(svgText: string, filename: string): Promise<ConvertResult> {
  const body = new FormData();
  body.append("file", new Blob([svgText], { type: "image/svg+xml" }), filename);

  const res = await fetch("/stitch/api/stitch", { method: "POST", body });

  if (!res.ok) {
    return { status: "error", message: await readError(res) };
  }

  const blob = await res.blob();
  const outFilename =
    res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1]
    ?? "embroidery.zip";

  return { status: "ok", blob, filename: outFilename };
}
