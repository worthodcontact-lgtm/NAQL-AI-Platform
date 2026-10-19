"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";

/**
 * Makes development fallback storage impossible to mistake for real persistence.
 * Renders nothing when the API reports a real database.
 */
export default function PersistenceBanner() {
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/health`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setMode(json?.persistenceMode ?? null);
      })
      .catch(() => {
        if (!cancelled) setMode("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode !== "memory") return null;

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs text-warning">
      <b>وضع التطوير:</b> لا توجد قاعدة بيانات مُهيّأة. كل البيانات في الذاكرة وتُفقد عند إعادة تشغيل الـ API.
      شغّل <span className="ltr-text font-mono">pnpm --filter @naql/api db:dev</span> ثم اضبط{" "}
      <span className="ltr-text font-mono">DATABASE_URL</span>.
    </div>
  );
}
