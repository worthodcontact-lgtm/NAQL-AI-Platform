"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/components/providers/AuthProvider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ACCOUNT_TYPES = [
  { value: "customer", label: "عميل / مستورد / مصدّر", hint: "تنشئ طلبات عروض، ومتابعة شحنات وتكاليف." },
  { value: "company", label: "شركة أو مزوّد خدمة", hint: "شحن، نقل، تخليص، تخزين. تُرسل ملفها للمراجعة." },
  { value: "reviewer", label: "مراجع تحقق (NAQL AI)", hint: "يراجع ملفات الشركات ويقرّر القبول أو الرفض." },
  { value: "admin", label: "مدير منصة (NAQL AI)", hint: "إدارة كاملة وسجل تدقيق." }
];

export default function RegisterPage() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [accountType, setAccountType] = useState("customer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: name,
          email,
          password,
          organizationName: organizationName || undefined,
          accountType
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "فشل إنشاء الحساب");
      login(json.token);
      window.location.href = accountType === "reviewer" || accountType === "admin" ? "/admin" : "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center p-6">
      <Card className="p-6">
        <p className="text-xs font-semibold tracking-widest text-teal">NAQL AI</p>
        <h1 className="mt-1 text-2xl font-bold text-navy">إنشاء حساب</h1>
        <p className="mt-1 text-sm text-slate-500">اختر نوع حسابك لنعرف البوابة المناسبة لك.</p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-600">نوع الحساب</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ACCOUNT_TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`cursor-pointer rounded-xl border p-3 text-sm transition ${
                    accountType === t.value ? "border-primary bg-primary/5" : "border-slate-200 hover:bg-canvas"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="accountType"
                      value={t.value}
                      checked={accountType === t.value}
                      onChange={(e) => setAccountType(e.target.value)}
                    />
                    <span className="font-semibold text-navy">{t.label}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{t.hint}</span>
                </label>
              ))}
            </div>
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              ملاحظة صريحة: اختيار النوع هنا يعمل في <b>وضع التطوير</b> فقط (بدون قاعدة بيانات). في الإنتاج تُمنح
              الأدوار الإدارية من صلاحيات المنظمة بعد المراجعة، ولا يمنحها المستخدم لنفسه.
            </p>
          </fieldset>

          <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="البريد الإلكتروني" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="كلمة المرور (8 أحرف على الأقل)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Input
            label="اسم المنظمة (اختياري)"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
          />

          <Button isLoading={loading} type="submit" className="w-full">إنشاء الحساب</Button>
        </form>

        {error && <p className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}

        <p className="mt-4 text-sm text-slate-500">
          لديك حساب؟ <Link href="/login" className="font-semibold text-primary">تسجيل الدخول</Link>
        </p>
      </Card>
    </main>
  );
}
