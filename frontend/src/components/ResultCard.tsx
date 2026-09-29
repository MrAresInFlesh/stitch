import LiquidButton from "./LiquidButton";

type Props = {
  blob: Blob;
  filename: string;
};

// Shown only on success (§5.8). Triggers createObjectURL + auto-click
// anchor on download; card stays visible until a new file is selected.
export default function ResultCard({ blob, filename }: Props) {
  function handleDownload() {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-bg-surface border border-border p-6 flex flex-col gap-4">
      <span className="inline-block self-start font-mono text-xs uppercase tracking-widest px-2 py-1 border border-accent bg-accent/10 text-accent">
        DST + PES + THREAD LIST
      </span>
      <span className="text-2xl truncate">{filename}</span>
      <LiquidButton variant="primary" label="↓ DOWNLOAD" onClick={handleDownload} />
    </div>
  );
}
