import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  isLoading?: boolean;
};

export function Button({ variant = "primary", isLoading, className = "", children, ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:ring-2 disabled:opacity-60 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-canvas",
    danger: "bg-error text-white hover:bg-red-700",
    ghost: "text-slate-600 hover:bg-canvas"
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} disabled={isLoading || props.disabled} {...props}>
      {isLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}
