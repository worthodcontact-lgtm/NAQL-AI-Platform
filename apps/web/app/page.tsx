import Image from "next/image";
import Link from "next/link";
import PublicHeader from "@/components/layout/PublicHeader";

const capabilities = [
  { icon: "◉", title: "الشحن البحري", text: "مجال خدمات الشحن البحري" },
  { icon: "✈", title: "الشحن الجوي", text: "مجال خدمات الشحن الجوي" },
  { icon: "⌂", title: "التخزين والمستودعات", text: "مجال خدمات التخزين" },
  { icon: "⇄", title: "النقل البري", text: "مجال خدمات النقل البري" },
  { icon: "▤", title: "الخدمات الجمركية", text: "مجال خدمات التخليص" },
  { icon: "↗", title: "ذكاء التجارة", text: "بيانات UN Comtrade وأدوات المنصة" }
];

const workflow = [
  { n: "01", title: "اكتشف فرص التجارة", text: "استكشف بيانات التجارة الدولية ومعلومات الشركات المسجلة." },
  { n: "02", title: "اطلب الخدمات اللوجستية", text: "أنشئ طلب عروض وشارك تفاصيل الشحنة المطلوبة." },
  { n: "03", title: "قارن عروض المزوّدين", text: "راجع العروض المقدمة واختر ما يلائم احتياجاتك." },
  { n: "04", title: "أدر عمليات الشحن", text: "تابع حالات الحجز والشحنة والوثائق المسجلة في مساحة العمل." }
];

const services = [
  { icon: "◉", title: "الشحن البحري", text: "استكشف الشركات التي تقدم خدمات مرتبطة بالنقل البحري.", photo: "/images/home/seaport-sunset.jpg", alt: "ميناء بحري وحاويات ورافعات عند الغروب", position: "object-center", label: "بحري" },
  { icon: "✈", title: "الشحن الجوي", text: "تعرّف على خدمات الشحن الجوي ومناولة البضائع.", photo: "/images/home/air-cargo.jpg", alt: "تحميل البضائع إلى طائرة في محطة مطار", position: "object-center", label: "جوي" },
  { icon: "⌂", title: "التخزين", text: "استكشف فئة التخزين والمستودعات ضمن دليل الخدمات.", photo: "/images/home/warehouse.jpg", alt: "داخل مستودع واسع بهياكل تخزين معدنية", position: "object-center", label: "تخزين" },
  { icon: "⇄", title: "النقل البري", text: "فئة خدمات للنقل البري وحركة البضائع بين المواقع.", photo: null, alt: "", position: "", label: "بري" },
  { icon: "▤", title: "التخليص الجمركي", text: "استكشف ملفات الشركات والخدمات الجمركية المدرجة.", photo: null, alt: "", position: "", label: "جمارك" },
  { icon: "⌘", title: "الخدمات متعددة الوسائط", text: "مجالات الخدمات اللوجستية المعروضة في دليل الشركات.", photo: null, alt: "", position: "", label: "متعدد الوسائط" }
];

function SectionTitle({ eyebrow, title, text, light = false }: { eyebrow: string; title: string; text: string; light?: boolean }) {
  return (
    <div className="mb-9 max-w-3xl">
      <p className={`mb-3 text-xs font-extrabold uppercase tracking-[.18em] ${light ? "text-cyan-300" : "text-primary"}`}>{eyebrow}</p>
      <h2 className={`text-3xl font-extrabold leading-tight sm:text-4xl ${light ? "text-white" : "text-navy dark:text-white"}`}>{title}</h2>
      <p className={`mt-3 text-sm leading-7 sm:text-base ${light ? "text-slate-300" : "text-slate-600 dark:text-slate-300"}`}>{text}</p>
    </div>
  );
}

