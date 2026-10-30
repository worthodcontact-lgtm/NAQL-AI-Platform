# NAQL AI — الفصل بين إدارة المنصة ومساحات الشركات والتعاون داخل الشحنة

> حالة الوثيقة: **تم تنفيذ الأساس على قاعدة محلية واختباره. لم يُطبَّق على قاعدة الإنتاج بعد.**
> تاريخ المراجعة: 2026-10-20.
> النطاق: `apps/api/prisma/schema.prisma`، ومسارات API في `apps/api/src`، وواجهات `apps/web/app`.

## 0. حالة التنفيذ (2026-10-20)

تم تنفيذ الترحيل الإضافي والصلاحيات الأساسية محلياً:

- ترحيل `20261020090000_access_separation` أُضيف وطُبّق على PostgreSQL المحلي.
- `Membership` أصبح يحمل `status` و`invitedByUserId` و`acceptedAt`، ويُستخدم كـ`CompanyMembership` فعلياً.
- أُضيف `CompanyInvitation` للدعوات البريدية قبل وجود حساب.
- أُضيف `ShipmentParty` بأعلام صلاحيات لكل شحنة.
- أُضيف `Document.visibility` و`uploadedByOrganizationId` و`uploadedByUserId`.
- أُضيفت مسارات `/api/v1/company/*` للأعضاء والدعوات، و`/api/v1/auth/organizations` و`/api/v1/auth/switch-organization`.
- فُرضت صلاحيات الشركة على الشحنات والمستندات والعروض وRFQ والحجوزات والتكاليف والشركات.
- رُفضت رموز جلسة الإدارة (`scope: admin`) على مسارات الشركة.
- فُصلت مستندات الشحنات ومستندات التحقق الإدارية خلف صلاحيات مخصصة وسبب مسجل وتدقيق.
- أُضيفت واجهات: `settings` لإدارة الفريق ومساحات العمل، وصفحة تفاصيل شحنة لإدارة الأطراف والصلاحيات، واختيار ظهور المستند.
- نُفّذت اختبارات الفصل: **10 حالات جديدة** ضمن ملف `access-separation.test.ts`، وحالة إضافية لعزل عروض المنافسين في `companies-rfq.test.ts`. بعد إضافات Phase 1 أصبح الإجمالي **99 اختباراً ناجحاً** على قاعدة اختبار محلية منفصلة.

**لم يتم** تطبيق الترحيل على قاعدة الإنتاج، ولم تُنشر أي تغييرات. هذا مقصود: الترحيل يحتاج نسخة احتياطية ومراجعة قبل التنفيذ.


## 1. الخلاصة التنفيذية

البنية الحالية **تحقق بالفعل جزءاً مهماً من الفصل**:

- دور المنصة (`User.platformRole`) منفصل تماماً عن عضوية المنشأة (`Membership`).
- دخول الإدارة منفصل عبر `/admin/login` و`scope: "admin"`، وكل مسار إداري يمر بـ`requirePermission`.
- `SUPER_ADMIN` لا يصبح عضواً تلقائياً في أي شركة، ولا توجد أي علاقة مباشرة بين دور المنصة وبيانات الشركة.
- لوحة الإدارة في الواجهة منفصلة عن لوحة الشركة، و`AdminGuard` لا يعتمد عليه كحد أمني.
- توجد اختبارات سلبية تثبت أن مستخدم الشركة لا يستطيع استدعاء مسارات الإدارة، وأن الأدوار الدنيا لا تنفّذ عمليات `SUPER_ADMIN`.

لكن توجد **فجوات جوهرية** تمنع اعتبار الفصل مكتملاً:

