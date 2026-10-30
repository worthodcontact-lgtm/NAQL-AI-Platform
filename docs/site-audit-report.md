# تقرير فحص منصة NAQL AI

**تاريخ الفحص:** 20 أكتوبر 2026  
**النطاق:** كود المشروع + API الإنتاج + قاعدة بيانات الإنتاج + واجهات الويب  
**الطريقة:** قراءة الكود، استعلامات قراءة فقط (Read-only) على قاعدة البيانات، فحص الـ endpoints المباشرة، ومعاينة الواجهات محليًا.

> **ملاحظة مهمة:** التقرير ده بيوصف الوضع الحالي كما هو، مش خطة تسويقية. أي حاجة مكتوب عنها «لم يتم التحقق» معناها إني مشفتش دليل عليها، ومش معناها إنها شغالة.
>
> **تحديث 2026-10-20:** تم تنفيذ فصل صلاحيات المنصة عن مساحات الشركات وعن التعاون داخل الشحنة في الكود والاختبارات المحلية. التفاصيل وخطة الترحيل في [`docs/access-control-separation.md`](./access-control-separation.md). الترحيل **لم يُطبّق على قاعدة الإنتاج بعد**.

---

## 1) الملخص التنفيذي

1. **المنصة تقنيًا شغالة:** الـ API حي، متصل بقاعدة بيانات PostgreSQL، وفيه 41 صفحة ويب و54 مسار API و21 جدول.
2. **لكنها ليست جاهزة للتشغيل التجاري:** البيانات الأصلية ضاعت، مفيش دليل على وجود Backup أو Volume مستقر، مفيش CI أو مراقبة، والذكاء الاصطناعي مجرد واجهة احتياطية (Fallback).
3. **البيانات الحالية أغلبها ديمو:** بعد استرجاع الحسابين فقط، تمت إضافة 5 سجلات من كل نوع بناءً على طلبك، وكلها معلّمة بوضوح كبيانات تجريبية.
4. **أخطر مشكلة تشغيلية:** ملف `.env` المحلي بيشاور على **قاعدة بيانات الإنتاج**. أي `pnpm dev` أو سكريبت محلي ممكن يكتب أو يمسح في بيانات السيرفر.
5. **تاني أخطر مشكلة:** `archive_mode = off` ومفيش Backup مؤكد. لو الـ Volume اتشال أو الخدمة اتعملها Redeploy من غير Volume، هيتكرر نفس سيناريو ضياع البيانات.
6. **الأولوية مش المزيد من الصفحات:** الأول تأمين البيانات، وبعدين تجربة الديمو، وبعدين اكتمال المنتج، وأخيرًا الذكاء الاصطناعي والتوسع.

---

## 2) صورة الإنتاج الآن (أدلة فعلية)

### 2.1 الخدمة وقاعدة البيانات

| البند | القيمة |
|---|---|
| API | `https://naql-ai-platform-production.up.railway.app` |
| `/health` | `200` — `persistenceMode: database` |
| `/ready` | `200` — `database: connected` |
| قاعدة البيانات | PostgreSQL **18.6** (Debian) |
| اسم القاعدة | `railway` |
| حجم القاعدة | **9,254 kB** |
| الاتصالات النشطة | 18 من 500 |
| مدة تشغيل السيرفر وقت الفحص | ~2 ساعة 49 دقيقة |
| `archive_mode` | **off** |
| `wal_level` | replica |
| الإضافات (Extensions) | `plpgsql` فقط — **لا يوجد PostGIS** |
| Migration history | 3 migrations، معمول لها Baseline بتاريخ 2026-10-20 01:33–01:34 UTC |

### 2.2 عدد السجلات في الإنتاج

| الجدول | العدد | ملاحظة |
|---|---:|---|
| Organization | 7 | 2 حقيقيين + 5 ديمو |
| User | 7 | 2 حقيقيين + 5 ديمو |
| Membership | 7 | — |
| Port | 20 | مرجعية |
| Shipment | 5 | ديمو |
| ShipmentMilestone | 20 | ديمو |
| QuotationRequest | 5 | ديمو (المجال القديم) |
| QuotationOffer | 5 | ديمو |
| Document | 5 | ديمو (Metadata فقط) |
| AuditLog | 7 | 2 حقيقيين + 5 ديمو |
| PlatformSetting | 0 | القيم الافتراضية من الكود |
| Company | 5 | ديمو |
| CompanyService | 10 | ديمو |
| CompanyDocument | 5 | ديمو (Metadata فقط) |
| VerificationReview | 5 | ديمو |
| Rfq | 5 | ديمو |
| RfqRecipient | 10 | ديمو |
| Quote | 5 | ديمو |
| QuoteItem | 12 | ديمو |
| BookingRequest | 5 | ديمو |
| TrackingEvent | 6 | ديمو |

### 2.3 المستخدمون الحاليون