function PortNetworkIllustration() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#10243a] p-5 shadow-2xl sm:p-8">
      <div className="absolute inset-0 opacity-30" aria-hidden="true">
        <svg viewBox="0 0 900 440" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
          <defs><pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M 34 0 L 0 0 0 34" fill="none" stroke="#7ea0bd" strokeWidth=".5" opacity=".3" /></pattern></defs>
          <rect width="900" height="440" fill="url(#grid)" />
          <path d="M72 125 C115 70 155 84 192 73 L219 92 245 91 266 120 249 144 222 152 204 183 180 190 153 218 125 211 110 190 83 185 69 159Z" fill="#41627f" />
          <path d="M241 223 270 204 295 218 307 248 292 275 285 315 265 349 251 320 246 281 230 253Z" fill="#41627f" />
          <path d="m372 105 39-22 34 8 26-20 54 15 18 29 49-5 48 26-16 22-43 8-15 22-46-11-33 23-29-10-27 13-29-23-16-31-31-8-2-25-21-10Z" fill="#41627f" />
          <path d="m464 226 35-23 39 12 22 37-13 51-26 51-20 11-17-34-21-27-20-45Z" fill="#41627f" />
          <path d="m652 294 33-22 38 10 10 24-28 28-39-8Z" fill="#41627f" />
          <path d="M182 139 C295 40 438 93 555 138 S709 155 760 192" fill="none" stroke="#38d2df" strokeWidth="2" strokeDasharray="7 9" />
          <path d="M250 270 C365 330 458 270 548 224 S682 204 760 192" fill="none" stroke="#38d2df" strokeWidth="2" strokeDasharray="7 9" />
        </svg>
      </div>
      <div className="relative flex min-h-[250px] flex-col justify-between sm:min-h-[330px]">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold text-cyan-200">رسم توضيحي لمسارات التجارة</span>
          <span className="text-[10px] text-slate-400">لا يعرض مواقع شحنات مباشرة</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 backdrop-blur">
            <p className="text-[10px] font-semibold text-slate-400">استكشف بيانات التجارة</p>
            <p className="mt-1 text-lg font-bold text-white">مصر · الأسواق الدولية</p>
          </div>
          <Link href="/login?next=%2Ftrade" className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300">افتح ذكاء التجارة <span aria-hidden="true">←</span></Link>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-clip bg-canvas dark:bg-slate-950">
      <PublicHeader />

      <main>
        {/* Hero */}
        <section id="home" className="relative isolate min-h-[620px] overflow-hidden bg-navy text-white sm:min-h-[680px]">
          <Image src="/images/home/port-hero.jpg" alt="سفينة حاويات ورافعات في ميناء بحري" fill priority sizes="100vw" className="-z-20 object-cover object-center" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-l from-[#101c2d]/95 via-[#101c2d]/75 to-[#101c2d]/25" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#101c2d]/65 via-transparent to-[#101c2d]/10" />
          <div className="mx-auto flex min-h-[620px] max-w-[1440px] items-center px-5 py-16 sm:min-h-[680px] sm:px-8 lg:px-12">
            <div className="max-w-3xl animate-hero-in">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-200/25 bg-slate-950/30 px-4 py-2 text-xs font-bold tracking-wide text-cyan-100 backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-cyan-300" /> PLAN. PREDICT. OPTIMIZE.
              </p>
              <h1 className="text-4xl font-black leading-[1.2] sm:text-5xl lg:text-6xl">تجارة عالمية.<br /><span className="text-cyan-300">لوجستيات أكثر ذكاءً.</span></h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-slate-200 sm:text-lg">
                اكتشف بيانات التجارة الدولية، واستكشف شركات الخدمات اللوجستية، وأدر طلبات عروض الأسعار والشحنات من مساحة عمل واحدة.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/register" className="rounded-xl bg-cyan-400 px-6 py-3.5 text-sm font-extrabold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:-translate-y-0.5 hover:bg-cyan-300">ابدأ باستخدام المنصة <span aria-hidden="true">←</span></Link>
                <Link href="/directory" className="rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20">استكشف الخدمات</Link>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-slate-200">
                <span>بيانات تجارة بمصدر موثّق</span><span>·</span><span>سير عمل للشحن والعروض</span><span>·</span><span>مساحات عمل بحسب الدور</span>
              </div>
            </div>
          </div>
          <a href="#capabilities" className="absolute bottom-6 start-1/2 hidden -translate-x-1/2 text-xs text-white/75 sm:block">اكتشف المنصة <span aria-hidden="true">↓</span></a>
        </section>

        {/* Trust and capabilities */}
        <section id="capabilities" className="border-b border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-xs font-extrabold tracking-widest text-primary">مجالات المنصة</p><h2 className="mt-1 text-xl font-extrabold text-navy dark:text-white">أدوات مترابطة لعمليات التجارة واللوجستيات</h2></div>
              <p className="text-xs text-slate-500 dark:text-slate-400">فئات وقدرات متاحة في واجهات المنصة</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {capabilities.map((item) => <div key={item.title} className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-lg text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200" aria-hidden="true">{item.icon}</span>
                <span><span className="block text-xs font-bold text-navy dark:text-slate-100">{item.title}</span><span className="mt-1 block text-[10px] text-slate-500 dark:text-slate-400">{item.text}</span></span>
              </div>)}
            </div>
          </div>
        </section>

        {/* Bento overview */}
        <section className="px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-[1440px]">
            <SectionTitle eyebrow="منصة واحدة" title="من بيانات التجارة إلى تنفيذ الشحنة" text="تجربة موحدة تربط معلومات الأسواق بأدوات طلب الخدمات وإدارة العمليات، مع إبقاء كل مساحة مرتبطة بصلاحيات حسابها." />
            <div className="grid auto-rows-[minmax(190px,auto)] gap-4 md:grid-cols-6">
              <Link href="/login?next=%2Ftrade" className="group relative overflow-hidden rounded-3xl bg-navy p-6 text-white md:col-span-3 md:row-span-2 md:p-8">
                <div className="absolute -end-16 -top-12 h-64 w-64 rounded-full border border-cyan-300/20 bg-cyan-400/10 transition-transform duration-500 group-hover:scale-110" />
                <div className="relative flex h-full flex-col justify-between">
                  <div><span className="text-xs font-bold tracking-widest text-cyan-300">TRADE INTELLIGENCE</span><h3 className="mt-4 max-w-md text-2xl font-extrabold leading-snug sm:text-3xl">بيانات موثّقة تساعدك على فهم حركة التجارة</h3><p className="mt-3 max-w-lg text-sm leading-7 text-slate-300">استكشف نظرة التجارة السنوية ومصدر بيانات UN Comtrade بعد تسجيل الدخول.</p></div>
                  <span className="mt-8 inline-flex w-fit items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold">استكشف بيانات التجارة <span aria-hidden="true">←</span></span>
                </div>
              </Link>
              <Link href="/login?next=%2Fshipments" className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-panel dark:border-slate-800 dark:bg-slate-900 md:col-span-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-xl text-blue-800 dark:bg-blue-950 dark:text-blue-200" aria-hidden="true">⇢</span><h3 className="mt-5 text-lg font-extrabold text-navy dark:text-white">إدارة الشحنات</h3><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">سجّل بيانات الشحنة واعرض حالتها وتفاصيلها في مساحة العمل.</p>
              </Link>
              <Link href="/login?next=%2Frfqs" className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-panel dark:border-slate-800 dark:bg-slate-900 md:col-span-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-xl text-amber-800 dark:bg-amber-950 dark:text-amber-200" aria-hidden="true">▤</span><h3 className="mt-4 font-extrabold text-navy dark:text-white">سوق طلبات العروض</h3><p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">أرسل طلبًا واستقبل عروضًا عبر سير العمل الموجود.</p>
              </Link>
              <Link href="/directory" className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-panel dark:border-slate-800 dark:bg-slate-900 md:col-span-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-xl text-teal-800 dark:bg-teal-950 dark:text-teal-200" aria-hidden="true">⌖</span><h3 className="mt-4 font-extrabold text-navy dark:text-white">دليل الشركات</h3><p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">استكشف الملفات وحالة التسجيل والتحقق كما تظهر في الدليل.</p>
              </Link>
              <Link href="/login?next=%2Fdocuments" className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-panel dark:border-slate-800 dark:bg-slate-900 md:col-span-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-xl text-violet-800 dark:bg-violet-950 dark:text-violet-200" aria-hidden="true">▧</span><h3 className="mt-4 font-extrabold text-navy dark:text-white">الوثائق</h3><p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">تنظيم ملفات الشحن وبياناتها وحالات التحقق المتاحة.</p>
              </Link>
              <Link href="/login?next=%2Fai" className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-panel dark:border-slate-800 dark:bg-slate-900 md:col-span-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-xl text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200" aria-hidden="true">✳</span><h3 className="mt-4 font-extrabold text-navy dark:text-white">مساعد وأدوات تحليل</h3><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">استكشف الأدوات المتاحة؛ المخرجات المعتمدة على مزوّد خارجي تظهر بحالتها الفعلية.</p>
              </Link>
            </div>
          </div>
        </section>

        {/* Network */}
        <section className="bg-navy px-5 py-16 text-white sm:px-8 lg:px-12 lg:py-20">
          <div className="mx-auto grid max-w-[1440px] items-center gap-10 lg:grid-cols-[.85fr_1.15fr]">
            <div><SectionTitle light eyebrow="شبكة التجارة العالمية" title="رؤية أوسع للأسواق ومسارات الحركة" text="تصوير مفاهيمي يوضح الترابط بين الأسواق ومراكز النقل. لا تمثل الخطوط مواقع شحنات حية أو مسارات تشغيلية مؤكدة." /><Link href="/login?next=%2Ftrade" className="inline-flex rounded-xl bg-cyan-400 px-5 py-3 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-300">استكشف بيانات التجارة <span className="ms-2" aria-hidden="true">←</span></Link></div>
            <PortNetworkIllustration />
          </div>
        </section>

        {/* Services */}
        <section id="services" className="px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-[1440px]">
            <SectionTitle eyebrow="فئات الخدمات" title="خيارات لوجستية متعددة ضمن دليل الشركات" text="تعرض البطاقات مجالات الخدمة التي يمكن استكشافها. ظهور الفئة لا يعني توفر مزوّد أو تغطية أو سعر محدد." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => <article key={service.title} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-1 hover:shadow-panel dark:border-slate-800 dark:bg-slate-900">
                <div className="relative h-48 overflow-hidden bg-gradient-to-br from-slate-blue to-navy">
                  {service.photo ? <Image src={service.photo} alt={service.alt} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className={`object-cover transition duration-500 group-hover:scale-105 ${service.position}`} /> : <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_70%_20%,rgba(22,184,200,.36),transparent_35%),linear-gradient(145deg,#1e3551,#101c2d)]"><span className="text-6xl text-cyan-200/90" aria-hidden="true">{service.icon}</span><span className="absolute bottom-4 start-4 rounded-full border border-white/20 bg-slate-950/40 px-3 py-1 text-xs font-bold text-white backdrop-blur">مجال خدمة</span></div>}
                  {service.photo && <span className="absolute bottom-4 start-4 rounded-full border border-white/20 bg-slate-950/50 px-3 py-1 text-xs font-bold text-white backdrop-blur">{service.label}</span>}
                </div>
                <div className="p-5"><h3 className="text-lg font-extrabold text-navy dark:text-white">{service.title}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-slate-500 dark:text-slate-400">{service.text}</p><Link href="/directory" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline">استكشف الدليل <span aria-hidden="true">←</span></Link></div>
              </article>)}
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="border-y border-slate-200 bg-white px-5 py-16 dark:border-slate-800 dark:bg-slate-900 sm:px-8 lg:px-12 lg:py-20">
          <div className="mx-auto max-w-[1440px]">
            <SectionTitle eyebrow="كيف تعمل NAQL AI" title="خطوات واضحة من الطلب إلى إدارة الشحنة" text="سير عمل يربط مسارات العملاء والمزوّدين مع صلاحيات منفصلة لكل حساب." />
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {workflow.map((step, index) => <li key={step.n} className="relative rounded-2xl border border-slate-200 bg-canvas/60 p-5 dark:border-slate-800 dark:bg-slate-950/50">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy text-xs font-extrabold text-cyan-300">{step.n}</span><h3 className="mt-5 font-extrabold text-navy dark:text-white">{step.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{step.text}</p>
                {index < workflow.length - 1 && <span className="absolute -end-2 top-8 z-10 hidden h-4 w-4 rotate-45 border-e border-t border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 lg:block" aria-hidden="true" />}
              </li>)}
            </ol>
          </div>
        </section>

        {/* AI */}
        <section className="overflow-hidden bg-[#0b1727] px-5 py-16 text-white sm:px-8 lg:px-12 lg:py-24">
          <div className="mx-auto grid max-w-[1440px] items-center gap-12 lg:grid-cols-2">
            <div><SectionTitle light eyebrow="ذكاء التجارة والوثائق" title="أدوات رقمية لدعم قراراتك التشغيلية" text="تضم المنصة مساعدًا وأدوات وثائق وبيانات تجارة. لا تعرض هذه الصفحة تنبؤات أو نتائج مولّدة أو مؤشرات غير متحققة." /><div className="flex flex-wrap gap-3"><Link href="/login?next=%2Fai" className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-300">افتح المساعد</Link><Link href="/login?next=%2Fdocuments" className="rounded-xl border border-white/20 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">استكشف الوثائق</Link></div></div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-2xl sm:p-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4"><div><p className="text-xs text-slate-400">مساحة العمل</p><p className="mt-1 font-bold">بيانات ومهامك التشغيلية</p></div><span className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-bold text-cyan-200">عرض توضيحي للواجهة</span></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-800/70 p-4"><p className="text-xs text-slate-400">بيانات التجارة</p><div className="mt-4 flex h-24 items-end gap-2" aria-hidden="true">{[35, 60, 46, 78, 55, 90, 68].map((height, i) => <span key={i} className="flex-1 rounded-t bg-cyan-400/80" style={{ height: `${height}%` }} />)}</div><p className="mt-3 text-[10px] text-slate-500">رسم مفاهيمي؛ ليس إحصاءً فعليًا</p></div><div className="space-y-3 rounded-2xl bg-slate-800/70 p-4"><p className="text-xs text-slate-400">مصادر الأدوات</p><div className="rounded-xl border border-white/5 bg-slate-950/60 p-3"><p className="text-xs font-bold">UN Comtrade</p><p className="mt-1 text-[10px] text-slate-400">المصدر يظهر مع نتائج بيانات التجارة</p></div><div className="rounded-xl border border-white/5 bg-slate-950/60 p-3"><p className="text-xs font-bold">مساعد المنصة</p><p className="mt-1 text-[10px] text-slate-400">حالة الإتاحة تعتمد على إعداد المزوّد</p></div></div></div>
            </div>
          </div>
        </section>

        {/* Marketplace */}
        <section className="px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
          <div className="mx-auto grid max-w-[1440px] items-center gap-10 lg:grid-cols-2">
            <div><SectionTitle eyebrow="سوق الخدمات" title="من طلب الخدمة إلى قرار الحجز" text="مسارات قائمة لطلب عروض الأسعار، ومراجعة العروض، وإدارة الحجوزات. وصول المزوّدين يعتمد على صلاحيات حساباتهم وملفات شركاتهم." /><Link href="/directory" className="inline-flex rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white hover:bg-primary-dark">تصفّح دليل الشركات</Link></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900 sm:p-7">
              <div className="flex items-center justify-between"><div><p className="text-xs text-slate-500 dark:text-slate-400">سير عمل المنصة</p><h3 className="mt-1 text-lg font-extrabold text-navy dark:text-white">إدارة عروضك وحجوزاتك</h3></div><span className="rounded-full bg-cyan-50 px-3 py-1 text-[10px] font-bold text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100">مساحة عمل</span></div>
              <div className="mt-6 space-y-3">{[{ n: "01", title: "طلب عرض سعر", text: "أدخل تفاصيل الخدمة المطلوبة", href: "/login?next=%2Frfqs" }, { n: "02", title: "مقارنة العروض", text: "راجع ردود المزوّدين المسجلة", href: "/login?next=%2Fquotations" }, { n: "03", title: "إدارة الحجز", text: "تابع حالة الحجز المرتبط بالعرض", href: "/login?next=%2Fbookings" }].map((item) => <Link key={item.n} href={item.href} className="flex items-center gap-4 rounded-2xl border border-slate-100 p-4 transition hover:border-cyan-300 dark:border-slate-800 dark:hover:border-cyan-700"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-extrabold text-navy dark:bg-slate-800 dark:text-white">{item.n}</span><span className="min-w-0 flex-1"><span className="block font-bold text-navy dark:text-white">{item.title}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{item.text}</span></span><span className="text-primary" aria-hidden="true">←</span></Link>)}</div>
            </div>
          </div>
        </section>

        {/* Trade data */}
        <section className="border-y border-slate-200 bg-white px-5 py-16 dark:border-slate-800 dark:bg-slate-900 sm:px-8 lg:px-12 lg:py-20">
          <div className="mx-auto grid max-w-[1440px] items-center gap-10 lg:grid-cols-2">
            <div><SectionTitle eyebrow="بيانات التجارة" title="مصدر البيانات واضح قبل اتخاذ القرار" text="واجهة بيانات التجارة في المنصة تعتمد على UN Comtrade وتعرض المصدر وتاريخ الجلب. قد تختلف التغطية وحداثة البيانات حسب الدولة والسنة." /><Link href="/login?next=%2Ftrade" className="inline-flex items-center gap-2 font-extrabold text-primary hover:underline">عرض بيانات التجارة <span aria-hidden="true">←</span></Link></div>
            <div className="rounded-3xl border border-slate-200 bg-canvas p-5 dark:border-slate-700 dark:bg-slate-950 sm:p-7">
              <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold tracking-wider text-slate-500">مصدر البيانات</p><h3 className="mt-1 text-lg font-extrabold text-navy dark:text-white">UN Comtrade</h3></div><span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">بيانات سنوية مجمعة</span></div>
              <div className="mt-6 grid grid-cols-3 gap-2">{["الواردات", "الصادرات", "الشركاء"].map((label) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><p className="text-[10px] text-slate-500">{label}</p><p className="mt-2 text-sm font-bold text-navy dark:text-slate-200">تُحمّل بعد الدخول</p></div>)}</div>
              <p className="mt-4 text-[10px] leading-5 text-slate-500 dark:text-slate-400">هذه معاينة لهيكل الواجهة فقط. لا تعرض أرقامًا تجريبية على أنها بيانات فعلية.</p>
            </div>
          </div>
        </section>

        {/* Infrastructure photos */}
        <section className="px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-[1440px]">
            <SectionTitle eyebrow="البنية اللوجستية" title="من الميناء إلى المستودع ومحطة الشحن" text="صور توضيحية لمجالات البنية التحتية المرتبطة بالتجارة الدولية." />
            <div className="grid gap-4 md:grid-cols-12">
              <figure className="group relative min-h-72 overflow-hidden rounded-3xl md:col-span-6"><Image src="/images/home/port-terminal.jpg" alt="محطة ميناء وحاويات ورافعات شحن" fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" /><div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" /><figcaption className="absolute bottom-5 start-5 text-lg font-extrabold text-white">محطات وموانئ الحاويات</figcaption></figure>
              <figure className="group relative min-h-72 overflow-hidden rounded-3xl md:col-span-3"><Image src="/images/home/port-aerial.jpg" alt="منظر جوي لحاويات ومعدات في ميناء" fill sizes="(max-width: 768px) 100vw, 25vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" /><div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" /><figcaption className="absolute bottom-5 start-5 text-base font-extrabold text-white">مناولة البضائع</figcaption></figure>
              <figure className="group relative min-h-72 overflow-hidden rounded-3xl md:col-span-3"><Image src="/images/home/seaport-sunset.jpg" alt="رافعات وحاويات في ميناء بحري عند الغروب" fill sizes="(max-width: 768px) 100vw, 25vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" /><div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" /><figcaption className="absolute bottom-5 start-5 text-base font-extrabold text-white">ممرات الشحن البحري</figcaption></figure>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section id="about" className="px-5 pb-16 sm:px-8 lg:px-12 lg:pb-24">
          <div className="relative mx-auto max-w-[1440px] overflow-hidden rounded-[2rem] bg-navy px-6 py-12 text-white sm:px-10 sm:py-16 lg:px-16">
            <div className="absolute -end-12 -top-28 h-80 w-80 rounded-full border border-cyan-300/20 bg-cyan-400/10" aria-hidden="true" />
            <div className="relative flex flex-wrap items-center justify-between gap-8"><div className="max-w-2xl"><p className="text-xs font-extrabold tracking-[.18em] text-cyan-300">NAQL AI · PLAN. PREDICT. OPTIMIZE.</p><h2 className="mt-3 text-3xl font-black sm:text-4xl">انطلق بأعمالك إلى آفاق جديدة.</h2><p className="mt-3 text-sm leading-7 text-slate-300">أنشئ مساحة عمل لإدارة طلبات الخدمات والعروض والشحنات.</p></div><div className="flex flex-wrap gap-3"><Link href="/register" className="rounded-xl bg-cyan-400 px-5 py-3 font-extrabold text-slate-950 hover:bg-cyan-300">إنشاء حساب</Link><Link href="/directory" className="rounded-xl border border-white/20 px-5 py-3 font-bold text-white hover:bg-white/10">استكشف المنصة</Link></div></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-10 sm:px-8 md:grid-cols-2 lg:grid-cols-4 lg:px-12">
          <div><Link href="/" className="text-lg font-black tracking-wide text-navy dark:text-white">NAQL AI</Link><p className="mt-2 text-xs font-bold tracking-widest text-primary">PLAN. PREDICT. OPTIMIZE.</p><p className="mt-4 max-w-xs text-xs leading-6 text-slate-500 dark:text-slate-400">منصة لإدارة مسارات التجارة الدولية والخدمات اللوجستية.</p></div>
          <div><h2 className="text-sm font-extrabold text-navy dark:text-white">المنصة</h2><div className="mt-3 grid gap-2 text-sm text-slate-500 dark:text-slate-400"><Link href="/login?next=%2Fdashboard" className="hover:text-primary">مساحة العمل</Link><Link href="/directory" className="hover:text-primary">دليل الشركات</Link><Link href="/login?next=%2Fshipments" className="hover:text-primary">إدارة الشحنات</Link></div></div>
          <div><h2 className="text-sm font-extrabold text-navy dark:text-white">البيانات والسوق</h2><div className="mt-3 grid gap-2 text-sm text-slate-500 dark:text-slate-400"><Link href="/login?next=%2Ftrade" className="hover:text-primary">ذكاء التجارة</Link><Link href="/login?next=%2Frfqs" className="hover:text-primary">طلبات عروض الأسعار</Link><Link href="/login?next=%2Fai" className="hover:text-primary">مساعد المنصة</Link></div></div>
          <div><h2 className="text-sm font-extrabold text-navy dark:text-white">الحساب</h2><div className="mt-3 grid gap-2 text-sm text-slate-500 dark:text-slate-400"><Link href="/login" className="hover:text-primary">تسجيل الدخول</Link><Link href="/register" className="hover:text-primary">إنشاء حساب</Link><a href="#home" className="hover:text-primary">العودة للأعلى ↑</a></div></div>
        </div>
        <div className="border-t border-slate-100 px-5 py-4 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">© NAQL AI · PLAN. PREDICT. OPTIMIZE.</div>
      </footer>
    </div>
  );
}