| # | الفجوة | الأثر |
|---|---|---|
| G1 | لا توجد إدارة أعضاء داخل مساحة الشركة (دعوة، تغيير دور، إزالة). | كل مستخدم في المنشأة هو `ORG_ADMIN` فعلياً؛ لا مبدأ أقل صلاحية. |
| G2 | لا توجد أدوار شركة تشغيلية (عمليات، لوجستيات، مالية، مستندات، مطّلع). | أي عضو يستطيع تنفيذ كل عمليات الشركة. |
| G3 | لا يوجد كيان `ShipmentParty` ولا صلاحيات لكل شحنة. | الشحنة مملوكة لمنشأة واحدة فقط، ولا يوجد تعاون حقيقي بين عدة شركات. |
| G4 | المستندات مرتبطة بالشحنة فقط، بلا مالك أو مستوى ظهور. | أي طرف في الشحنة قد يرى مستندات الطرف الآخر إذا مُنح وصولاً للشحنة. |
| G5 | مسارات الشركة لا تتحقق من `scope`؛ رمز إدارة صالح قد يصل إلى مسارات الشركة إذا كان لحساب الإدارة منشأة. | خلط محتمل بين سياق الإدارة وسياق الشركة. |
| G6 | `GET /api/v1/admin/shipments/:id` يعيد بيانات المستندات الوصفية لأي دور لديه `shipments.read`، بما فيها `SUPPORT`. | وصول إداري غير صريح وغير مسجل إلى بيانات تجارية حساسة. |
| G7 | `GET /api/v1/admin/companies/:id` يعيد بيانات مستندات التحقق لأي دور لديه `companies.read`، بما فيها `SUPPORT`. | نفس المشكلة في مستندات التحقق. |
| G8 | لا يوجد تبديل سياق آمن بين أكثر من عضوية/منشأة، ولا توجد دعوات بريدية. | المستخدم مرتبط بمنشأة واحدة (`User.organizationId`)؛ دعوة عضو جديد غير ممكنة. |
| G9 | بعض مسارات السوق (RFQ) تسمح لشركة بتقديم عرض إذا عرفت المعرّف حتى دون دعوة صريحة. | IDOR على مستوى العرض/الاقتباس. |
| G10 | لا توجد اختبارات تعاون شحنة متعددة الشركات، ولا اختبارات رفع الصلاحية الذاتية، ولا اختبارات مستندات الطرف الآخر. | لا يوجد دليل اختبار على المتطلبات الأساسية. |

**حالة الفجوات بعد التنفيذ المحلي:**

| الفجوة | الحالة |
|---|---|
| G1 | مغلقة: إدارة أعضاء ودعوات وتغيير أدوار وإزالة. |
| G2 | مغلقة: 7 أدوار شركة مع مصفوفة صلاحيات. |
| G3 | مغلقة: `ShipmentParty` وأعلام صلاحيات لكل شحنة. |
| G4 | مغلقة: `Document.visibility` + ملكية المستند. |
| G5 | مغلقة: `company_session_required` يمنع رموز الإدارة. |
| G6 | مغلقة: الوثائق خلف `documents.read_sensitive` + سبب + تدقيق. |
| G7 | مغلقة: وثائق التحقق خلف `companies.documents.read` + سبب + تدقيق. |
| G8 | مغلقة: دعوات بريدية وتبديل مساحة عمل مع إبطال الرمز السابق. |
| G9 | مغلقة: العرض يتطلب دعوة صريحة (`RfqRecipient`) أو طرف شحنة بصلاحية `canQuote`. |
| G10 | مغلقة: 10 اختبارات فصل جديدة + اختبار عزل عروض RFQ، منها سلبيات صريحة. |

## 2. مطابقة النموذج الحالي بالمطلوب