| البريد | الاسم | الدور | الحالة |
|---|---|---|---|
| `worthod.contact@gmail.com` | عموكم | حساب عادي | نشط |
| `admin@almatador.com` | Platform Admin | `SUPER_ADMIN` | نشط |
| `demo-provider-1@naql.example` … `demo-provider-5@naql.example` | مسؤولو الشركات الديمو | حسابات عادية | نشطة |

**ملاحظة:** حسابات الديمو دي اتعملت بباسورد عشوائي غير معروف، يعني مش باب خلفي للدخول. لكنها بتظهر في إحصائيات المستخدمين.

### 2.4 ماذا يعني ده؟

- البيانات الأصلية (شركات/شحنات/عروض/حجوزات) **غير موجودة في القاعدة الحالية**.
- الحسابان الوحيدان الباقيان اتعملوا في 2026-10-20 الساعة 00:50 و01:14 UTC، وقبلهم مفيش أي أثر.
- مفيش Backup أو WAL archive على القاعدة الحالية، فاسترجاع البيانات القديمة من القاعدة نفسها **غير ممكن**. الحل الوحيد هو Backup/Volume Snapshot من Railway أو نسخة خارجية قديمة.

---

## 3) ما تم إضافته في هذه الجولة

| الإضافة | الملف/الأمر | الحالة |
|---|---|---|
| تثبيت تاريخ الـ Migrations | `prisma migrate resolve` | تم على الإنتاج |
| Seed للموانئ (20) | `pnpm db:seed` | تم على الإنتاج |
| بيانات ديمو (5 من كل نوع) | `apps/api/scripts/seed-demo.ts` | تم على الإنتاج |
| حذف بيانات الديمو | `pnpm db:seed:demo:remove` | متاح |
| Backup كامل JSON | `apps/api/scripts/db-backup.ts` | تم اختباره محليًا |
| Restore كامل | `apps/api/scripts/db-restore.ts` | تم اختباره على قاعدة مؤقتة |
| حماية التيستات من قاعدة بعيدة | `apps/api/src/config/env.ts` | تم اختباره |
| دليل تشغيل قاعدة البيانات | `docs/database-operations.md` | جاهز |

### 3.1 تفاصيل بيانات الديمو

- **5 شركات** لوجستية (شحن بحري، وكيل شحن، شحن جوي، تخليص جمركي، تخزين) + 10 خدمات + 5 مستندات شركات + 5 مراجعات تحقق.
- **5 شحنات** بمراحل زمنية (20 مرحلة) + 5 مستندات.
- **5 طلبات عرض (RFQ)** + 10 شركات مستلمة.
- **5 عروض أسعار** + 12 بند.
- **5 حجوزات** + 6 أحداث تتبع.
- **5 طلبات عرض قديمة** + 5 عروض.
- **5 سجلات Audit**.
- الشركات مربوطة بحساب `worthod.contact@gmail.com`، فتظهر له الشحنات والطلبات والحجوزات عند تسجيل الدخول.
- كل وصف شركة يبدأ بـ: **«بيانات تجريبية للعرض — ليست شركة حقيقية.»**

### 3.2 تحذيران

1. **لا تخلط بيانات الديمو ببيانات حقيقية قبل الإطلاق.** استخدم `pnpm db:seed:demo:remove` قبل بدء التشغيل الفعلي.
2. **لا تعتمد على بيانات الديمو كإثبات تحقق.** الشركات الأربع ظاهرة «موثقة» لأنها ديمو، وده مش تحقق حقيقي.

---

## 4) بنية المشروع

```
naql-ai/
├─ apps/
│  ├─ api/          Fastify 4 + Prisma 5 + PostgreSQL
│  ├─ web/          Next.js 14.2 + React 18 + Tailwind
│  └─ ai-service/   FastAPI (واجهات فقط، بدون موديل)
├─ packages/
│  ├─ shared-types/ غير مستخدمة
│  ├─ validation/   غير مستخدمة
│  ├─ ui/           غير مستخدمة
│  └─ config/       غير مستخدمة
├─ pnpm-workspace.yaml
└─ turbo.json
```

| البند | الواقع |
|---|---|
| مدير الحزم | pnpm 9.15 (مثبت في `packageManager`) |
| المونوريبو | Turborepo 2.3 |
| Node | v24.11.1 محليًا، والحد الأدنى `>=20` |
| الويب | Next.js 14.2، React 18، Tailwind 3.4 |
| الـ API | Fastify 4.28، Prisma 5.22، Zod |
| AI | FastAPI، بدون أي مزود أو موديل |
| الحزم المشتركة | **Dead code** — لا أحد يستوردها |
| Docker | غير مستخدم |
| Tests | 6 ملفات اختبار، 29 حالة مسجلة (API فقط) |

**ملاحظة:** المنتج الموصوف في `New Text Document.txt` كان بيطلب shadcn/ui، TanStack Query، MapLibre، ECharts، Redis، S3، PostGIS… **ولا واحدة من دول موجودة فعليًا**. التقرير ده بيحكم على الموجود، مش على المطلوب.

---

## 5) خريطة الواجهات (41 صفحة)

### 5.1 الصفحات العامة (5 + 2 إدارة)

