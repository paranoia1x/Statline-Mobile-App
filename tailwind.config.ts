import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // every colour is a CSS variable (src/app/themes.css) so themes and accents can swap at runtime
      colors: {
        white: "rgb(var(--fg-max) / <alpha-value>)",
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          750: "rgb(var(--ink-750) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
        },
        pos: { DEFAULT: "rgb(var(--pos) / <alpha-value>)", soft: "rgb(var(--pos) / 0.15)" },
        neg: { DEFAULT: "rgb(var(--neg) / <alpha-value>)", soft: "rgb(var(--neg) / 0.15)" },
        ai: { DEFAULT: "rgb(var(--ai) / <alpha-value>)", soft: "rgb(var(--ai) / 0.12)", blue: "rgb(var(--aiblue) / <alpha-value>)" },
        info: "rgb(var(--info) / <alpha-value>)",
        brand: { DEFAULT: "rgb(var(--brand) / <alpha-value>)", light: "rgb(var(--brand-light) / <alpha-value>)", bright: "rgb(var(--brand-bright) / <alpha-value>)", deep: "rgb(var(--brand-deep) / <alpha-value>)" },
        warn: { DEFAULT: "rgb(var(--warn) / <alpha-value>)" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: { card: "0 1px 0 0 rgba(255,255,255,0.03) inset" },
    },
  },
  plugins: [],
} satisfies Config;
