import React from "react";

export function Input({ label, error, className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  const generatedId = React.useId();
  const inputId = props.id ?? generatedId;
  return (
    <div className="space-y-1">
      {label && <label htmlFor={inputId} className="block text-sm font-medium text-slate-600">{label}</label>}
      <input id={inputId} className={`min-h-10 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${error ? "border-error" : "border-slate-200"} ${className}`} {...props} />
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

export function Textarea({ label, error, className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  const generatedId = React.useId();
  const inputId = props.id ?? generatedId;
  return (
    <div className="space-y-1">
      {label && <label htmlFor={inputId} className="block text-sm font-medium text-slate-600">{label}</label>}
      <textarea id={inputId} className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${error ? "border-error" : "border-slate-200"} ${className}`} {...props} />
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
