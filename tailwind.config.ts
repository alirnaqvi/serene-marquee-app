import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F8F5EC",
        surface: "#FFFFFF",
        ink: "#1B1810",
        muted: "#8A8168",
        border: "#EAE3CC",
        primary: "#15130F",
        "primary-light": "#2A2620",
        "primary-dim": "#F3E9C4",
        gold: "#B8912E",
        "gold-deep": "#8A6A1E",
        "gold-light": "#F4E7BE",
        rose: "#8C3B32",
        "rose-light": "#F3E0DA",
        emerald: "#2F5D4E",
        "emerald-light": "#E4EFEA",
      },
      fontFamily: {
        serif: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,18,16,0.05), 0 12px 32px -16px rgba(20,18,16,0.18)",
        "card-hover": "0 2px 4px rgba(20,18,16,0.06), 0 20px 42px -16px rgba(20,18,16,0.24)",
        gold: "0 8px 24px -10px rgba(184,145,46,0.45)",
      },
      borderRadius: {
        xl2: "1.1rem",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.4s ease-in-out infinite",
        fadeUp: "fadeUp 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
