import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  isLoading?: boolean;
};

export function Button({ variant = "primary", size = "md", isLoading, className = "", children, ...props }: ButtonProps) {
  const base = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-ring disabled:opacity-60 disabled:cursor-not-allowed";
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm"
  };
  const variants: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-canvas",
    danger: "bg-error text-white hover:bg-red-700",
    ghost: "text-slate-600 hover:bg-canvas"
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={isLoading || props.disabled} {...props}>
      {isLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}
