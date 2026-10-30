"use client";

import { useTheme } from "@/components/providers/ThemeProvider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`التبديل إلى ${next}`}
      title={`التبديل إلى ${next}`}
      className="focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-canvas"
    >
      <span aria-hidden="true">{theme === "dark" ? "☼" : "☾"}</span>
      <span className="hidden sm:inline">{theme === "dark" ? "فاتح" : "داكن"}</span>
    </button>
  );
}
