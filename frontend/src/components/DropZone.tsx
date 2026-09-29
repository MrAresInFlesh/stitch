import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import LiquidButton from "./LiquidButton";

const ACCEPT = ".svg,.png,image/svg+xml,image/png";

type Props = {
  file: File | null;
  onSelect: (file: File | null) => void;
};

export default function DropZone({ file, onSelect }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onSelect(dropped);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) onSelect(picked);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center gap-3 border-2 border-dashed px-6 py-10 cursor-pointer transition-colors
        ${dragOver ? "border-border-subtle bg-bg-elevated" : "border-border bg-bg-surface"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleChange}
      />
      <span className="font-mono text-xs uppercase tracking-widest text-text-muted text-center">
        Drop SVG or PNG here
        <br />
        or click to select
      </span>

      {file && (
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">{file.name}</span>
          <LiquidButton
            variant="ghost"
            size="sm"
            label="×"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
