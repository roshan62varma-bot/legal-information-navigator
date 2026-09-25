import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: token("paper"),
        sheet: token("sheet"),
        ink: token("ink"),
        "ink-soft": token("ink-soft"),
        rule: token("rule"),
        highlight: token("highlight"),
        "highlight-ink": token("highlight-ink"),
        redline: token("redline"),
        seal: token("seal"),
        amber: token("amber"),
        action: token("action"),
        "action-ink": token("action-ink"),
        focus: token("focus"),
        sev: {
          "critical-bg": token("sev-critical-bg"),
          "critical-fg": token("sev-critical-fg"),
          "high-bg": token("sev-high-bg"),
          "high-fg": token("sev-high-fg"),
          "medium-bg": token("sev-medium-bg"),
          "medium-fg": token("sev-medium-fg"),
          "low-bg": token("sev-low-bg"),
          "low-fg": token("sev-low-fg"),
        },
      },
      fontFamily: {
        serif: ["var(--font-caslon)", "Iowan Old Style", "Georgia", "serif"],
        sans: ["var(--font-public)", "system-ui", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        // Modular scale (1.25) anchored at 15px body.
        "2xs": ["0.75rem", { lineHeight: "1.05rem" }],
        xs: ["0.8rem", { lineHeight: "1.15rem" }],
        sm: ["0.875rem", { lineHeight: "1.3rem" }],
        base: ["0.9375rem", { lineHeight: "1.55rem" }],
        lg: ["1.125rem", { lineHeight: "1.65rem" }],
        xl: ["1.4rem", { lineHeight: "1.9rem" }],
        "2xl": ["1.75rem", { lineHeight: "2.2rem" }],
        "3xl": ["2.2rem", { lineHeight: "2.6rem" }],
        "4xl": ["2.75rem", { lineHeight: "3.05rem" }],
        "5xl": ["3.45rem", { lineHeight: "3.7rem" }],
      },
      borderRadius: {
        sheet: "3px",
        control: "7px",
        pill: "999px",
      },
      boxShadow: {
        sheet: "0 1px 0 rgb(var(--shadow) / 0.06), 0 8px 24px -12px rgb(var(--shadow) / 0.22)",
        lift: "0 18px 40px -18px rgb(var(--shadow) / 0.45)",
      },
      keyframes: {
        "caret-blink": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
        "sweep": { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
        "pulse-soft": { "0%,100%": { opacity: "0.55" }, "50%": { opacity: "1" } },
      },
      animation: {
        "caret-blink": "caret-blink 1s steps(1) infinite",
        sweep: "sweep 700ms cubic-bezier(.2,.7,.2,1) both",
        "pulse-soft": "pulse-soft 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