| المطلوب | الموجود حالياً | القرار |
|---|---|---|
| `User` | `User` | يبقى. |
| `PlatformRole` | `User.platformRole` + `auth/permissions.ts` | يبقى كمصدر وحيد لسلطة المنصة. |
| `Company` | `Company` (ملف تجاري) + `Organization` (مساحة العمل/المستأجر) | `Organization` هي مساحة عمل الشركة، و`Company` هي الهوية التجارية داخل الدليل. عضوية الشركة تُربط بـ`Organization`. |
| `CompanyMembership` | `Membership` (organizationId + userId + role) | لا ننشئ جدولاً مكرراً. نوسّع `Membership` بحالة الدعوة والأدوار التشغيلية، ونوثّق أنه هو `CompanyMembership` فعلياً. |
| `ShipmentParty` | غير موجود | يُضاف جدول جديد `ShipmentParty` مع صلاحيات لكل شحنة. |
| `ShipmentPermission` | غير موجود | الصلاحيات تُخزَّن كأعلام على `ShipmentParty` (صف واحد لكل شركة/شحنة). هذا يمنع تكرار الجداول ويجعل الاستعلام واضحاً. |
| `AuditLog` | `AuditLog` + `recordAudit` | يبقى. نضيف تدقيقاً لكل تغيير صلاحيات/طرف/وصول استثنائي. |

### لماذا `Organization` = مساحة عمل الشركة؟

النظام الحالي يبني كل البيانات التجارية على `organizationId`:
`Shipment`، `Rfq`، `QuotationRequest`، `BookingRequest`، و`Company.organizationId`.
إعادة تسمية كل هذه العلاقات إلى `companyId` ستكون ترحيلاً كبيراً بلا قيمة أمنية إضافية. الأهم هو **حدود العزل**، وهي موجودة على مستوى `Organization`. لذلك:

- `Organization` = مساحة عمل الشركة (tenant).
- `Company` = الملف التجاري/الدليل الذي يمكن أن تملكه المنشأة.
- `Membership` = عضوية المستخدم في مساحة العمل، مع دور شركة.
- `ShipmentParty` = شركة (ملف تجاري) تشارك في شحنة مملوكة لمنشأة أخرى.

هذا يحقق المطلوب: شركتان في شحنة واحدة لا تندمج مساحتا عملهما، ولا ترى إحداهما بيانات الأخرى خارج ما تسمح به `ShipmentParty`.

## 3. الأدوار والصلاحيات المستهدفة

### 3.1 أدوار المنصة (تبقى كما هي، مع توسيع مصفوفة الصلاحيات)

| الدور الحالي | المرادف المقترح في المتطلب | ملاحظات |
|---|---|---|
| `SUPER_ADMIN` | `SUPER_ADMIN` | يبقى. |
| `ADMIN` | `PLATFORM_ADMIN` | الاسم الحالي متوافق؛ لا نغيّر القيم لتفادي كسر الرموز. |
| `SUPPORT` | `SUPPORT_AGENT` | يبقى. لا يرى مستندات حساسة. |
| `REVIEWER` | `VERIFICATION_REVIEWER` | يبقى. يرى مستندات التحقق اللازمة فقط. |
| — | `FINANCE_ADMIN` | غير منفّذ بعد (لا يوجد نظام اشتراكات/فواتير). لن نضيف دوراً بلا وظائف. |

### 3.2 أدوار الشركة (جديدة، مع توافق خلفي)

| الدور الجديد | المرادف القديم | الصلاحيات المختصرة |
|---|---|---|
| `COMPANY_OWNER` | `ORG_ADMIN`, `OWNER` | كل صلاحيات الشركة، بما فيها إدارة الأعضاء. |
| `COMPANY_ADMIN` | `COMPANY_MANAGER` | كل شيء عدا تغيير ملكية الشركة/تعيين مالك. |
| `OPERATIONS_MANAGER` | — | الشحنات، الأطراف، المستندات، طلبات العروض، الحجوزات، التقارير. |
| `LOGISTICS_OPERATOR` | — | تحديث الشحنات، المستندات، التتبع. |
| `FINANCE_USER` | — | البيانات المالية، التكاليف، قبول العروض. |
| `DOCUMENTS_USER` | — | المستندات فقط. |
| `VIEWER` | `VIEWER` | قراءة فقط. |

الأدوار القديمة تبقى مقبولة وتُترجم إلى الجديدة، حتى لا تتعطل العضويات أو الرموز الحالية.

### 3.3 صلاحيات الشركة

