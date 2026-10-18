import React from "react";

export function Input({ label, error, className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-slate-600">{label}</label>}
      <input className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${error ? "border-error" : "border-slate-200"} ${className}`} {...props} />
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

export function Textarea({ label, error, className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-slate-600">{label}</label>}
      <textarea className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${error ? "border-error" : "border-slate-200"} ${className}`} {...props} />
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
