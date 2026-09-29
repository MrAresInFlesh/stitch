const v = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base":        v("bg-base"),
        "bg-surface":     v("bg-surface"),
        "bg-elevated":    v("bg-elevated"),
        border:           v("border"),
        "border-subtle":  v("border-subtle"),
        "text-primary":   v("text-primary"),
        "text-secondary": v("text-secondary"),
        "text-muted":     v("text-muted"),
        "text-faint":     v("text-faint"),
        accent:           v("accent"),
        "accent-dim":     v("accent-dim"),
        "accent-bright":  v("accent-bright"),
        gold:             v("gold"),
      },
      fontFamily: {
        display: ['"Bebas Neue"', "sans-serif"],
        body:    ['"Barlow Condensed"', "sans-serif"],
        mono:    ['"Space Mono"', "monospace"],
      },
      borderRadius: {
        DEFAULT: "0",
        sm: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0",
        modal: "4px",
      },
    },
  },
};
