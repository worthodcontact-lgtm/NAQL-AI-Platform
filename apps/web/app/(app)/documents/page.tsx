"use client";

import { useEffect, useState } from "react";
import { apiFetch, downloadFile } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function contentTypeForFile(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    txt: "text/plain"
  };
  return map[extension] ?? "application/octet-stream";
}

const VISIBILITY_LABEL: Record<string, string> = {
  shipment: "مشتركة مع أطراف الشحنة",
  private: "خاصة بشركتك"
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: "تم الرفع — لم تتم المعالجة",
  metadata_only: "بيانات وصفية فقط — لا يوجد ملف للمعالجة",
  processing: "جارٍ المعالجة",
  processed: "تمت المعالجة",
  processing_unavailable: "المعالجة غير متاحة",
  processing_failed: "فشلت المعالجة"
};

const SCAN_LABEL: Record<string, string> = {
  not_scanned: "لم يُفحص (لا يوجد ماسح مهيأ)",
  pending: "فحص قيد الانتظار",
  clean: "سليم",
  infected: "مصاب — محجوز",
  scan_unavailable: "الماسح غير متاح",
  scan_failed: "فشل الفحص"
};

function scanVariant(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "clean") return "success";
  if (status === "infected" || status === "scan_failed") return "error";
  if (status === "not_scanned" || status === "scan_unavailable" || status === "pending") return "warning";
  return "neutral";
}

const SEVERITY_LABEL: Record<string, string> = {
  INFO: "معلومة",
  WARNING: "تحذير",
  ERROR: "خطأ",
  CRITICAL: "حرج"
};

function severityVariant(severity: string): "info" | "warning" | "error" | "neutral" {
  if (severity === "CRITICAL" || severity === "ERROR") return "error";
  if (severity === "WARNING") return "warning";
  if (severity === "INFO") return "info";
  return "neutral";
}

function fieldStatusLabel(status: string): string {
  if (status === "present") return "قيمة مقروءة";
  if (status === "invalid") return "قيمة غير صالحة";
  if (status === "missing") return "حقل مطلوب مفقود";
  return "تحتاج مراجعة بشرية";
}

