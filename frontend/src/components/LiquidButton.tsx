import type { ButtonHTMLAttributes } from "react";

// Replicated from Discovery (README §5.6): four L-shaped corner ticks
// (two border lines each, positioned absolutely). On hover the ticks
// extend and the button inverts to a solid accent ground / bg-base
// label, as a CSS-only transition.
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
  size?: "default" | "sm";
  label: string;
};

const TICK = "absolute w-3 h-3 border-accent transition-all duration-150 group-hover:w-4 group-hover:h-4";

export default function LiquidButton({
  variant = "primary",
  size = "default",
  label,
  className = "",
  disabled,
  ...rest
}: Props) {
  const pad = size === "sm" ? "px-3 py-1.5" : "px-6 py-3";
  const base =
    variant === "primary"
      ? "bg-transparent text-text-primary group-hover:bg-accent group-hover:text-bg-base"
      : "bg-transparent text-text-muted group-hover:bg-accent-dim/20 group-hover:text-text-primary";

  return (
    <button
      {...rest}
      disabled={disabled}
      className={`group relative inline-flex items-center justify-center font-mono uppercase tracking-widest text-sm
        ${pad} ${base} border border-border transition-colors duration-150
        disabled:opacity-30 disabled:pointer-events-none ${className}`}
    >
      <span className={`${TICK} top-0 left-0 border-t-2 border-l-2`} />
      <span className={`${TICK} top-0 right-0 border-t-2 border-r-2`} />
      <span className={`${TICK} bottom-0 left-0 border-b-2 border-l-2`} />
      <span className={`${TICK} bottom-0 right-0 border-b-2 border-r-2`} />
      {label}
    </button>
  );
}
