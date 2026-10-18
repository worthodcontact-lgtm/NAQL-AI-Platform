import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import { AuthProvider } from "@/components/providers/AuthProvider";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-arabic", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "NAQL AI",
  description: "AI-powered logistics and international trade platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="min-h-screen bg-canvas text-slate-700 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