- `company.members.read` / `company.members.manage`
- `company.settings.read` / `company.settings.manage`
- `company.documents.read` / `company.documents.manage`
- `shipments.read` / `shipments.create` / `shipments.update` / `shipments.delete`
- `shipments.parties.manage`
- `shipments.documents.read` / `shipments.documents.upload`
- `shipments.financials.read` / `shipments.financials.manage`
- `rfqs.read` / `rfqs.create`
- `quotes.submit` / `quotes.accept`
- `bookings.read` / `bookings.confirm` / `bookings.tracking`
- `costs.read` / `costs.manage`
- `reports.read`

### 3.4 صلاحيات الشحنة (على `ShipmentParty`)

كل شركة مشاركة تحصل على صف واحد لكل شحنة، بالأعلام التالية:

- `canView` — مشاهدة بيانات الشحنة الأساسية.
- `canUpdateStatus` — تحديث مراحل التنفيذ.
- `canUploadDocuments` — رفع مستندات.
- `canViewDocuments` — الاطلاع على المستندات المشتركة.
- `canViewFinancials` — مشاهدة الأسعار/التكاليف/العروض.
- `canQuote` — تقديم عرض على الشحنة.
- `canManageParties` — إدارة الأطراف المدعوة (بحدود).
- `canConfirmDelivery` — تأكيد الاستلام/التسليم.

القاعدة: **صلاحية الشركة + علم الشحنة** معاً. عضوية `VIEWER` في شركة مشاركة لا تستطيع التحديث حتى لو كان علم الشحنة مفتوحاً.

## 4. خطة الترحيل الآمنة

الترحيل **إضافي (additive)** ولا يحذف أي جدول أو عمود:

1. توسيع `Membership`:
   - `status` (`active` | `invited` | `suspended`) افتراضي `active`.
   - `invitedByUserId`, `acceptedAt`, `updatedAt`.
   - ترحيل كل العضويات الحالية إلى `active`.
2. إضافة `CompanyInvitation` للدعوات البريدية قبل تسجيل المستخدم.
3. إضافة `ShipmentParty` مع علاقاتها.
4. إضافة `Document.visibility` (`shipment` | `private`) و`uploadedByOrganizationId` و`uploadedByUserId`.
5. إضافة صلاحيات المنصة الجديدة `documents.read_sensitive` و`companies.documents.read`.
6. إضافة مسارات `/api/v1/company/*` لإدارة الأعضاء والدعوات.
7. فرض صلاحيات الشركة على المسارات الحالية، مع إبقاء الأدوار القديمة كمرادفات.
8. إضافة `scope` guard يمنع رموز الإدارة من مسارات الشركة.
9. إضافة تدقيق لكل عملية إدارية/صلاحية/وصول استثنائي.
10. إضافة اختبارات سلبية وإيجابية، وتشغيلها على قاعدة محلية.

### توافق خلفي

- `ORG_ADMIN` يظل صالحاً ويمنح صلاحيات `COMPANY_OWNER`.
- `COMPANY_MANAGER` يظل صالحاً ويمنح صلاحيات `COMPANY_ADMIN`.
- `VIEWER` يظل صالحاً.
- أي مستخدم بلا عضوية فعالة لا يحصل على صلاحيات شركة.
- الرموز الحالية لا تُكسر: `loadPrincipal` يحمّل العضويات الفعالة فقط، والدور القديم يُترجم.

## 5. خريطة المسارات المستهدفة

