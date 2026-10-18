import Link from "next/link";
import PublicHeader from "@/components/layout/PublicHeader";

const features = [
  { title: "إدارة الشحنات", desc: "إنشاء وتتبع shipments with tenant isolation and status lifecycle." },
  { title: "العروض", desc: "ربط عروض الأسعار بال shipments and award decisions." },
  { title: "حساب التكلفة", desc: "Breakdown costs with transparent calculated vs. input separation." },
  { title: "الوثائق", desc: "Metadata storage with validation status and honest fallback labeling." },
  { title: "الذكاء الاصطناعي", desc: "Copilot and delay interfaces with provider availability status." },
  { title: "واجهة عربية RTL", desc: "تجربة right-to-left with an application shell and role-aware navigation." }
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <PublicHeader />

      <main>
        <section className="mx-auto grid max-w-7xl gap-8 px-5 py-16 lg:grid-cols-2">
          <div className="space-y-6">
            <p className="inline-flex rounded-full bg-primary/10 px-4 py-1 text-sm font-semibold text-primary">PLAN — PREDICT — OPTIMIZE</p>
            <h2 className="text-4xl font-bold leading-tight text-navy">منصة تشغيل لوجستية وتجارة دولية مدعومة بالذكاء الاصطناعي</h2>
            <p className="text-lg text-slate-600">NAQL AI يربط importers, exporters, freight forwarders, and operators through one auditable workspace. Real API integration first; only honest capabilities are presented as operational.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/register" className="rounded-lg bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-dark">ابدأ الآن</Link>
              <Link href="/login" className="rounded-lg border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 hover:bg-canvas">دخول مساحة العمل</Link>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="rounded-2xl bg-navy p-5 text-white">
              <p className="text-sm text-slate-300">Shipment control preview</p>
              <div className="mt-4 space-y-3">
                {["SHP-001 · JED → RUH · DRAFT", "SHP-002 · DMM → JED · QUOTED", "SHP-003 · CAI → JED · IN_TRANSIT"].map((item) => (
                  <div key={item} className="rounded-lg bg-white/10 px-4 py-3 text-sm">{item}</div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-4 px-5 py-14 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 p-6">
                <h3 className="text-lg font-semibold text-navy">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16">
          <h2 className="text-3xl font-bold text-navy"> PLAN — PREDICT — OPTIMIZE </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {["Plan with shipments, ports, and quotation requests", "Predict with AI copilot and delay interfaces (honest availability)", "Optimize landed cost and document workflow decisions"].map((s) => (
              <div key={s} className="rounded-2xl bg-white p-6 shadow-panel">{s}</div>
            ))}
          </div>
        </section>

        <section className="bg-navy px-5 py-16 text-white">
          <div className="mx-auto max-w-7xl">
            <h2 className="text-3xl font-bold">Security and operational discipline</h2>
            <p className="mt-3 max-w-3xl text-slate-300">JWT authentication, request validation, tenant isolation, honest fallback labeling, and no fabricated statistics or live tracking.</p>
            <Link href="/register" className="mt-6 inline-block rounded-lg bg-teal px-5 py-3 font-semibold text-navy hover:bg-teal/90">إنشاء حساب</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
