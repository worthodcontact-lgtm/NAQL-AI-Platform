import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-arabic", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "NAQL AI",
  description: "AI-powered logistics and international trade platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('naql-theme');if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}catch(e){}` }} />
      </head>
      <body className="min-h-screen bg-canvas text-slate-700 antialiased">
        <ThemeProvider><AuthProvider>{children}</AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
