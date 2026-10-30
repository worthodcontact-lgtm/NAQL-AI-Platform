/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        navy: "#101C2D",
        primary: {
          DEFAULT: "#16B8C8",
          dark: "#119BA8"
        },
        teal: {
          DEFAULT: "#16B8C8",
          dark: "#119BA8"
        },
        success: "#16A34A",
        warning: "#D97706",
        error: "#DC2626",
        surface: "#FFFFFF",
        canvas: "#F3F6FA",
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
