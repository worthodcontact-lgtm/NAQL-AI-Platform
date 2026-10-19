import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "إدارة المنصة · NAQL AI",
  robots: { index: false, follow: false }
};

/**
 * Administration area shell.
 *
 * Deliberately minimal: the ordinary `(app)` layout (customer/provider shell)
 * must not wrap the console, and the console must not inherit the customer
 * session. The console group adds its own admin-only auth provider.
 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-canvas">{children}</div>;
}