| المسار | الحالة | الملاحظات |
|---|---|---|
| `/` | **ضعيف** | نص إنجليزي/عربي مختلط، وعدة بطاقات فيها جمل إنجليزية غير مترجمة، ومعاينة شحنات وهمية `SHP-001…` غير معلّمة كديمو |
| `/login` | جيد | تصميم نظيف، لكن مفيش «نسيت كلمة المرور» |
| `/register` | جيد | إنشاء حساب + منظمة، بدون تحقق بريد |
| `/directory` | جيد | يعرض 5 شركات ديمو، لكن أنواع الشركات بالإنجليزي (`warehouse`, `customs`…) |
| `/directory/[id]` | جيد | تفاصيل الشركة والخدمات |
| `/admin/login` | جيد | تسجيل دخول منفصل للإدارة |
| `/admin` | Redirect | — |

### 5.2 مساحة العمل (16 صفحة)

| المسار | الحالة | الملاحظات |
|---|---|---|
| `/dashboard` | **ضعيف جدًا** | بيعرض حالة API كنص JSON وعدد الشحنات فقط. مفيش مؤشرات RFQ/عروض/حجوزات، ولا نشاط حديث |
| `/shipments` | **ضعيف** | إدخال ميناء كنص حر (ID) بدل قائمة، مفيش صفحة تفاصيل، مفيش تغيير حالة، مفيش Timeline، والحالات بالإنجليزي |
| `/rfqs` | جيد | إنشاء وقائمة، لكن الحالات والإنجليزي ظاهرة |
| `/rfqs/[id]` | جيد | مقارنة العروض بدائية، وبتعرض `companyId` خام بدل اسم الشركة |
| `/provider/rfqs` | جيد | صندوق المزوّد |
| `/provider/rfqs/[id]` | جيد | محرر عرض سعر كامل |
| `/bookings` | جيد | تأكيد/رفض/تتبع، مع تمييز دور العميل والمزوّد |
| `/quotations` | **مربك** | مجال قديم متداخل مع RFQ |
| `/quotations/[id]` | **مربك** | إدخال `providerId` يدويًا كنص، وإضافة عرض من العميل |
| `/costs` | متوسط | الحساب شغال، لكن النتيجة بتظهر JSON خام والحقول بالإنجليزي |
| `/trade` | جيد | UN Comtrade حقيقي، مع Provenance وCache ورسائل فشل واضحة |
| `/documents` | متوسط | الرفع موجود، لكن التخزين قد يكون في الذاكرة، ومفيش تحميل للملف |
| `/ai` | **Fallback** | بيرجع رسالة «AI provider not configured»؛ مفيش ذكاء اصطناعي فعلي |
| `/directory` | جيد | نفس الدليل العام |
| `/company/register` | جيد | تسجيل/إرسال للمراجعة، بدون رفع مستندات |
| `/analytics` | **Placeholder** | «قيد التوفر» |
| `/settings` | **Placeholder** | «قيد التوفر» |

### 5.3 لوحة الإدارة (20 صفحة)

| القسم | الصفحات | الحالة |
|---|---|---|
| المراقبة | Dashboard, Reports, Audit Logs | جيد |
| الحسابات | Users, User Detail, Companies, Company Detail, Verifications | جيد |
| العمليات | Shipments, Shipment Detail, Bookings, Booking Detail, RFQs, RFQ Detail, Quotations, Quotation Detail, Ports | جيد |
| النظام | Settings | جيد (3 إعدادات فقط) |

**نقاط قوة الإدارة:**
- تسجيل دخول منفصل، صلاحيات دقيقة (SUPER_ADMIN / ADMIN / REVIEWER / SUPPORT).
- Revocation فوري عبر `sessionVersion`.
- Audit log مع Request ID.
- حماية آخر Super Admin.
- تحقق الشركات مع سبب إلزامي للرفض.

**نواقص الإدارة:**
- مفيش إنشاء/دعوة مستخدم من الواجهة.
- مفيش إدارة أعضاء المنظمة.
- مفيش MFA.
- مفيش تصدير CSV.
- مفيش صفحة لحالة الـ Backups أو Volume.
- التوكن في `localStorage`.

---

## 6) خريطة الـ API (54 مسارًا)

### 6.1 المصادقة

| المسار | الوظيفة | ملاحظات |
|---|---|---|
| `POST /api/v1/auth/register` | تسجيل | Rate limit 20/دقيقة، لا يمنح دور منصة |
| `POST /api/v1/auth/login` | دخول | bcrypt cost 10، Token 12 ساعة |
| `GET /api/v1/auth/me` | بيانات الحساب | — |
| `POST /api/v1/admin/auth/login` | دخول الإدارة | Token 8 ساعات، يرفض غير الموظفين |
| `POST /api/v1/admin/auth/logout` | خروج | يلغي التوكن من السيرفر |
| `GET /api/v1/admin/auth/me` | هوية الإدارة | — |

### 6.2 الشركات والتحقق

