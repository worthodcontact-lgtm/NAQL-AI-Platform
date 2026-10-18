import React from "react";

const styles: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  neutral: "bg-slate-100 text-slate-700"
};

export function Badge({ variant = "neutral", children }: { variant?: keyof typeof styles; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${styles[variant]}`}>{children}</span>;
}
