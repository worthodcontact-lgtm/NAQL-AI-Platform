/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0B1220",
        primary: {
          DEFAULT: "#2563EB",
          dark: "#1D4ED8"
        },
        teal: {
          DEFAULT: "#14B8A6",
          dark: "#0F9488"
        },
        success: "#16A34A",
        warning: "#D97706",
        error: "#DC2626",
        surface: "#FFFFFF",
        canvas: "#F5F7FB",
        slate: {
          700: "#111827",
          500: "#64748B",
          200: "#E2E8F0"
        }
      },
      fontFamily: {
        arabic: ["var(--font-arabic)", "sans-serif"]
      },
      boxShadow: {
        panel: "0 10px 30px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
};