| المسار | الوظيفة |
|---|---|
| `POST /api/v1/companies/register` | تسجيل شركة |
| `GET /api/v1/companies/mine` | شركات المنظمة |
| `GET /api/v1/companies/directory` | الدليل العام (Listed فقط) |
| `GET /api/v1/companies/:id` | تفاصيل عامة (Listed فقط) |
| `POST /api/v1/companies/:id/submit` | إرسال للمراجعة |
| `POST /api/v1/companies/:id/documents` | إضافة Metadata لمستند |
| `GET /api/v1/admin/companies` | إدارة الشركات |
| `GET /api/v1/admin/companies/:id` | ملف الشركة |
| `POST /api/v1/admin/companies/:id/verify` | قرار التحقق |

### 6.3 الشحنات

| المسار | الوظيفة |
|---|---|
| `GET/POST /api/v1/shipments` | قائمة/إنشاء |
| `GET/DELETE /api/v1/shipments/:id` | تفاصيل/حذف |
| `PATCH /api/v1/shipments/:id/status` | تغيير الحالة |
| `POST /api/v1/shipments/:id/documents` | رفع مستند (Base64) |
| `GET /api/v1/admin/shipments` | عرض إداري |
| `GET /api/v1/admin/shipments/:id` | تفاصيل إدارية |

**نواقص:**
- لا يوجد Containers أو أبعاد أو وزن حجمي.
- لا يوجد Route/Legs أو خريطة.
- لا يوجد ربط بين الحجز المؤكد والشحنة.
- لا يوجد Pagination/Filters في واجهة المستخدم.

### 6.4 RFQ / عروض / حجوزات

| المسار | الوظيفة |
|---|---|
| `GET/POST /api/v1/rfqs` | قائمة/إنشاء RFQ |
| `GET /api/v1/rfqs/incoming` | صندوق المزوّد |
| `GET /api/v1/rfqs/:id` | تفاصيل |
| `POST /api/v1/rfqs/:id/quotes` | تقديم عرض |
| `POST /api/v1/rfqs/:id/accept` | قبول عرض → Booking |
| `GET /api/v1/bookings` | الحجوزات |
| `GET /api/v1/bookings/:id` | تفاصيل |
| `POST /api/v1/bookings/:id/confirm` | تأكيد المزوّد |
| `POST /api/v1/bookings/:id/reject` | رفض المزوّد |
| `POST /api/v1/bookings/:id/tracking` | إضافة تتبع يدوي |

**نواقص:**
- لا يوجد مقارنة Side-by-side حقيقية (سعر/مدة/صلاحية/شركة).
- لا يوجد التعامل مع انتهاء صلاحية العرض.
- لا يوجد تحويل عملات.
- لا يوجد إنشاء شحنة تلقائيًا بعد تأكيد الحجز.
- لا يوجد إشعارات للعميل/المزوّد.

### 6.5 المجال القديم (Quotations)

| المسار | الوظيفة | ملاحظة |
|---|---|---|
| `POST/GET /api/v1/quotations` | إنشاء/قائمة | مرتبط بالشحنات |
| `GET /api/v1/quotations/:id` | تفاصيل | — |
| `POST /api/v1/quotations/:id/offers` | إضافة عرض | يتحقق من ملكية الشركة |
| `POST /api/v1/quotations/:id/award` | منح العرض | — |

**التوصية:** توحيده مع RFQ أو إخفاؤه من الواجهة. وجود مجالين متوازيين بيخلق لبس للمستخدم.

### 6.6 المستندات

| المسار | الوظيفة | الحالة |
|---|---|---|
| `GET /api/v1/documents` | قائمة | جيد |
| `GET /api/v1/documents/:id` | Metadata | لا يعيد الملف |
| `POST /api/v1/documents/:id/validate` | تحقق AI | **لا يرسل الملف** — Fallback دائم |
| `POST /api/v1/shipments/:id/documents` | رفع | يعتمد على `STORAGE_PATH` |

### 6.7 الذكاء الاصطناعي والتجارة والتكلفة

| المسار | الحالة |
|---|---|
| `POST /api/v1/ai/copilot` | Fallback — لا يوجد مزود |
| `POST /api/v1/ai/predict-delay` | Fallback — `estimatedDelayDays: 0` |
| `POST /api/v1/costs/landed-cost` | Deterministic — شغال |
| `GET /api/v1/trade/status` | شغال — يوضح التهيئة |
| `GET /api/v1/trade/overview` | شغال — UN Comtrade + Cache 30 دقيقة |

---

## 7) قاعدة البيانات: نقاط القوة والنواقص

### 7.1 نقاط القوة

- 21 جدولًا بعلاقات واضحة وIndexes مناسبة للاستعلامات الأساسية.
- `BookingRequest.quoteId` عليه `@unique` — يمنع حجزين لنفس العرض.
- `RfqRecipient` عليه Unique مركب.
- Cascades مناسبة للحذف.
- Audit log منظم مع `requestId` و`metadata`.
- `sessionVersion` لإلغاء الجلسات.
- فصل `platformRole` عن `Membership`.

### 7.2 النواقص الهيكلية

