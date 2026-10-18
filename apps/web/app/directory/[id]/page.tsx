"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/v1/companies/${params.id}`)
      .then(async (r) => { if (!r.ok) throw new Error("Not found"); return r.json(); })
      .then(setCompany)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <main className="mx-auto max-w-4xl px-5 py-10 text-slate-500">جار التحميل...</main>;
  if (error) return <main className="mx-auto max-w-4xl px-5 py-10 text-error">{error}</main>;
  if (!company) return null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <Link href="/directory" className="text-sm text-primary">← رجوع للدليل</Link>
      <h1 className="mt-4 text-3xl font-bold text-navy">{company.name}</h1>
      <p className="text-sm text-slate-500">{company.type} · {company.country ?? "—"}</p>
      <p className="mt-3 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
        {company.verificationStatus === "verified" ? "موثقة من NAQL AI" : "غير موثقة — الإدراج ليس شهادة"}
      </p>
      {company.description && <p className="mt-5 text-slate-600">{company.description}</p>}
      {company.website && <p className="mt-4 ltr-text text-sm text-primary">{company.website}</p>}

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-navy">الخدمات</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(company.services ?? []).length === 0 && <p className="text-sm text-slate-500">لا توجد خدمات منشورة.</p>}
          {(company.services ?? []).map((s: any) => (
            <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <p className="font-semibold text-navy">{s.mode}</p>
              <p className="text-slate-500">{s.originLocation ?? "—"} → {s.destinationLocation ?? "—"}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
