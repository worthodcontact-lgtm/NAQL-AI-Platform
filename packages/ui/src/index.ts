export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(variant: ButtonVariant = "primary", disabled = false): string {
  const base = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:ring-2";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    ghost: "text-slate-700 hover:bg-slate-100",
    danger: "bg-red-600 text-white hover:bg-red-700"
  };
  return `${base} ${variants[variant]} ${disabled ? "opacity-50 pointer-events-none" : ""}`;
}