| النقص | التأثير | المقترح |
|---|---|---|
| لا يوجد ربط مباشر بين `BookingRequest` و`Shipment` | تأكيد الحجز لا ينشئ شحنة | إضافة `shipmentId` أو إنشاء Shipment عند التأكيد |
| `Company.organizationId` Scalar بدون Relation | صعب الاستعلام والتنظيف | إضافة علاقة `Organization` |
| `Document` بدون `contentType`/`size`/`uploadedBy` | صعب العرض والتحقق | إضافة الحقول |
| `CompanyDocument` Metadata فقط | مفيش ملف حقيقي | تخزين Object + Checksum |
| لا يوجد `Notification` | مفيش إشعارات | جدول + Queue |
| لا يوجد `PasswordResetToken`/`EmailVerification` | مفيش استعادة كلمة مرور/تحقق بريد | إضافتها. **تمت إضافة `CompanyInvitation` لدعوات الشركات في 2026-10-20.** |
| لا يوجد `FxRate` | عروض بعملات مختلفة بدون مقارنة | جدول أسعار صرف |
| لا يوجد `Container`/`RouteLeg`/`SavedSearch` | نواقص لوجستية | إضافتها لاحقًا |
| لا يوجد PostGIS | لا خرائط/مسافات | تفعيله عند الحاجة |
| الحالات نصوص حرة بدون Check Constraints | قيم شاذة ممكنة | Enums أو Check |
| البريد غير موحّد (Case-sensitive) | تكرار حسابات | `lower(email)` + Unique |
| لا يوجد Soft Delete | حذف نهائي | `deletedAt` للكيانات المهمة |
| Audit Log قابل للتعديل من التطبيق | ليس Immutable | Trigger/Append-only role |

---

## 8) الأمان

### 8.1 ما هو جيد فعلاً

| التحكم | الدليل |
|---|---|
| bcrypt للباسورد | cost 10 |
| JWT مع انتهاء صلاحية | 12 ساعة للتطبيق، 8 ساعات للإدارة |
| إلغاء الجلسات | `sessionVersion` + تحقق من DB كل طلب |
| فصل صلاحيات المنصة | `platformRole` وليس `Membership` |
| Tenant Isolation | اختبارات Cross-tenant |
| Rate Limit | 100/دقيقة عام، 20/دقيقة للدخول والتسجيل |
| CORS Allow-list | إلزامي في الإنتاج |
| Fail-fast للإنتاج | يرفض البدء بدون DB أو JWT قوي |
| Security Headers | nosniff / frame / referrer / permissions |
| Audit Log | مع Request ID وRedaction |
| Upload Validation | 2MB + قائمة أنواع مسموحة |

### 8.2 الثغرات والمخاطر

| الخطورة | المشكلة | التأثير | الحل |
|---|---|---|---|
| **حرجة** | `.env` المحلي فيه بيانات الإنتاج | أي تشغيل محلي يكتب في Production | استخدام DB محلية افتراضيًا + سكربت منفصل للإنتاج |
| **حرجة** | كلمة مرور DB تم مشاركتها في محادثة | تسريب محتمل | تدوير كلمة المرور فورًا |
| **عالية** | لا يوجد Backup/Volume مؤكد | تكرار ضياع البيانات | Volume + Backups + نسخ خارجية |
| **عالية** | التوكن في `localStorage` | XSS يسرق الجلسة | HttpOnly Cookie + CSRF، أو CSP صارم |
| **عالية** | لا يوجد MFA للإدارة | سرقة حساب أدمن | TOTP/WebAuthn |
| **متوسطة** | `trustProxy` غير مفعّل | Rate limit على IP الـ Proxy | تفعيله + Redis |
| **متوسطة** | Rate limit في الذاكرة | لا يعمل مع أكثر من Instance | Redis |
| **متوسطة** | لا يوجد CSP | XSS أوسع | إضافة Content-Security-Policy |
| **متوسطة** | لا يوجد قفل حساب بعد محاولات فاشلة | Brute force بطيء | قفل مؤقت/Backoff |
| **منخفضة** | لا يوجد Email Verification | حسابات وهمية | إرسال تحقق |
| **منخفضة** | لا يوجد Dependency Audit | مكتبات قديمة | `pnpm audit` + Dependabot |
| **منخفضة** | لا يوجد Graceful Shutdown | قطع طلبات عند النشر | SIGTERM handler |

**بخصوص كلمة مرور قاعدة البيانات:** تم إرسالها في المحادثة كنص واضح. لازم تدويرها من Railway → Postgres → Variables، وتحديث `DATABASE_URL` في خدمة الـ API، وعدم حفظها في ملف محلي.

---

## 9) التشغيل والنشر

