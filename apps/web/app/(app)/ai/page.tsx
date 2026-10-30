"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";

type Source = { type: string; id: string; label: string; code?: string; severity?: string; documentId?: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  status?: string;
  providerAvailable?: boolean;
  sources?: Source[];
  suggestedActions?: string[];
  warnings?: string[];
};

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shipments, setShipments] = useState<any[]>([]);
  const [shipmentId, setShipmentId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [aiStatus, setAiStatus] = useState<any>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [shipmentResult, statusResult] = await Promise.all([
          apiFetch("/api/v1/shipments"),
          apiFetch("/api/v1/ai/status")
        ]);
        setShipments(shipmentResult.items ?? []);
        setAiStatus(statusResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر تحميل حالة المساعد");
      }
    })();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    const q = question;
    setQuestion("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/v1/ai/copilot", {
        method: "POST",
        body: JSON.stringify({
          message: q,
          ...(shipmentId ? { shipmentId } : {}),
          ...(conversationId ? { conversationId } : {})
        })
      });
      if (res.conversationId) setConversationId(res.conversationId);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer,
          status: res.status,
          providerAvailable: res.providerAvailable,
          sources: res.sources ?? [],
          suggestedActions: res.suggestedActions ?? [],
          warnings: res.warnings ?? []
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الحصول على إجابة");
    } finally {
      setLoading(false);
    }
  }

  function resetConversation() {
    setMessages([]);
    setConversationId("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">المساعد الذكي</h1>
          <p className="text-sm text-slate-500">
            إجابات من السجلات المصرح بها فقط. الاسترجاع الحالي حتمي بالكلمات المفتاحية وليس بحثاً دلالياً.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={resetConversation}>محادثة جديدة</Button>
      </div>

      <Card>
        <CardHeader
          title={shipmentId ? "محادثة مرتبطة بشحنة" : "محادثة عامة"}
          subtitle="لا يتم إرسال هوية شركة من المتصفح. الخادم يحدد السياق من عضويتك وصلاحيات الشحنة."
        />
        <div className="space-y-3 p-5">
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm md:max-w-md"
            value={shipmentId}
            onChange={(event) => {
              setShipmentId(event.target.value);
              setMessages([]);
              setConversationId("");
            }}
          >
            <option value="">بدون شحنة محددة (بحث في شحناتي)</option>
            {shipments.map((shipment) => (
              <option key={shipment.id} value={shipment.id}>{shipment.reference}</option>
            ))}
          </select>
          {aiStatus ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Badge variant={aiStatus.providerAvailable ? "success" : "warning"}>
                {aiStatus.providerAvailable ? `مزود AI: ${aiStatus.provider}` : "مزود AI غير مهيأ"}
              </Badge>
              <span>الاسترجاع: {aiStatus.retrievalMethod}</span>
              <span>OCR: {aiStatus.ocrEnabled ? "مفعّل" : "غير مفعّل"}</span>
            </div>
          ) : null}
        </div>

        <div className="max-h-[520px] space-y-3 overflow-y-auto border-t border-slate-100 p-5">
          {messages.length === 0 && (
            <p className="text-sm text-slate-500">
              ابدأ بسؤال مثل: «لخّص مستندات هذه الشحنة» أو «ما ملاحظات الاتساق؟». إذا لم تتوفر بيانات مصرح بها سيقول المساعد ذلك.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg p-3 text-sm ${m.role === "user" ? "ml-auto max-w-[85%] bg-primary/10 text-primary" : "max-w-[90%] bg-canvas text-slate-700"}`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" ? (
                <div className="mt-3 space-y-2">
                  {m.status === "degraded" ? (
                    <Badge variant="warning">ملخص حتمي — لا يوجد توليد من مزود AI</Badge>
                  ) : null}
                  {m.sources && m.sources.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold text-slate-600">المصادر:</p>
                      <ul className="mt-1 space-y-1 text-xs text-slate-500">
                        {m.sources.map((source) => (
                          <li key={`${source.type}-${source.id}`}>
                            {source.type === "shipment" ? "شحنة" : source.type === "document" ? "مستند" : source.type === "finding" ? "ملاحظة" : source.type} — {source.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">لا توجد مصادر مصرح بها في هذه الإجابة.</p>
                  )}
                  {m.suggestedActions && m.suggestedActions.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold text-slate-600">خطوات مقترحة:</p>
                      <ul className="mt-1 list-disc space-y-1 pe-5 text-xs text-slate-500">
                        {m.suggestedActions.map((action) => <li key={action}>{action}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {m.warnings && m.warnings.length > 0 ? (
                    <ul className="space-y-1 text-xs text-amber-700">
                      {m.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {loading && <p className="text-sm text-slate-500">جارٍ تجميع السياق المصرح به...</p>}
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-4">
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="اسأل NAQL AI..." />
          <Button isLoading={loading} type="submit">إرسال</Button>
        </form>
        {error && <p className="px-4 pb-4 text-error">{error}</p>}
      </Card>
    </div>
  );
}
