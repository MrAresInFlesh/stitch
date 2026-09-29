// Mirrors backend/main.py's THRESHOLD_MIN/MAX/DEFAULT — potrace's -k/
// --blacklevel cutoff (0-1 in potrace itself). Max kept well below 1.0
// on purpose: a higher cutoff pulls in more midtone detail as traced
// regions, which is the same axis that caused the complexity hang in
// docs/HOTSPOTS.md HOTSPOT-005/006/007. The backend clamps server-side
// regardless, but the slider itself shouldn't offer unsafe values.
export const THRESHOLD_MIN = 0.2;
export const THRESHOLD_MAX = 0.65;
export const THRESHOLD_DEFAULT = 0.5;

type Props = {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
};

export default function ThresholdSlider({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-text-muted">
          Threshold
        </span>
        <span className="font-mono text-xs text-text-secondary">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={THRESHOLD_MIN}
        max={THRESHOLD_MAX}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent disabled:opacity-30"
      />
    </div>
  );
}