| البند | الواقع | التقييم |
|---|---|---|
| API | منشور ويعمل | جيد |
| Web | **رابط النشر غير موثق**؛ محاولات `naql-ai-platform…/login` رجعت 404 من الـ API | يحتاج تأكيد |
| Railway Config | لا يوجد `railway.json` في الريبو | الإعدادات كلها من Dashboard |
| Root start | `pnpm start:api` فقط | لازم خدمة Web منفصلة |
| Migration | 3 migrations + Baseline | جيد |
| Pre-deploy | غير مؤكد | يجب `pnpm db:deploy` قبل النشر |
| Backup | سكربتات موجودة، لكن مفيش Schedule | ناقص |
| Volume | **لم يتم التحقق** | خطر |
| Archive | `off` | خطر |
| CI/CD | لا يوجد | ناقص |
| Monitoring | لا يوجد APM/Uptime | ناقص |
| Error Tracking | لا يوجد Sentry | ناقص |
| Staging | لا يوجد | خطر |
| Storage | `STORAGE_PATH` غير مؤكد في الإنتاج | خطر |
| AI Service | غير منشور/غير مهيأ | Fallback |
| Graceful Shutdown | غير موجود | متوسط |
| `trustProxy` | غير مفعّل | متوسط |

### 9.1 مشكلة البيئة المحلية

ملف `.env` الحالي:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
NODE_ENV=development
JWT_SECRET=dev-only-secret-change-me
NEXT_PUBLIC_API_URL=https://naql-ai-platform-production.up.railway.app
```

ده معناه:
- الـ API المحلي على `localhost:4000` متصل بـ **Production DB**.
- أي تجربة محلية (شحنة، شركة، حجز) بتتكتب في بيانات السيرفر.
- أي `prisma migrate dev` محلي ممكن يعمل Reset للإنتاج.

**الحل الفوري:**

```powershell
# في .env المحلي
# DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

مع تشغيل قاعدة محلية:

```powershell
pnpm --filter @naql/api db:dev
pnpm db:deploy
pnpm db:seed
```

---

## 10) المخاطر مرتبة حسب الأولوية

### P0 — لازم يتصلح فورًا

| # | المشكلة | الأثر | الإجراء |
|---|---|---|---|
| P0-1 | `.env` المحلي على Production DB | كتابة/مسح بيانات حقيقية | فصل البيئات |
| P0-2 | لا Volume/Backup مؤكد | ضياع كل البيانات مرة تانية | Volume + Backup + Restore Drill |
| P0-3 | كلمة مرور DB مكشوفة | اختراق القاعدة | تدوير فوري |
| P0-4 | بيانات ديمو + شارات «موثقة» | تضليل قبل الإطلاق | حذف الديمو قبل التشغيل الحقيقي |
| P0-5 | لا Staging | أي Migration/تجربة على الإنتاج | بيئة Staging + DB منفصلة |

### P1 — خلال أسبوعين

| # | المشكلة | الأثر | الإجراء |
|---|---|---|---|
| P1-1 | المستندات في الذاكرة/بدون تحميل | فقدان الملفات عند Restart | S3/R2 + Download Endpoint |
| P1-2 | الحجز لا ينشئ شحنة | انقطاع الـ Workflow | ربط Booking → Shipment |
| P1-3 | Dashboard/الشحنات ضعيفة | تجربة مستخدم سيئة | إعادة بناء الصفحتين |
| P1-4 | لا إشعارات/بريد/استعادة كلمة مرور | مستخدمون عالقون | Resend/SES + Tokens |
| P1-5 | AI Fallback | وعود غير قابلة للتنفيذ | إخفاء أو تهيئة مزود |
| P1-6 | المجال القديم Quotations | لبس | دمج/إخفاء |
| P1-7 | لا CI/E2E/مراقبة | أخطاء تصل للإنتاج | GitHub Actions + Sentry + Uptime |
| P1-8 | `trustProxy`/Rate limit | حماية ضعيفة | Redis + إعدادات Proxy |

### P2 — تحسينات مهمة

| # | المشكلة | الإجراء |
|---|---|---|
| P2-1 | Analytics/Settings Placeholder | تنفيذ 3 مؤشرات أو إزالة من القائمة |
| P2-2 | نصوص إنجليزية وحالات خام | خريطة ترجمة مركزية |
| P2-3 | تصميم غير موحّد بين الصفحات | Design System Pass |
| P2-4 | لا Accessibility/SEO/Footer/Privacy | تحسين شامل |
| P2-5 | حزم مشتركة ميتة | حذف أو استخدام |
| P2-6 | توثيق قديم (TASKS) | تحديث |
| P2-7 | لا تصدير CSV/تقارير قابلة للتنزيل | إضافة |

---

## 11) خطة الترتيب المقترحة

### المرحلة 0 — تأمين الإنتاج (يوم واحد)

**الهدف:** منع تكرار ضياع البيانات.

1. تدوير كلمة مرور PostgreSQL.
2. التأكد من Volume على `/var/lib/postgresql/data`.
3. تفعيل Backups في Railway.
4. أخذ Backup يدوي فوري:
   ```powershell
   pnpm db:backup -- --out "D:\naql-backups\prod-2026-10-20.json"
   ```
5. جدولة Backup يومي إلى تخزين خارجي (Google Drive/S3/OneDrive).
6. تغيير `.env` المحلي إلى قاعدة محلية.
7. إضافة `pnpm db:deploy` كـ Pre-deploy command.

