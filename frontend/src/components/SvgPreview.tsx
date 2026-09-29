import { useEffect, useState } from "react";
import LiquidButton from "./LiquidButton";

type Props = {
  svgText: string;
  filename: string;
  onContinue: () => void;
  stitching: boolean;
  done: boolean;
};

// Shown between step 1 (trace) and step 2 (stitch) so the user can see
// what actually got traced — and bail before running the slower
// auto-fill/routing step on something that looks wrong — instead of
// only finding out after the fact. Rendered via an <img> + object URL
// rather than dangerouslySetInnerHTML: images never execute embedded
// script/event-handler content even if potrace's output ever did
// (it doesn't, but this is free insurance and simpler either way).
export default function SvgPreview({ svgText, filename, onContinue, stitching, done }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [svgText]);

  function handleDownload() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="bg-bg-surface border border-border p-4 flex flex-col gap-4">
      <span className="font-mono text-xs uppercase tracking-widest text-text-muted">
        Traced SVG — review before generating stitches
      </span>

      <div className="bg-white p-3 flex items-center justify-center min-h-[120px]">
        {url && (
          <img src={url} alt="Traced design preview" className="max-h-72 max-w-full" />
        )}
      </div>

      <div className="flex gap-2">
        {!done && (
          <LiquidButton
            variant="primary"
            label={stitching ? "Generating…" : "Continue to DST"}
            disabled={stitching}
            onClick={onContinue}
            className="flex-1"
          />
        )}
        <LiquidButton
          variant="ghost"
          label="↓ Download SVG"
          disabled={!url}
          onClick={handleDownload}
          className={done ? "flex-1" : undefined}
        />
      </div>
    </div>
  );
}
