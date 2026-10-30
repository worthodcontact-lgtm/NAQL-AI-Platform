"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { ACCOUNT_TYPE_LABEL, roleLabel, tradeRoleLabel } from "@/lib/auth";

const COMPANY_ROLES = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "OPERATIONS_MANAGER",
  "LOGISTICS_OPERATOR",
  "FINANCE_USER",
  "DOCUMENTS_USER",
  "VIEWER"
];

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  invited: "دعوة معلّقة",
  suspended: "موقوف"
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "neutral" | "error"> = {
  active: "success",
  invited: "warning",
  suspended: "error"
};

interface CompanyContextResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
    accountType?: "customer" | "provider";
    tradeRole?: "importer" | "exporter" | "both" | null;
  } | null;
  context: {
    accountType?: "customer" | "provider";
    tradeRole?: "importer" | "exporter" | "both" | null;
    isProvider?: boolean;
    roles: string[];
    permissions: string[];
    isOwner: boolean;
    isAdmin: boolean;
  };
}

interface Member {
  id: string;
  role: string;
  roles?: string[];
  status: string;
  createdAt: string;
  user: { id: string; email: string; displayName: string; status: string };
}

interface PendingInvitations {
  memberships: { id: string; role: string; createdAt: string; user: { id: string; email: string; displayName: string } }[];
  emailInvitations: { id: string; email: string; role: string; expiresAt: string; createdAt: string }[];
}

interface MyInvitations {
  memberships: { id: string; role: string; createdAt: string; organization: { id: string; name: string; slug: string } }[];
  emailInvitations: { id: string; role: string; expiresAt: string; organization: { id: string; name: string; slug: string } }[];
}

interface Workspace {
  id: string;
  role: string;
  status: string;
  organization: { id: string; name: string; slug: string };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "insufficient_company_permission") return "لا تملك الصلاحية لهذا الإجراء.";
    if (error.code === "last_owner") return "لا يمكن إزالة أو تخفيض آخر مالك للشركة.";
    if (error.code === "cannot_change_own_role") return "لا يمكنك تغيير دورك بنفسك.";
    if (error.code === "cannot_remove_self") return "لا يمكنك إزالة عضويتك بنفسك.";
    if (error.code === "role_not_assignable") return "لا يمكنك منح هذا الدور.";
    if (error.code === "owner_required") return "هذا الإجراء متاح لمالك الشركة فقط.";
    if (error.code === "membership_required") return "لا توجد عضوية نشطة في مساحة العمل المطلوبة.";
    return error.message;
  }
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع";
}