**معيار النجاح:** إعادة تشغيل API + Restart للـ DB لا تفقد البيانات، ونسخة Backup خارجية موجودة ومُختبرة.

### المرحلة 1 — Demo-Ready (3–5 أيام)

**الهدف:** الموقع يبان محترم لأي عميل أو مستثمر.

1. إعادة كتابة الصفحة الرئيسية بالعربي بالكامل، وإزالة/توسيم بيانات `SHP-001…` كديمو.
2. Dashboard جديد: 4 بطاقات (شحنات، RFQs، عروض، حجوزات) + آخر النشاط + إجراءات سريعة.
3. صفحة الشحنات: قائمة منسدلة للموانئ، ترجمة الحالات، صفحة تفاصيل + Timeline + مستندات.
4. صفحة RFQ: جدول مقارنة (شركة، سعر، مدة، صلاحية) بدل عرض `companyId`.
5. ترجمة كل الـ Enums في الواجهة.
6. إخفاء `analytics` و`settings` من القائمة أو وضع «قريبًا» واضح.
7. صفحة تكلفة: جدول تفصيلي بدل JSON.
8. إضافة Footer + سياسة خصوصية + شروط استخدام.

**معيار النجاح:** مستخدم جديد يقدر يدخل، يعمل شحنة، يطلب عرض، يقبل، يشوف حجز — كله بالعربي وبدون نصوص إنجليزية.

### المرحلة 2 — تشغيل حقيقي (2–3 أسابيع)

1. تخزين مستندات حقيقي (S3/R2) + تحميل آمن.
2. ربط الحجز بالشحنة تلقائيًا.
3. بريد إلكتروني (تحقق + استعادة كلمة مرور + إشعارات).
4. إدارة أعضاء المنظمة والدعوات.
5. MFA للإدارة + HttpOnly Cookie.
6. CI/CD + Staging + Sentry + Uptime.
7. Backup آلي + Restore Drill شهري.
8. إزالة بيانات الديمو قبل الإطلاق.

### المرحلة 3 — التميز (2–4 أسابيع)

1. تهيئة مزود AI حقيقي + Grounding على بيانات المنصة.
2. استخراج مستندات (OCR) + تحقق Cross-document.
3. HS Codes مع مراجعة بشرية.
4. نموذج تأخير حقيقي (أو إخفاء الميزة).
5. تحليلات وتقارير + تصدير CSV.
6. خرائط ومسارات + حاويات.
7. Multi-currency + FX.
8. تحسين الأداء وCore Web Vitals.

---

## 12) تفاصيل الصفحات: ماذا يتغير عمليًا

### 12.1 الصفحة الرئيسية

**المشاكل الحالية:**
- جمل إنجليزية داخل نص عربي: `importers, exporters…`, `Real API integration first…`.
- بطاقات الميزات فيها وصف إنجليزي.
- معاينة `SHP-001 · JED → RUH` غير معلّمة كديمو.
- قسم `Security and operational discipline` إنجليزي بالكامل.
- مفيش Footer/روابط قانونية.

**المطلوب:**
- نسخة عربية 100%.
- Hero واضح: «منصة واحدة للشحن والعروض والتخليص».
- 3 خطوات: أنشئ شحنة → اطلب عروض → تابع الحجز.
- شعارات/أرقام حقيقية فقط، أو ديمو معلّم.
- CTA واحد أساسي (إنشاء حساب) وثانوي (دليل الشركات).
- Footer: عن المنصة، الخصوصية، الشروط، التواصل.

### 12.2 Dashboard

**المطلوب:**
- 4 KPI Cards: شحنات نشطة، RFQs مفتوحة، عروض بانتظار القرار، حجوزات مؤكدة.
- قائمة «آخر الشحنات» مع الحالة.
- «بانتظار إجراء منك» (عروض/حجوزات).
- روابط سريعة.
- إزالة عرض JSON لحالة API (يظهر فقط لو فيه مشكلة).

### 12.3 الشحنات

**المطلوب:**
- Select للميناء من `/api/v1/ports` بدل إدخال ID.
- Select للـ Mode/Incoterm بالعربي.
- Validation واضحة.
- صفحة `/shipments/[id]`:
  - بيانات الشحنة.
  - Timeline من `milestones`.
  - المستندات.
  - أزرار تغيير الحالة حسب الـ transitions.
- فلاتر: الحالة/الوسيلة/التاريخ.
- Pagination.

### 12.4 RFQ

**المطلوب:**
- جدول مقارنة: الشركة، الإجمالي، العملة، مدة العبور، الصلاحية، الحالة، زر اختيار.
- اسم الشركة بدل `companyId`.
- تنبيه انتهاء الصلاحية.
- فلترة بالحالة.
- Timeline: تم الإنشاء → عروض → قبول → حجز.

### 12.5 العروض القديمة (Quotations)

