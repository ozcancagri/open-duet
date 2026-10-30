"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type DecisionEntry, type DecisionEvent } from "@/lib/api";
import { DECISION_EVENTS, csvFileName, decisionEventLabel, decisionText } from "@/lib/approvals";
import { BUTTON, FIELD_BOX } from "./styles";

const PAGE = 50;

const MODE_LABELS: Record<string, string> = {
  ask: "önce sor",
  accept_edits: "düzenlemeleri kabul et",
  plan: "yalnız plan",
};

// The decision log, newest first: what Claude asked to do and how each request
// was settled. Read-only; filter by event and conversation, page back, export.
export function DecisionLog({ threadId = null }: { threadId?: number | null }) {
  const [event, setEvent] = useState<DecisionEvent | "">("");
  const [thread, setThread] = useState(threadId != null ? String(threadId) : "");
  const [items, setItems] = useState<DecisionEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const threadFilter = /^\d+$/.test(thread.trim()) ? Number(thread.trim()) : null;
  const filter = { event: event || null, thread_id: threadFilter };

  useEffect(() => {
    let cancelled = false;
    api
      .listDecisions({ limit: PAGE, event: event || null, thread_id: threadFilter })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNext(page.next_before);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Karar kaydı yüklenemedi.");
      });
    return () => {
      cancelled = true;
    };
  }, [event, threadFilter, tick]);

  const older = async () => {
    if (!next) return;
    setBusy(true);
    try {
      const page = await api.listDecisions({ ...filter, limit: PAGE, before: next });
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext(page.next_before);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Daha eski kayıtlar yüklenemedi.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    setError(null);
    try {
      const text = await api.exportDecisionsCsv(filter);
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileName(threadFilter);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kayıt dışa aktarılamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Olay"
          value={event}
          onChange={(e) => setEvent(e.target.value as DecisionEvent | "")}
          className={`${FIELD_BOX} w-auto`}
        >
          <option value="">Tüm olaylar</option>
          {DECISION_EVENTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Sohbet numarası"
          inputMode="numeric"
          placeholder="Sohbet no"
          value={thread}
          onChange={(e) => setThread(e.target.value)}
          className={`${FIELD_BOX} w-36`}
        />
        <button className={BUTTON} onClick={() => setTick((n) => n + 1)} disabled={busy}>
          Yenile
        </button>
        <button className={BUTTON} onClick={exportCsv} disabled={busy}>
          CSV olarak dışa aktar
        </button>
      </div>
      <p className="text-xs text-muted">
        Özetler tek satırdır ve gizli bilgiye benzeyen her şey çıkarılır; bir çağrının tam girdisi asla kaydedilmez.
        Dışa aktarılan dosya yeniden temizlenir ve bir hesap tablosunda güvenle açılabilir.
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {items === null && !error && <p className="text-xs text-muted">Yükleniyor…</p>}
      {items !== null && items.length === 0 && (
        <p className="rounded-md bg-inset px-3 py-3 text-xs text-muted">Henüz kayıt yok.</p>
      )}
      {items !== null && items.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {items.map((entry) => (
            <li key={entry.id} className="px-3 py-2">
              <p className="break-words text-xs">{decisionText(entry)}</p>
              <p className="mt-0.5 text-xs text-muted">
                <span className="rounded bg-inset px-1.5 py-0.5">{decisionEventLabel(entry.event)}</span>{" "}
                {new Date(entry.at).toLocaleString("tr-TR")}
                {entry.thread_id != null && <> · sohbet {entry.thread_id}</>}
                {entry.mode && <> · {MODE_LABELS[entry.mode] ?? entry.mode.replace("_", " ")}</>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button className={BUTTON} onClick={older} disabled={busy}>
          {busy ? "Yükleniyor…" : "Daha eskileri yükle"}
        </button>
      )}
    </div>
  );
}