export default function SettingsPage() {
  const router = useRouter();
  const { login, refresh } = useAuth();
  const [context, setContext] = useState<CompanyContextResponse | null>(null);
  const [tradeRole, setTradeRole] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvitations | null>(null);
  const [myInvitations, setMyInvitations] = useState<MyInvitations | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("VIEWER");
  const [inviteToken, setInviteToken] = useState("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});

  const permissions = useMemo(() => new Set(context?.context.permissions ?? []), [context]);
  const canManageMembers = permissions.has("company.members.manage");
  const canReadMembers = permissions.has("company.members.read");
  const canManageSettings = permissions.has("company.settings.manage");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const company = await apiFetch("/api/v1/company");
      setContext(company);
      setTradeRole(company.organization?.tradeRole ?? "");

      const orgs = await apiFetch("/api/v1/auth/organizations");
      setWorkspaces(orgs.items ?? []);

      const invites = await apiFetch("/api/v1/auth/company-invitations");
      setMyInvitations(invites);

      if (company.context?.permissions?.includes("company.members.read")) {
        const [memberRes, pendingRes] = await Promise.all([
          apiFetch("/api/v1/company/members"),
          apiFetch("/api/v1/company/invitations/pending")
        ]);
        setMembers(memberRes.items ?? []);
        setPending(pendingRes);
      } else {
        setMembers([]);
        setPending(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableRoles = useMemo(() => {
    if (!context) return COMPANY_ROLES;
    if (context.context.isOwner) return COMPANY_ROLES;
    if (context.context.isAdmin) return COMPANY_ROLES.filter((role) => role !== "COMPANY_OWNER" && role !== "COMPANY_ADMIN");
    return [];
  }, [context]);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function inviteMember() {
    await run(async () => {
      const res = await apiFetch("/api/v1/company/members/invite", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole })
      });
      setInviteToken(res.invitation?.token ?? "");
      setInviteEmail("");
    }, "تم إنشاء الدعوة.");
  }

  async function updateRole(member: Member) {
    const role = roleDrafts[member.id] ?? member.role;
    await run(async () => {
      await apiFetch(`/api/v1/company/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
    }, "تم تحديث الدور.");
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`إزالة ${member.user.displayName} من مساحة العمل؟`)) return;
    await run(async () => {
      await apiFetch(`/api/v1/company/members/${member.id}`, { method: "DELETE" });
    }, "تمت إزالة العضو.");
  }

  async function revokeInvitation(id: string) {
    await run(async () => {
      await apiFetch(`/api/v1/company/invitations/${id}`, { method: "DELETE" });
    }, "تم إلغاء الدعوة.");
  }

  async function acceptMembership(id: string) {
    await run(async () => {
      await apiFetch(`/api/v1/auth/company-invitations/memberships/${id}/accept`, { method: "POST" });
    }, "تم قبول الدعوة. يمكنك الآن التبديل إلى مساحة العمل.");
  }

  async function acceptEmailInvitation(id: string) {
    await run(async () => {
      await apiFetch(`/api/v1/auth/company-invitations/email/${id}/accept`, { method: "POST" });
    }, "تم قبول الدعوة.");
  }

  async function switchWorkspace(workspace: Workspace) {
    await run(async () => {
      const res = await apiFetch("/api/v1/auth/switch-organization", {
        method: "POST",
        body: JSON.stringify({ organizationId: workspace.organization.id })
      });
      if (res.token) login(res.token);
      router.refresh();
    }, "تم تبديل مساحة العمل. سيتم تحميل بيانات المساحة الجديدة فقط.");
  }

  async function saveTradeRole() {
    await run(async () => {
      await apiFetch("/api/v1/company/account", {
        method: "PATCH",
        body: JSON.stringify({ tradeRole: tradeRole || null })
      });
      refresh();
    }, "تم تحديث نشاط التجارة الخارجية للمنظمة.");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">فريق الشركة ومساحات العمل</h1>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">فريق الشركة ومساحات العمل</h1>
        <p className="mt-2 text-sm text-slate-600">
          الأدوار هنا خاصة بمساحة عمل الشركة فقط. لا تمنح أي منها صلاحية إدارة المنصة،
          والوصول إلى شحنة مشتركة يُحدد لكل شحنة على حدة.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-teal/30 bg-teal/10 px-4 py-3 text-sm text-teal-dark">{notice}</div>
      ) : null}

      <Card>
        <CardHeader title="مساحة العمل الحالية" subtitle="بيانات المنشأة والدور الحالي" />
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-semibold text-navy">{context?.organization?.name ?? "غير متاح"}</span>
            <span className="text-xs text-slate-500">{context?.organization?.slug}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(context?.context.roles ?? []).map((role) => (
              <Badge key={role} variant="info">{roleLabel(role)}</Badge>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            عدد الصلاحيات الفعالة: {context?.context.permissions.length ?? 0}. الصلاحيات تُفحص على الخادم في كل طلب.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="تصنيف الحساب ونشاط التجارة"
          subtitle="التصنيف لا يمنح أدواراً. حساب العميل لا يحصل على صلاحيات المزوّد إلا بإنشاء ملف منشأة مزوّدة."
        />
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">نوع الحساب:</span>
            <Badge variant={context?.organization?.accountType === "provider" ? "info" : "neutral"}>
              {ACCOUNT_TYPE_LABEL[context?.organization?.accountType ?? "customer"]}
            </Badge>
            {context?.organization?.tradeRole && (
              <span className="text-xs text-slate-500">
                نشاط التجارة: {tradeRoleLabel(context.organization.tradeRole)}
              </span>
            )}
          </div>
          <div className="grid gap-2 sm:max-w-md sm:grid-cols-[1fr_auto]">
            <select
              aria-label="نشاط التجارة الخارجية"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
              value={tradeRole}
              onChange={(event) => setTradeRole(event.target.value)}
            >
              <option value="">غير محدد / عام</option>
              <option value="importer">مستورد فقط</option>
              <option value="exporter">مصدّر فقط</option>
              <option value="both">مستورد ومصدّر</option>
            </select>
            <Button
              variant="secondary"
              onClick={() => void saveTradeRole()}
              disabled={!canManageSettings || busy}
            >
              حفظ التصنيف
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            «غير محدد» متاح للحسابات القديمة التي لا تريد الإفصاح عن اتجاه التجارة. لا ننشئ دوراً
            منفصلاً للمستورد أو المصدّر لأن كليهما يستخدم نفس دورة الشحن والعروض.
          </p>
        </div>
      </Card>

      {(myInvitations?.memberships.length || myInvitations?.emailInvitations.length) ? (
        <Card>
          <CardHeader title="دعواتي" subtitle="دعوات بانتظار القبول" />
          <div className="space-y-3 p-5">
            {myInvitations?.memberships.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-navy">{invite.organization.name}</p>
                  <p className="text-xs text-slate-500">دور مقترح: {roleLabel(invite.role)}</p>
                </div>
                <Button onClick={() => void acceptMembership(invite.id)} disabled={busy}>قبول الدعوة</Button>
              </div>
            ))}
            {myInvitations?.emailInvitations.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-navy">{invite.organization.name}</p>
                  <p className="text-xs text-slate-500">دور مقترح: {roleLabel(invite.role)}</p>
                </div>
                <Button onClick={() => void acceptEmailInvitation(invite.id)} disabled={busy}>قبول الدعوة</Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="مساحات العمل" subtitle="التبديل بين المساحات التي لديك فيها عضوية نشطة" />
        <div className="space-y-3 p-5">
          {workspaces.length === 0 ? <EmptyState title="لا توجد مساحات عمل" description="لم يتم العثور على عضويات." /> : null}
          {workspaces.map((workspace) => {
            const current = workspace.organization.id === context?.organization?.id;
            return (
              <div key={workspace.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-navy">{workspace.organization.name}</p>
                  <p className="text-xs text-slate-500">
                    {roleLabel(workspace.role)} · {STATUS_LABEL[workspace.status] ?? workspace.status}
                  </p>
                </div>
                {current ? (
                  <Badge variant="success">الحالية</Badge>
                ) : workspace.status === "active" ? (
                  <Button variant="secondary" onClick={() => void switchWorkspace(workspace)} disabled={busy}>
                    تبديل
                  </Button>
                ) : (
                  <Badge variant="warning">دعوة معلّقة</Badge>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {canReadMembers ? (
        <Card>
          <CardHeader title="أعضاء الشركة" subtitle="الأدوار والصلاحيات داخل مساحة العمل" />
          <div className="space-y-3 p-5">
            {members.length === 0 ? <EmptyState title="لا يوجد أعضاء" description="لم يتم العثور على عضويات." /> : null}
            {members.map((member) => (
              <div key={member.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-navy">{member.user.displayName}</p>
                    <p className="text-xs text-slate-500">{member.user.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[member.status] ?? "neutral"}>
                      {STATUS_LABEL[member.status] ?? member.status}
                    </Badge>
                    {(member.roles?.length ? member.roles : [member.role]).map((role) => (
                      <Badge key={role} variant="neutral">{roleLabel(role)}</Badge>
                    ))}
                  </div>
                </div>
                {canManageMembers && member.status !== "invited" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      value={roleDrafts[member.id] ?? member.role}
                      onChange={(event) =>
                        setRoleDrafts((current) => ({ ...current, [member.id]: event.target.value }))
                      }
                    >
                      {availableRoles.map((role) => (
                        <option key={role} value={role}>{roleLabel(role)}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={() => void updateRole(member)} disabled={busy}>
                      حفظ الدور
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void removeMember(member)} disabled={busy}>
                      إزالة
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {canManageMembers ? (
        <Card>
          <CardHeader title="دعوة عضو" subtitle="الدعوات الجديدة تبدأ بدور محدد ولا تمنح أي صلاحية إدارية" />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
              <Input
                type="email"
                placeholder="member@company.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
              <select
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
              >
                {availableRoles
                  .filter((role) => role !== "COMPANY_OWNER" || context?.context.isOwner)
                  .map((role) => (
                    <option key={role} value={role}>{roleLabel(role)}</option>
                  ))}
              </select>
              <Button onClick={() => void inviteMember()} disabled={busy || !inviteEmail.trim()}>
                إرسال الدعوة
              </Button>
            </div>
            {inviteToken ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">رمز دعوة لمرة واحدة (يظهر مرة واحدة فقط)</p>
                <code className="mt-2 block break-all rounded bg-white/70 px-2 py-1 text-xs">{inviteToken}</code>
                <p className="mt-2 text-xs">
                  سلّمه للشخص ليُنشئ حساباً بنفس البريد. لا يوجد مزود بريد مُهيأ، لذلك لا تُرسل الدعوة تلقائياً.
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {canReadMembers && pending ? (
        <Card>
          <CardHeader title="الدعوات المعلّقة" subtitle="دعوات لم تُقبل بعد" />
          <div className="space-y-3 p-5">
            {pending.memberships.length === 0 && pending.emailInvitations.length === 0 ? (
              <EmptyState title="لا توجد دعوات معلّقة" description="كل الدعوات تم قبولها أو إلغاؤها." />
            ) : null}
            {pending.memberships.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-navy">{invite.user.displayName}</p>
                  <p className="text-xs text-slate-500">{invite.user.email} · {roleLabel(invite.role)}</p>
                </div>
                <Badge variant="warning">بانتظار القبول</Badge>
              </div>
            ))}
            {pending.emailInvitations.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-navy">{invite.email}</p>
                  <p className="text-xs text-slate-500">{roleLabel(invite.role)}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => void revokeInvitation(invite.id)} disabled={busy}>
                  إلغاء
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