**الخيار الأفضل:** إزالتها من الـ Navigation ودمج بياناتها في RFQ.  
**لو هتفضل:** استبدال `providerId` بقائمة شركات، وإخفاء نموذج إضافة العرض عن العميل.

### 12.6 المستندات

**المطلوب:**
- حفظ الملف فعليًا (S3/R2) مع `contentType` و`size`.
- `GET /api/v1/documents/:id/download` مع تحقق ملكية.
- معاينة PDF/صورة داخل الصفحة.
- إظهار نتيجة التحقق بشكل منظم، وليس JSON خام.
- إخفاء زر «التحقق (AI)» لو المزود غير مهيأ.

### 12.7 الإعدادات والتحليلات

- إما تنفيذ:
  - إدارة الأعضاء والأدوار.
  - 3 رسوم بيانية (شحنات/حالة، عروض/عملة، حجوزات/شهر).
- أو إزالتهم من الـ Navigation لحين التنفيذ.

### 12.8 الإدارة

- إضافة «إنشاء مستخدم/دعوة».
- تصدير CSV لكل جدول.
- بطاقة «آخر Backup» و«حالة Volume».
- إخفاء أزرار غير المدعومة لدور SUPPORT.

---

## 13) قرارات مطلوبة منك

1. **رابط نشر الواجهة (Web) إيه؟** الـ API معروف، لكن الويب مش موثق في الريبو.
2. **خطة Railway الحالية إيه؟** هل فيها Volume وBackups؟ (لازم نتأكد قبل أي خطوة).
3. **الهدف دلوقتي:** ديمو للعرض، ولا تشغيل حقيقي بعملاء؟
4. **بيانات الديمو:** نسيبها للعرض ولا نشيلها قبل الإطلاق؟
5. **ميزانية AI:** هل هنستخدم OpenAI/Anthropic، ولا موديل محلي؟
6. **البريد:** Resend ولا SES ولا Gmail SMTP؟
7. **البيانات الأصلية:** هل فيه قائمة عملاء/شركات قديمة نعيد إدخالها، ولا نبدأ من الصفر؟

---

## 14) ملحق: أوامر مفيدة

```powershell
# فحص الحالة
curl https://naql-ai-platform-production.up.railway.app/health
curl https://naql-ai-platform-production.up.railway.app/ready

# حالة الـ migrations
pnpm db:status

# Backup
pnpm db:backup
pnpm --filter @naql/api db:backup -- --out "D:\naql-backups\prod.json"

# Restore (تجربة أولًا)
pnpm --filter @naql/api db:restore -- --file backups\prod.json --dry-run

# بيانات الديمو
pnpm db:seed:demo -- --yes
pnpm db:seed:demo:remove -- --yes

# تطوير محلي آمن
pnpm --filter @naql/api db:dev
pnpm db:deploy
pnpm db:seed

# فحص الأنواع
pnpm --filter @naql/api exec tsc --noEmit -p tsconfig.build.json
pnpm --filter @naql/web typecheck
```

> **تحذير:** لا تشغّل `prisma migrate dev` أو `prisma db push --force-reset` أو `prisma migrate reset` مع `DATABASE_URL` الإنتاج. استخدم `prisma migrate deploy` فقط.

---

## 15) الملفات المعدلة/المضافة في هذه الجولة

| الملف | التغيير |
|---|---|
| `apps/api/scripts/seed-demo.ts` | بيانات ديمو + حذف |
| `apps/api/scripts/db-backup.ts` | Backup JSON |
| `apps/api/scripts/db-restore.ts` | Restore مع Dry-run |
| `apps/api/scripts/db-tables.ts` | ترتيب الجداول |
| `apps/api/src/config/env.ts` | حماية التيستات من DB بعيدة |
| `apps/api/package.json` | أوامر `db:seed:demo`, `db:backup`, `db:restore` |
| `package.json` | أوامر الجذر |
| `turbo.json` | متغيرات البيئة |
| `.gitignore` | `backups/` |
| `docs/database-operations.md` | دليل التشغيل |
| `docs/local-development.md` | متطلبات Railway |
| `apps/api/prisma/schema.prisma` | إزالة `directUrl` غير المستخدم |

**ملاحظة:** كل التغييرات غير مُلتزمة (Uncommitted) — لم يتم عمل Commit أو Push.

---

## 16) ما لم يتم التحقق منه في هذه الجولة

- وجود Volume فعلي على Railway (يحتاج Dashboard).
- وجود Backups أو Snapshots قديمة.
- رابط نشر الواجهة (Web).
- قيمة `STORAGE_PATH` و`AI_SERVICE_URL` في بيئة Railway.
- تشغيل `pnpm build` أو `pnpm test` الكامل (سيرفر التطوير ماسك ملف Prisma DLL).
- اختبار CORS من دومين الويب الفعلي.
- اختبار الـ Webhooks/البريد (غير موجودة أصلًا).

**الخلاصة:** الأساس التقني موجود، لكن المنتج محتاج جولة تركيز على **تأمين البيانات + تجربة الديمو + إغلاق الفجوات الوظيفية** قبل أي توسع في الذكاء الاصطناعي.
