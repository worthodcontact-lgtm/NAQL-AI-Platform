import React from "react";

const styles: Record<string, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
};

export function Badge({ variant = "neutral", children }: { variant?: keyof typeof styles; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${styles[variant]}`}>{children}</span>;
}