| النطاق | المسار | الحارس |
|---|---|---|
| الشركة | `/api/v1/company` | `app` scope + عضوية فعالة |
| الشركة | `/api/v1/company/members` | `company.members.read` |
| الشركة | `/api/v1/company/members/invite` | `company.members.manage` |
| الشركة | `/api/v1/company/invitations/pending` | `company.members.read` |
| الشركة | `/api/v1/auth/company-invitations` | المستخدم الحالي فقط |
| الشركة | `/api/v1/auth/company-invitations/memberships/:id/accept` | المستخدم المدعو فقط |
| الشركة | `/api/v1/auth/company-invitations/email/:id/accept` | بريد المستخدم الحالي فقط |
| الشركة | `/api/v1/auth/switch-organization` | عضوية فعالة في المنشأة الهدف |
| الشحنات | `/api/v1/shipments` | `shipments.read` / `shipments.create` |
| الشحنات | `/api/v1/shipments/:id/parties` | `shipments.parties.manage` أو علم الشحنة |
| الشحنات | `/api/v1/shipments/:id/documents` | صلاحية شركة + علم الشحنة + ظهور المستند |
| العروض | `/api/v1/quotations/*` | `shipments.financials.*` / `quotes.*` |
| السوق | `/api/v1/rfqs/*` | `rfqs.*` / `quotes.*` + دعوة صريحة |
| الحجوزات | `/api/v1/bookings/*` | `bookings.*` + دور المشاهد المحسوب |
| الإدارة | `/api/v1/admin/*` | `scope: admin` + `requirePermission` |
| الإدارة | `/api/v1/admin/shipments/:id/documents` | `documents.read_sensitive` + سبب + تدقيق |
| الإدارة | `/api/v1/admin/companies/:id/documents` | `companies.documents.read` + سبب + تدقيق |

## 6. نتائج اختبارات القبول

الملف: `apps/api/src/__tests__/access-separation.test.ts` (10 حالات). النتيجة المحلية: **10/10 ناجحة**، والنتيجة الكلية بعد Phase 1: **99/99 ناجحة** (بما فيها اختبارات التخزين والنسخ الاحتياطي والعضويات متعددة الأدوار). وفي وضع الذاكرة بدون PostgreSQL: **60 ناجحاً و39 متخطّى**، لتغطية مسار الـFallback أيضاً. بناء الويب (`next build`) نجح.

| المعيار | الاختبار الذي يثبته | النتيجة |
|---|---|---|
| شركة A لا تقرأ/تعدّل شحنة شركة B | `denies a non-party company any read or write access to a guessed shipment id` | 404 للقراءة والتعديل والحذف |
| شركة مشاركة لا ترى بيانات/مستندات طرف آخر خاصة | `shows a party only its own row...` + `rivalFilenames` | لا ترى سوى المستند المشترك، و404 للمستند الخاص |
| لا يمكن الوصول بتخمين المعرف | نفس الاختبار + `rivalPrivateRead` | 404 |
| صلاحيات الشحنة تُفرض على الخادم | أعلام `canUpdateStatus`/`canUploadDocuments` قبل وبعد المنح | 403 ثم 200 |
| الطرف لا يرفع صلاحياته | `prevents a party from escalating its own shipment permissions` | 403 |
| العروض لا تتسرّب بين المتنافسين | `lets a party see and bid...` + `rivalDetail.offers` | عروض كل شركة فقط |
| عروض RFQ/الحجوزات لا تتسرّب بين المتنافسين | `does not expose competing quotes to an invited provider` | provider يرى عرضه فقط؛ العميل يرى الجميع |
| العضو لا يرقّي نفسه | `invites a new member...` + `selfPromote` | 403 |
| الدعوة مرتبطة بصاحبها | `stolenAccept` | 404 |
| لا انضمام لمساحة بلا عضوية | `denies switching into a workspace without an active membership` | 403 `membership_required` |
| مدير الشركة لا يمنح الملكية ولا يعدّل المالك | `does not let a company admin grant ownership or modify an owner` | 403 |
| رمز الإدارة مرفوض على مسارات الشركة | `rejects an administration session on company routes` | 403 `company_session_required` |
| الدعم لا يرى المستندات الحساسة | `keeps routine support out of sensitive documents...` | 403 |
| الوصول الاستثنائي يسجّل سبباً وتدقيقاً | نفس الاختبار + `audit` و`companyAudit` | 400 بلا سبب، 200 مع سبب، وسجل تدقيق موجود |
| تبديل المساحة لا يسرّب البيانات السابقة | `lets an existing user accept an invitation and switch workspaces...` | الرمز القديم 401، والقائمة الجديدة لا تحتوي شحنة المساحة القديمة |

