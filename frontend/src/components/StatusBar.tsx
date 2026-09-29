export type Status = "idle" | "tracing" | "traced" | "stitching" | "error" | "done";

type Props = {
  status: Status;
  message?: string;
};

// idle      → hidden
// tracing   → step 1 running,   POST /trace   (PNG/SVG -> normalized SVG)
// traced    → step 1 complete,  preview shown below, awaiting user confirm
// stitching → step 2 running,   POST /stitch  (SVG -> DST/PES/threadlist)
// error     → "CONVERSION FAILED" (text-muted), message below (text-faint text-xs)
// done      → step 2 complete,  "READY" (text-accent)
const LABEL: Record<Status, string> = {
  idle: "",
  tracing: "Step 1/2 — Converting to SVG…",
  traced: "Step 1/2 complete — review below",
  stitching: "Step 2/2 — Generating stitches…",
  error: "Conversion failed",
  done: "Step 2/2 complete — ready to download",
};

// Shown as a small caption so it's visible which backend function is
// doing the work at each step, not just a generic spinner label.
const ENDPOINT: Partial<Record<Status, string>> = {
  tracing: "POST /trace  →  potrace",
  stitching: "POST /stitch  →  inkstitch",
};

export default function StatusBar({ status, message }: Props) {
  if (status === "idle") return null;

  const busy = status === "tracing" || status === "stitching";
  const labelColor = status === "done" || status === "traced" ? "text-accent" : "text-text-muted";

  return (
    <div
      className={`border border-border px-4 py-3 ${busy ? "animate-border-pulse" : ""}`}
    >
      <div className={`font-mono text-xs uppercase tracking-widest ${labelColor}`}>
        {LABEL[status]}
      </div>
      {ENDPOINT[status] && (
        <div className="font-mono text-[10px] text-text-faint mt-1">
          {ENDPOINT[status]}
        </div>
      )}
      {status === "error" && message && (
        <div className="font-mono text-xs text-text-faint mt-1">{message}</div>
      )}
    </div>
  );
}