export default function DocumentsPage() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [shipmentId, setShipmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState("invoice");
  const [visibility, setVisibility] = useState("shipment");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processingId, setProcessingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [extractions, setExtractions] = useState<Record<string, any>>({});
  const [consistency, setConsistency] = useState<Record<string, any>>({});
  const [consistencyLoading, setConsistencyLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [sRes, dRes] = await Promise.all([
        apiFetch("/api/v1/shipments"),
        apiFetch(`/api/v1/documents${shipmentId ? `?shipmentId=${shipmentId}` : ""}`)
      ]);
      setShipments(sRes.items ?? []);
      setDocuments(dRes.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل المستندات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [shipmentId]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !shipmentId) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const dataBase64 = await toBase64(file);
      await apiFetch(`/api/v1/shipments/${shipmentId}/documents`, {
        method: "POST",
        body: JSON.stringify({
          type,
          filename: file.name,
          contentType: contentTypeForFile(file),
          size: file.size,
          visibility,
          dataBase64
        })
      });
      setFile(null);
      setNotice("تم رفع المستند. شغّل المعالجة لاستخراج الحقول.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر رفع المستند");
    } finally {
      setUploading(false);
    }
  }

  async function loadExtraction(id: string) {
    try {
      const extraction = await apiFetch(`/api/v1/documents/${id}/extraction`);
      setExtractions((current) => ({ ...current, [id]: extraction }));
    } catch {
      // No extraction row yet; the processing result remains the source of truth.
    }
  }

  async function processDocument(id: string) {
    setProcessingId(id);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch(`/api/v1/documents/${id}/process`, { method: "POST" });
      setDocuments((current) =>
        current.map((document) =>
          document.id === id
            ? {
                ...document,
                status:
                  result.status === "completed"
                    ? "processed"
                    : result.status === "unavailable"
                      ? "processing_unavailable"
                      : result.status === "processing"
                        ? "processing"
                        : "processing_failed",
                processingStatus: result.status
              }
            : document
        )
      );
      setExtractions((current) => ({ ...current, [id]: { ...result, findings: current[id]?.findings ?? [] } }));
      if (result.status === "completed") {
        // The process response already contains the persisted fields, so no
        // follow-up extraction request is needed here.
        setNotice("تمت المعالجة. راجع الحقول المستخرجة ثم شغّل فحص الاتساق.");
      } else if (result.status === "processing") {
        setNotice("المستند قيد المعالجة في طلب آخر. أعد المحاولة بعد قليل لعرض النتيجة.");
      } else {
        setNotice(result.errorMessage ?? "لم يتم استخراج نص. هذا المستند لم يُعالج بنجاح.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذرت معالجة المستند");
    } finally {
      setProcessingId("");
    }
  }

  async function runConsistency(id: string) {
    setConsistencyLoading(true);
    setError("");
    try {
      const result = await apiFetch(`/api/v1/shipments/${id}/consistency`, { method: "POST" });
      setConsistency((current) => ({ ...current, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر فحص اتساق المستندات");
    } finally {
      setConsistencyLoading(false);
    }
  }

  const selectedFindings = shipmentId ? consistency[shipmentId]?.findings ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">مركز الوثائق</h1>
        <p className="mt-2 text-sm text-slate-600">
          المستند المشترك يظهر لمالك الشحنة وللأطراف التي منحها المالك صلاحية رؤية المستندات.
          المستند الخاص يبقى داخل شركتك ومالك الشحنة فقط.
        </p>
      </div>

      <Card>
        <CardHeader title="رفع مستند" subtitle="الحد الأقصى 2MB. يتحقق الخادم من الامتداد ونوع MIME وبصمة الملف قبل التخزين، ويسجل حالة فحص البرمجيات الخبيثة بصدق." />
        <form onSubmit={upload} className="grid gap-3 p-5 md:grid-cols-2 lg:grid-cols-5">
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={shipmentId}
            onChange={(event) => setShipmentId(event.target.value)}
            required
          >
            <option value="">اختر شحنة</option>
            {shipments.map((shipment) => (
              <option key={shipment.id} value={shipment.id}>
                {shipment.reference}{shipment.viewerRole === "party" ? " (طرف مشارك)" : ""}
              </option>
            ))}
          </select>
          <Input label="النوع" value={type} onChange={(event) => setType(event.target.value)} />
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
          >
            <option value="shipment">مشترك مع الأطراف المصرح لها</option>
            <option value="private">خاص بشركتي</option>
          </select>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.csv,.json,.xml,.txt"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
          <div className="flex items-end">
            <Button isLoading={uploading} type="submit" disabled={!file || !shipmentId}>رفع</Button>
          </div>
        </form>
        {error ? <p className="px-5 pb-5 text-error">{error}</p> : null}
        {notice ? <p className="px-5 pb-5 text-sm text-slate-600">{notice}</p> : null}
      </Card>

      {shipmentId ? (
        <Card>
          <CardHeader
            title="فحص اتساق المستندات"
            subtitle="قواعد حتمية تقارن المستندات المعالجة ببيانات الشحنة. النتائج تحتاج مراجعة بشرية وليست قراراً جمركياً أو قانونياً."
          />
          <div className="p-5">
            <Button variant="secondary" isLoading={consistencyLoading} onClick={() => void runConsistency(shipmentId)}>
              تشغيل فحص الاتساق
            </Button>
            {selectedFindings.length > 0 ? (
              <div className="mt-4 space-y-3">
                {selectedFindings.map((finding: any) => (
                  <div key={finding.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={severityVariant(finding.severity)}>{SEVERITY_LABEL[finding.severity] ?? finding.severity}</Badge>
                      <span className="text-sm font-semibold text-navy">{finding.code}</span>
                      {finding.field ? <span className="text-xs text-slate-500">الحقل: {finding.field}</span> : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{finding.message}</p>
                    {finding.suggestedAction ? <p className="mt-1 text-xs text-slate-500">الإجراء المقترح: {finding.suggestedAction}</p> : null}
                  </div>
                ))}
              </div>
            ) : consistency[shipmentId] ? (
              <p className="mt-4 text-sm text-slate-600">لا توجد ملاحظات اتساق محفوظة لهذه الشحنة.</p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {loading ? <Skeleton className="h-40" /> : null}
      {!loading && documents.length === 0 ? (
        <EmptyState title="لا توجد وثائق" description="ارفع مستنداً مرتبطاً بشحنة." />
      ) : null}
      <div className="space-y-3">
        {documents.map((document) => {
          const extraction = extractions[document.id];
          return (
            <Card key={document.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <h3 className="font-semibold text-navy">
                    {document.filename} <span className="text-xs text-slate-500">({document.type})</span>
                  </h3>
                  <p className="text-sm text-slate-500">
                    الحالة: {STATUS_LABEL[document.status] ?? document.status} · {document.uploadedAt}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant={document.visibility === "private" ? "warning" : "info"}>
                      {VISIBILITY_LABEL[document.visibility] ?? document.visibility}
                    </Badge>
                    {document.processingStatus ? <Badge variant="neutral">المعالجة: {document.processingStatus}</Badge> : null}
                    <Badge variant={scanVariant(document.malwareScanStatus)}>
                      {SCAN_LABEL[document.malwareScanStatus] ?? document.malwareScanStatus ?? "لم يُفحص"}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {document.hasContent ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void downloadFile(`/api/v1/documents/${document.id}/content`, document.filename).catch((err) =>
                          setError(err instanceof Error ? err.message : "تعذر تنزيل المستند.")
                        )
                      }
                    >
                      تنزيل
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    isLoading={processingId === document.id}
                    disabled={!document.hasContent || document.malwareScanStatus === "infected"}
                    onClick={() => void processDocument(document.id)}
                  >
                    معالجة المستند
                  </Button>
                  <Button variant="ghost" onClick={() => void loadExtraction(document.id)}>
                    عرض الحقول
                  </Button>
                </div>
              </div>

              {extraction ? (
                <div className="border-t border-slate-100 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={extraction.status === "completed" ? "success" : extraction.status === "processing" ? "info" : "warning"}>
                      {extraction.status === "completed"
                        ? "تم الاستخراج"
                        : extraction.status === "processing"
                          ? "قيد المعالجة"
                          : "استخراج غير متاح"}
                    </Badge>
                    {extraction.documentType ? <Badge variant="neutral">{extraction.documentType}</Badge> : null}
                    {extraction.extractionMethod ? <span className="text-xs text-slate-500">الطريقة: {extraction.extractionMethod}</span> : null}
                    {extraction.ocrStatus ? <span className="text-xs text-slate-500">OCR: {extraction.ocrStatus}</span> : null}
                    <span className="text-xs text-amber-700">فحص البرمجيات الخبيثة: {extraction.malwareScanStatus ?? "not_scanned"}</span>
                  </div>
                  {extraction.errorMessage ? <p className="mt-2 text-sm text-error">{extraction.errorMessage}</p> : null}
                  {Array.isArray(extraction.warnings) && extraction.warnings.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pe-5 text-xs text-slate-600">
                      {extraction.warnings.slice(0, 8).map((warning: string, index: number) => <li key={index}>{warning}</li>)}
                    </ul>
                  ) : null}
                  {Array.isArray(extraction.fields) && extraction.fields.length > 0 ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-start text-xs text-slate-500">
                            <th className="py-2 text-start">الحقل</th>
                            <th className="py-2 text-start">القيمة</th>
                            <th className="py-2 text-start">الطريقة / المصدر</th>
                            <th className="py-2 text-start">الحالة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {extraction.fields.map((field: any) => (
                            <tr key={field.key} className="border-b border-slate-100">
                              <td className="py-2 font-medium text-navy">{field.label ?? field.key}</td>
                              <td className="py-2 text-slate-700 ltr-text">{field.normalizedValue ?? field.value ?? "—"}</td>
                              <td className="py-2 text-xs text-slate-500">{field.method}{field.sourceLocation ? ` · ${field.sourceLocation}` : ""}</td>
                              <td className="py-2 text-xs text-slate-600">{fieldStatusLabel(field.validationStatus)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
