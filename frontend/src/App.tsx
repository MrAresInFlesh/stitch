import { useState } from "react";
import DropZone from "./components/DropZone";
import LiquidButton from "./components/LiquidButton";
import StatusBar, { type Status } from "./components/StatusBar";
import ThresholdSlider, { THRESHOLD_DEFAULT } from "./components/ThresholdSlider";
import SvgPreview from "./components/SvgPreview";
import ResultCard from "./components/ResultCard";
import { traceFile, stitchSvg } from "./api";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [threshold, setThreshold] = useState<number>(THRESHOLD_DEFAULT);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [tracedSvg, setTracedSvg] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null);

  function reset() {
    setStatus("idle");
    setErrorMessage("");
    setTracedSvg(null);
    setResult(null);
  }

  function handleSelect(next: File | null) {
    setFile(next);
    reset();
  }

  function handleStartOver() {
    setFile(null);
    reset();
  }

  const stem = file ? file.name.replace(/\.[^.]+$/, "") : "design";

  // Step 1: PNG/SVG -> normalized SVG (POST /trace). Stops here (status
  // "traced") so the user can see what actually got traced before
  // committing to the slower stitch-generation step below.
  async function handleTrace() {
    if (!file) return;
    setStatus("tracing");
    setErrorMessage("");

    const res = await traceFile(file, threshold);

    if (res.status === "ok") {
      setTracedSvg(res.svgText);
      setStatus("traced");
    } else {
      setErrorMessage(res.message);
      setStatus("error");
    }
  }

  // Step 2: traced SVG -> DST/PES/threadlist zip (POST /stitch).
  async function handleStitch() {
    if (!tracedSvg) return;
    setStatus("stitching");
    setErrorMessage("");

    const res = await stitchSvg(tracedSvg, `${stem}.svg`);

    if (res.status === "ok") {
      setResult(res);
      setStatus("done");
    } else {
      setErrorMessage(res.message);
      setStatus("error");
    }
  }

  const showPreview = tracedSvg !== null;
  // Once step 1 has produced a preview, SvgPreview's own "Continue to
  // DST" button is the retry action for a step-2 failure — don't show
  // this (step-1) button again, or a step-2 error would show both.
  const showTraceButton = !showPreview && (status === "idle" || status === "tracing" || status === "error");

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-[640px] flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-5xl tracking-[0.2em]">SJEL STITCH</h1>
          <p className="font-mono text-xs text-text-muted uppercase">
            SVG → DST Converter
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <DropZone file={file} onSelect={handleSelect} />

          {showTraceButton && (
            <>
              <ThresholdSlider
                value={threshold}
                onChange={setThreshold}
                disabled={status === "tracing"}
              />
              <LiquidButton
                variant="primary"
                label="Convert to SVG"
                disabled={!file || status === "tracing"}
                onClick={handleTrace}
              />
            </>
          )}
        </div>

        <StatusBar status={status} message={errorMessage} />

        {showPreview && (
          <SvgPreview
            svgText={tracedSvg}
            filename={`${stem}.svg`}
            onContinue={handleStitch}
            stitching={status === "stitching"}
            done={status === "done"}
          />
        )}

        {result && <ResultCard blob={result.blob} filename={result.filename} />}

        {(showPreview || status === "error") && (
          <LiquidButton variant="ghost" size="sm" label="Start over" onClick={handleStartOver} />
        )}
      </div>
    </div>
  );
}
