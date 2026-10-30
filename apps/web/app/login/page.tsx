"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/components/providers/AuthProvider";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Read the query string directly so the page stays statically prerenderable.
    const params = new URLSearchParams(window.location.search);
    if (params.get("expired") === "1") {
      setExpired(true);
      setMessage("انتهت الجلسة السابقة. الرجاء تسجيل الدخول من جديد.");
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setExpired(false);
    try {
      const res = await fetch(`${API}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "فشل تسجيل الدخول");
      login(json.token);
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/dashboard";
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "خطأ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold tracking-widest text-teal">NAQL AI</p><ThemeToggle /></div>
        <h1 className="mt-1 text-2xl font-bold text-navy">تسجيل الدخول</h1>
        <p className="mt-1 text-sm text-slate-500">
          نقطة دخول واحدة لكل أنواع الحسابات. البوابة تُحدَّد تلقائيًا من صلاحياتك.
        </p>

        {message && (
          <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${expired ? "bg-warning/10 text-warning" : "bg-error/10 text-error"}`}>
            {message}
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <Input label="البريد الإلكتروني" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="كلمة المرور" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button isLoading={loading} type="submit" className="w-full">دخول</Button>
        </form>

        <p className="mt-4 text-sm text-slate-500">
          لا تملك حسابًا؟ <Link href="/register" className="font-semibold text-primary">إنشاء حساب</Link>
        </p>
      </Card>
    </main>
  );
}