اختبارات المنصة الموجودة مسبقاً (`admin.test.ts`) تغطي أيضاً: منع دخول العملاء للإدارة، منع `REVIEWER`/`ADMIN` من عمليات `SUPER_ADMIN` فقط، إلغاء الصلاحيات فوراً، وتسجيل التغييرات الحساسة.

## 7. قرارات مطلوبة قبل التوسع في السوق/الذكاء الاصطناعي/الاشتراكات

- هل `Organization` هي الكيان القانوني للشركة، أم أن `Company` هي الكيان القانوني؟ القرار الحالي: `Organization` = مساحة العمل، `Company` = الملف التجاري.
- هل يُسمح لشركة بالظهور في عدة شحنات وبأدوار مختلفة؟ نعم، `ShipmentParty` فريد لكل (شحنة، شركة) مع دور واحد.
- هل يمكن لمالك الشحنة رؤية مستندات الأطراف الخاصة؟ القرار الحالي: نعم لمالك الشحنة، ولا للأطراف الأخرى. يمكن تشديدها لاحقاً.
- هل تُرسل الدعوات بالبريد فعلياً؟ لا توجد خدمة بريد مُهيأة؛ الدعوة تعيد رمزاً/تظهر داخل التطبيق، ويجب توثيق ذلك للمشغل.

## 8. ما لم يُنفَّذ في هذه المرحلة

- `FINANCE_ADMIN` ونظام الاشتراكات/الفواتير: لا يوجد نطاق وظيفي بعد.
- توقيع إلكتروني أو تكامل حكومي للمستندات.
- محرك سياسات ديناميكي (ABAC)؛ الصلاحيات الحالية RBAC + أعلام شحنة.
- MFA للحسابات الإدارية: يحتاج مزود/بنية تحتية، ويُوثّق كخطر متبقٍ.
- تحميل محتوى المستند من التخزين: التخزين الحالي قد يكون ذاكرة؛ الوصول الوصفي فقط.

## 9. معيار الإنجاز

لا يُعلن اكتمال الفصل إلا بعد:

- تطبيق الترحيل على قاعدة محلية ناجحاً.
- نجاح `pnpm --filter @naql/api test` مع قاعدة محلية.
- نجاح اختبارات الفصل الجديدة (سلبية وإيجابية).
- عدم وجود مسار شركة يقبل رمز إدارة، وعدم وجود مسار إداري بلا `requirePermission`.
- توثيق أي فجوة متبقية بصراحة في هذا الملف.

## 10. الترحيل والتشغيل

### 10.1 ملف الترحيل

`apps/api/prisma/migrations/20261020090000_access_separation/migration.sql`

الترحيل **إضافي** ولا يحذف بيانات أعمال:

- يضيف أعمدة إلى `Membership` و`Document`.
- ينشئ `CompanyInvitation` و`ShipmentParty`.
- يضيف الفهارس والعلاقات.
- لا يغيّر أدوار العضويات الحالية ولا يمسح أي سجل.
- `Membership.updatedAt` أُضيف بقيمة افتراضية `CURRENT_TIMESTAMP` حتى تنجح الترقية على الصفوف الموجودة.

تم التحقق من تطابقه مع مخطط Prisma بعد التطبيق المحلي. الفرق الوحيد الذي ظهر في البداية كان Default لـ`updatedAt`، وتم توحيده في `schema.prisma` عبر `@default(now())`.

### 10.2 خطوات التطبيق المحلي (تمت)

```powershell
pnpm --filter @naql/api db:dev
$env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
pnpm --filter @naql/api exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @naql/api test
pnpm --filter @naql/web typecheck
pnpm --filter @naql/web build
```

### 10.3 خطوات الإنتاج (لم تُنفَّذ — تحتاج موافقة ومراجعة)

