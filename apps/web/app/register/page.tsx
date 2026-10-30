"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/components/providers/AuthProvider";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// These are ordinary application accounts only. Neither choice grants platform
// authority or verification: administration is provisioned out-of-band, and a
// provider profile is reviewed separately from account registration.
const ACCOUNT_TYPES = [
  {
    value: "customer",
    label: "عميل — مستورد / مصدّر",
    hint: "تنشئ طلبات عروض وتدير شحناتك ومستنداتك ومقارنة العروض."
  },
  {
    value: "provider",
    label: "مزوّد خدمة لوجستية",
    hint: "شركة شحن أو نقل أو تخليص أو تخزين. بعد التسجيل تُكمل ملف المنشأة."
  }
];

const TRADE_ROLES = [
  { value: "importer", label: "مستورد فقط" },
  { value: "exporter", label: "مصدّر فقط" },
  { value: "both", label: "مستورد ومصدّر" }
];

export default function RegisterPage() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [accountType, setAccountType] = useState("customer");
  const [tradeRole, setTradeRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (accountType === "customer" && !tradeRole) {
        throw new Error("اختر نشاط التجارة الخارجية: مستورد، مصدّر، أو الاثنان.");
      }
      if (accountType === "provider" && !organizationName.trim()) {
        throw new Error("اسم المنظمة مطلوب لحساب مزوّد الخدمة.");
      }

      const res = await fetch(`${API}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: name,
          email,
          password,
          organizationName: organizationName || undefined,
          accountType,
          tradeRole: accountType === "customer" ? tradeRole : undefined
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "فشل إنشاء الحساب");
      login(json.token);
      window.location.href =
        accountType === "provider" ? "/company/register?onboarding=provider" : "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center p-6">
      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold tracking-widest text-teal">NAQL AI</p><ThemeToggle /></div>
        <h1 className="mt-1 text-2xl font-bold text-navy">إنشاء حساب</h1>
        <p className="mt-1 text-sm text-slate-500">
          اختر نوع الحساب. تسجيل الدخول مشترك، لكن الصلاحيات ومسار الإعداد يختلفان.
        </p>

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
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
              ملاحظة صريحة: لا يمنح أي تسجيل عام صلاحية إدارية. حساب مزوّد الخدمة يحتاج ملف منشأة
              وفئات خدمات، ولا يعني ظهوره في الدليل أنه موثّق أو أنه يملك بوابة خاصة.
            </p>
          </fieldset>

          <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          <Input
            label="البريد الإلكتروني"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            label="كلمة المرور (8 أحرف على الأقل)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <Input
            label={accountType === "provider" ? "اسم المنظمة (مطلوب)" : "اسم الشركة / المنشأة (اختياري)"}
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            required={accountType === "provider"}
          />

          {accountType === "customer" ? (
            <label className="block space-y-1 text-sm">
              <span className="block font-medium text-slate-600">نشاط التجارة الخارجية</span>
              <select
                aria-label="نشاط التجارة الخارجية"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={tradeRole}
                onChange={(e) => setTradeRole(e.target.value)}
                required
              >
                <option value="" disabled>اختر النشاط</option>
                {TRADE_ROLES.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
              <span className="block text-xs text-slate-500">
                يمكنك اختيار «مستورد ومصدّر» ضمن نفس الحساب؛ لا ننشئ حساباً مكرراً لكل اتجاه.
              </span>
            </label>
          ) : (
            <p className="rounded-lg bg-teal/10 px-3 py-2 text-xs leading-relaxed text-teal-dark">
              بعد التسجيل ستنتقل مباشرة إلى نموذج ملف مزوّد الخدمة: الاسم القانوني، فئة الخدمة،
              وسائل النقل، والتغطية الاختيارية. إرسال الملف للمراجعة منفصل عن التحقق.
            </p>
          )}

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
