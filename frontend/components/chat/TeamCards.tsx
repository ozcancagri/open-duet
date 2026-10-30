"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { collaboration } from "@/lib/collaboration";
import type { TeamJobItem, TranscriptItem } from "@/lib/transcript";
import { JobCard } from "./TeamPanel";
import { useSession } from "@/components/AuthGate";

export function DelegationCard({ item }: { item: TeamJobItem }) {
  return <JobCard compact job={{ id: item.jobId, root_id: null, parent_id: null, depth: 0, requester_agent_id: 0, assignee_agent_id: item.agentId, assignee_thread_id: item.threadId, mode: item.mode, brief: item.brief, status: item.status, result: item.result, outcome: item.outcome }} />;
}
export function AgentCreatedCard({ item }: { item: Extract<TranscriptItem, { kind: "agent_created" }> }) {
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const { session } = useSession();
  useEffect(() => {
    let live = true;
    collaboration.undoState(item.agentId).then(r => { if (live) setAvailable(r.available); }, () => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [item.agentId]);
  const undo = async () => {
    setState("busy"); setError(null);
    try { const result = await collaboration.undoCreate(item.agentId); setState(result.removed); }
    catch (err) { setState(""); setError(err instanceof ApiError ? err.message : "Bu uzman geri alınamadı."); }
  };
  return <article className="space-y-2 rounded-field border border-line p-3 text-sm"><p><strong>Uzman oluşturuldu: {item.name || `Ajan ${item.agentId}`}</strong>{item.title ? ` · ${item.title}` : ""}</p><p className="text-xs text-muted">Talimatları lider yazdı. Ajanlar bölümünde gözden geçirin.</p>{session?.scopes.includes("admin") && available && !state && <button type="button" className="text-xs underline" onClick={() => void undo()}>Oluşturmayı geri al</button>}{state && <p role="status" className="text-xs text-muted">{state === "busy" ? "Geri alınıyor…" : state === "deleted" ? "Uzman silindi." : `Uzman: ${state}.`}</p>}{error && <p role="alert" className="text-xs text-danger">{error}</p>}</article>;
}

const STALE: Record<string, string> = {
  changed_since: "Bu uygulandıktan sonra bir şey değişti, bu yüzden dokunulmadı.",
  agent_used: "Bunun eklediği bir uzman zaten kullanıldı, bu yüzden korundu.",
  agent_busy: "Bir takım üyesi şu anda çalışıyor. Boşta olduğunda yeniden deneyin.",
};
const VERB: Record<string, string> = { created: "Eklendi", updated: "Güncellendi", deleted: "Silindi" };

export function TeamSetupCard({ item }: { item: Extract<TranscriptItem, { kind: "team_setup" }> }) {
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { session } = useSession();
  const [availability, setAvailability] = useState<{ available: boolean; reason: string | null } | null>(null);
  useEffect(() => {
    if (!session?.scopes.includes("admin")) return;
    let live = true;
    const refresh = () => collaboration.setupReceipt(item.requestId).then(result => {
      if (live) setAvailability({ available: result.undo_available, reason: result.undo_reason });
    }, () => { if (live) setAvailability({ available: false, reason: "Geri alınıp alınamayacağı kontrol edilemedi." }); });
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [item.requestId, session]);
  const undo = async () => {
    setState("busy"); setError(null);
    try { await collaboration.undoSetup(item.requestId); setState("undone"); }
    catch (err) { setState(""); setError(err instanceof ApiError ? STALE[err.code ?? ""] ?? err.message : "Bu değişiklik geri alınamadı."); }
  };
  const canUndo = availability?.available === true && !state && session?.scopes.includes("admin");
  return (
    <article className="space-y-2 rounded-field border border-line p-3 text-sm">
      <p><strong>Takım değişiklikleri uygulandı</strong></p>
      <ul className="space-y-2 text-xs text-muted">{item.rows.map((row) => <li key={`${row.action}-${row.agentId}`}>
        {VERB[row.action] ?? row.action}: {row.name || `Ajan ${row.agentId}`}
        {row.changes && <details className="mt-1"><summary className="cursor-pointer underline">Ayrıntılar</summary><dl className="mt-2 space-y-2">{row.changes.map(change => <div key={change.field}><dt className="font-medium">{change.field.replaceAll("_", " ")}</dt><dd className="whitespace-pre-wrap break-words"><del>{change.before == null ? "Varsayılan / boş" : String(change.before)}</del>{" → "}{change.after == null ? "Varsayılan / boş" : String(change.after)}</dd></div>)}</dl><p className="mt-2">Yeni sohbetler kayıtlı model varsayılanlarını kullanır. Uygulama bağlantıları, beceriler, bilgisayarlar ve rutinler ayrıca kurulum gerektirir.</p></details>}
        {row.action !== "deleted" && <div className="mt-1 flex gap-3"><button type="button" className="underline" onClick={() => window.dispatchEvent(new CustomEvent("open-dots:open-agent", { detail: { id: row.agentId, edit: false } }))}>Sohbet başlat</button>{session?.scopes.includes("admin") && <button type="button" className="underline" onClick={() => window.dispatchEvent(new CustomEvent("open-dots:open-agent", { detail: { id: row.agentId, edit: true } }))}>Ajanı düzenle</button>}</div>}
      </li>)}</ul>
      {item.undoAvailable && <p className="text-xs text-muted">Oluşturulan bir ajan kullanılana ya da değiştirilen bir ajan yeniden düzenlenene kadar geri alınabilir. Ajanın ilk sohbetini başlatmak geri almayı kapatabilir.</p>}
      {availability && !availability.available && !state && <p className="text-xs text-muted">{availability.reason}</p>}
      {canUndo && <button type="button" className="text-xs underline" onClick={() => void undo()}>Geri al</button>}
      {state && <p role="status" className="text-xs text-muted">{state === "busy" ? "Geri alınıyor…" : "Geri alındı."}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </article>
  );
}

const NOTICE_LABEL = { incident: "Olay", escalation: "Üst düzeye iletildi", refused: "Rapor iletilmedi", retried: "Yeniden deneme" } as const;

// What the lead was told about a teammate (or what it retried). The text is
// quoted data from other agents; it is only ever shown, never acted on here.
export function TeamNoticeCard({ item }: { item: Extract<TranscriptItem, { kind: "team_notice" }> }) {
  return (
    <article className="flex items-start justify-between gap-3 rounded-field border border-line p-3 text-sm">
      <p className="min-w-0 break-words"><strong>{NOTICE_LABEL[item.tone]}</strong>{" · "}{item.text.replace(/^(Incident|Escalation): /, "")}</p>
      {item.threadId !== null && <Link href={`/chat?thread=${item.threadId}`} className="shrink-0 text-xs underline">Aç</Link>}
    </article>
  );
}
