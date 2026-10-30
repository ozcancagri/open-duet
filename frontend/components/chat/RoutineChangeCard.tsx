"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/components/AuthGate";
import { ApiError } from "@/lib/api";
import { collaboration } from "@/lib/collaboration";
import type { TranscriptItem } from "@/lib/transcript";

const LABEL: Record<string, string> = { create: "kaydedildi", update: "güncellendi", pause: "duraklatıldı", resume: "sürdürüldü", delete: "silindi" };

export function RoutineChangeCard({ item }: { item: Extract<TranscriptItem, { kind: "routine_change" }> }) {
  const { session } = useSession();
  const admin = session?.scopes.includes("admin");
  const [receipt, setReceipt] = useState<{ state: string; undo_available: boolean; undo_reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!admin) return;
    let live = true;
    const refresh = () => collaboration.setupReceipt(item.requestId).then(result => {
      if (live) setReceipt(result);
    }, () => { if (live) setReceipt({ state: "unavailable", undo_available: false, undo_reason: "Geri alınıp alınamayacağı kontrol edilemedi." }); });
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [admin, item.requestId]);
  const undo = async () => {
    setBusy(true); setError(null);
    try {
      await collaboration.undoSetup(item.requestId);
      setReceipt({ state: "undone", undo_available: false, undo_reason: null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bu rutin değişikliği geri alınamadı.");
      setReceipt(null);
    } finally { setBusy(false); }
  };
  return <article className="space-y-2 rounded-field border border-line p-3 text-sm">
    <p><strong>Rutin {LABEL[item.action] ?? "değiştirildi"}: {item.name || `Rutin ${item.routineId}`}</strong></p>
    {item.action !== "delete" && <p className="text-xs text-muted">{item.paused ? "Duraklatılmış olarak kaydedildi. Hazır olduğunuzda ayrıca sürdürün." : "Zamanlama etkin. Bu kayıt, bir çalıştırmanın tamamlandığı anlamına gelmez."}</p>}
    <p className="text-xs text-muted">{item.note}</p>
    {item.action !== "delete" && <Link className="text-xs underline" href={`/chat?view=routines&routine=${item.routineId}`}>Rutinleri gözden geçir</Link>}
    {admin && receipt?.undo_available && <button type="button" disabled={busy} className="ml-3 text-xs underline" onClick={() => void undo()}>{busy ? "Geri alınıyor…" : "Geri al"}</button>}
    {receipt?.state === "undone" ? <p role="status" className="text-xs text-muted">Geri alındı. Geri yüklenen rutinler duraklatılmış kalır.</p> : receipt?.undo_reason && <p className="text-xs text-muted">{receipt.undo_reason}</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </article>;
}
