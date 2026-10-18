"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Message = { role: "user" | "assistant"; content: string; providerAvailable?: boolean };

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    const q = question;
    setQuestion("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true); setError("");
    try {
      const res = await apiFetch("/api/v1/ai/copilot", { method: "POST", body: JSON.stringify({ question: q }) });
      setMessages((m) => [...m, { role: "assistant", content: res.answer, providerAvailable: res.providerAvailable }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">المساعد الذكي</h1>
        <p className="text-sm text-slate-500">استفسارات تشغيلية. نصائح AI ليست بيانات تشغيلية موثقة.</p>
      </div>

      <Card>
        <div className="max-h-[480px] space-y-3 overflow-y-auto p-5">
          {messages.length === 0 && <p className="text-sm text-slate-500">ابدأ بسؤال مثل: “لخّص حالة شحناتي”.</p>}
          {messages.map((m, i) => (
            <div key={i} className={`rounded-lg p-3 text-sm ${m.role === "user" ? "ml-auto max-w-[80%] bg-primary/10 text-primary" : "max-w-[80%] bg-canvas text-slate-700"}`}>
              {m.content}
              {m.role === "assistant" && m.providerAvailable === false && (
                <p className="mt-2 text-xs font-semibold text-warning">مزود AI غير متاح: هذا fallback، وليس إجابة مزود.</p>
              )}
            </div>
          ))}
          {loading && <p className="text-sm text-slate-500">جارٍ المعالجة...</p>}
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