1. أخذ نسخة احتياطية موثّقة:
   ```powershell
   pnpm --filter @naql/api db:backup
   ```
2. اختبار الاستعادة على قاعدة منفصلة باستخدام `db-restore.ts`، وعدم الاعتماد على وجود Backup نظري:
   ```powershell
   pnpm --filter @naql/api db:restore -- --file "..\..\backups\naql-backup-....json" --dry-run
   ```
3. التأكد من أن `DATABASE_URL` الحقيقي مستخدم في جلسة منفصلة، **وليس** من `.env` المحلي.
4. تطبيق الترحيل فقط (بدون Seed):
   ```powershell
   pnpm --filter @naql/api exec prisma migrate deploy --schema prisma/schema.prisma
   ```
5. التحقق من `/ready` و`/api/v1/ports` و`/api/v1/companies/directory`.
6. مراقبة الأخطاء و`AuditLog` لمدة 24 ساعة.
7. عدم تشغيل `pnpm db:seed:demo` على الإنتاج بعد الإطلاق الحقيقي.

### 10.4 خطة التراجع

الترحيل إضافي، لذلك التراجع الآمن هو إسقاط الكيانات الجديدة وإزالة الأعمدة الجديدة بعد التأكد من عدم استخدامها:

```sql
DROP TABLE IF EXISTS "ShipmentParty";
DROP TABLE IF EXISTS "CompanyInvitation";
DROP INDEX IF EXISTS "Document_shipmentId_visibility_idx";
DROP INDEX IF EXISTS "Document_uploadedByOrganizationId_idx";
ALTER TABLE "Document"
  DROP COLUMN IF EXISTS "visibility",
  DROP COLUMN IF EXISTS "uploadedByUserId",
  DROP COLUMN IF EXISTS "uploadedByOrganizationId";
DROP INDEX IF EXISTS "Membership_userId_status_idx";
DROP INDEX IF EXISTS "Membership_organizationId_status_idx";
ALTER TABLE "Membership"
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "invitedByUserId",
  DROP COLUMN IF EXISTS "acceptedAt",
  DROP COLUMN IF EXISTS "updatedAt";
CREATE INDEX IF NOT EXISTS "Membership_userId_idx" ON "Membership"("userId");
```

لا يُنصح بالتراجع بعد بدء استخدام الدعوات أو أطراف الشحنات؛ في هذه الحالة استخدم نسخة احتياطية موثّقة بدلاً من إسقاط البيانات.

## 11. الفجوات المتبقية بصراحة

- **MFA للإدارة غير منفذ.** يحتاج قرار مزود (TOTP أو WebAuthn) وبنية استعادة.
- **إرسال الدعوات بالبريد غير منفذ.** الدعوة البريدية تعيد رمزاً لمرة واحدة يعرضه المدير؛ لا يوجد Resend/SES.
- **أسماء أدوار المنصة المخزنة قديمة** (`ADMIN`/`REVIEWER`/`SUPPORT`) وتُعرض بالاسم الجديد في الواجهة. توحيد القيم في قاعدة البيانات يحتاج ترحيلاً منفصلاً.
- **`FINANCE_ADMIN` مؤجل** حتى يوجد نطاق اشتراكات/فواتير فعلي.
- **محتوى المستندات ليس له تحميل آمن من تخزين كائنات.** الوصول الحالي وصفي/بيانات وصفية؛ لا تدّعِ وجود تحميل آمن قبل ربط S3/R2 وتوقيع الروابط.
- **لا يوجد ABAC ديناميكي.** الفصل الحالي RBAC + أعلام لكل شحنة.
- **كلمة مرور قاعدة الإنتاج التي ظهرت في المحادثة لم تُدوَّر بعد.** تم تحويل `.env` المحلي إلى قاعدة التطوير، لكن التدوير الفعلي يحتاج صلاحية لوحة Railway.
- **الإنتاج لم يُرحَّل بعد.** لا تعتبر الفصل منشوراً أو مكتملاً إنتاجياً بناءً على هذه الوثيقة وحدها.
