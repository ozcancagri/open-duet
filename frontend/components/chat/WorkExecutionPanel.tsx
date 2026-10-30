"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ApiError, type Agent } from "@/lib/api";
import { localDateTime } from "@/lib/planner";
import { planner, type WorkItem, type WorkRun, type WorkRunInput, type WorkEvent } from "@/lib/planner-api";
import { browserTimezone } from "@/lib/routines";

const control = "w-full rounded-field border border-line bg-surface px-3 py-2 text-sm";
const activeStates = ["scheduled", "queued", "claimed", "running", "needs_input"];
const message = (error: unknown) => error instanceof Error ? error.message : "Görev yürütmesi yüklenemedi.";
const STATE_LABEL: Record<string, string> = {
  scheduled: "zamanlandı", queued: "sırada", claimed: "alındı", running: "çalışıyor", needs_input: "Onay bekleniyor",
  completed: "tamamlandı", failed: "başarısız", cancelled: "iptal edildi", interrupted: "kesildi", missed: "kaçırıldı", skipped: "atlandı",
};
const MODE_LABEL: Record<string, string> = { ask: "önce sor", accept_edits: "düzenlemeleri kabul et", plan: "yalnız plan" };

export function WorkExecutionPanel({ item, agents, onClose, onOpenThread, onReview }: {
  item: WorkItem; agents: Agent[]; onClose: () => void; onOpenThread: () => void; onReview: () => Promise<void>;
}) {
  const id = useId();
  const [runs, setRuns] = useState<WorkRun[] | null>(null);
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [agentId, setAgentId] = useState(item.agent_id ?? agents[0]?.id ?? 0);
  const [prompt, setPrompt] = useState(`${item.title}\n\n${item.description}`.trim());
  const [mode, setMode] = useState<WorkRunInput["approval_mode"]>("ask");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<WorkRunInput | null>(null);
  const [retrying, setRetrying] = useState(false);
  const timezone = browserTimezone();
  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const [result, history] = await Promise.all([planner.runs(item.id), planner.events(item.id)]); if (live) { setRuns(result); setEvents(history); } }
      catch (err) { if (live) setError(message(err)); }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => { live = false; clearInterval(timer); };
  }, [item.id]);
  const active = runs?.some(run => activeStates.includes(run.state));
  const refresh = async () => setRuns(await planner.runs(item.id));

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    let scheduled: string | null = null;
    if (!pending && when) {
      const date = new Date(when);
      if (!Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== when || date.getTime() <= Date.now()) {
        setError("Bu tarihte var olan, ileri bir yerel saat seçin."); return;
      }
      scheduled = date.toISOString();
    }
    const data = pending ?? { revision: item.revision, idempotency_key: crypto.randomUUID(), agent_id: agentId,
      prompt, approval_mode: mode, scheduled_for: scheduled };
    setPending(data); setBusy(true);
    try {
      const saved = await planner.start(item.id, data);
      setRuns(current => [saved, ...(current ?? []).filter(run => run.id !== saved.id)]);
      setPending(null); setRetrying(false);
      await refresh().catch(err => setError(message(err)));
    } catch (err) {
      // A lost response may have committed. Keep its exact request/key so
      // retrying the request never launches another attempt.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) setPending(null);
      setError(message(err));
    } finally { setBusy(false); }
  }
  async function cancel(run: WorkRun) {
    setBusy(true); setError(null);
    try { await planner.cancelRun(item.id, run.id); await refresh(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <Dialog open title={`Ajan işi · ${item.title}`} description="Açık bir deneme başlatın ya da zamanlayın ve geçmişini gözden geçirin." size="wide"
    onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <div className="space-y-5">
      <p className="text-sm text-muted">Atama, son tarihler ve iş akışı sütunları işi başlatmaz. Her deneme yeni bir sohbet kullanır. Başarılı iş, siz gözden geçirene kadar bulunduğu sütunda kalır.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {runs === null ? <p role="status">Denemeler yükleniyor…</p> : <>
        {(!active || pending) && !item.archived && <form onSubmit={event => void start(event)} className="space-y-3 rounded-field border border-line p-3">
          <h3 className="font-medium">{retrying ? "Yeni denemeyi gözden geçir" : "Ajanla başlat"}</h3>
          {retrying && <p className="text-sm text-warning">Önceki iş kısmen yapılmış olabilir. Yeniden denemeden önce sohbetini kontrol edin ve istemi düzenleyin.</p>}
          <fieldset disabled={busy || !!pending} className="space-y-3">
            <label htmlFor={`${id}-agent`} className="block text-sm">Ajan
              <select id={`${id}-agent`} required className={control} value={agentId} onChange={event => setAgentId(Number(event.target.value))}>
                <option value={0} disabled>Bir ajan seçin</option>
                {agents.filter(agent => !agent.archived_at).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select></label>
            <label htmlFor={`${id}-prompt`} className="block text-sm">Görevin tam istemi
              <textarea id={`${id}-prompt`} required maxLength={20000} rows={5} className={control} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
            <label htmlFor={`${id}-mode`} className="block text-sm">Onay modu
              <select id={`${id}-mode`} className={control} value={mode} onChange={event => setMode(event.target.value as WorkRunInput["approval_mode"])}>
                <option value="ask">Önce sor</option><option value="accept_edits">Düzenlemeleri kabul et</option><option value="plan">Yalnız plan</option>
              </select></label>
            <p className="text-xs text-muted">Bu mod ile ajanın kayıtlı modundan daha sıkı olanı geçerlidir. Onayları yürütme sohbetinde gözden geçirin.</p>
            <label htmlFor={`${id}-when`} className="block text-sm">Bir kez çalıştırma zamanı · {timezone} (hemen başlatmak için boş bırakın)
              <input id={`${id}-when`} type="datetime-local" className={control} value={when} onChange={event => setWhen(event.target.value)} /></label>
          </fieldset>
          <p className="text-sm">{when ? `Bu, ${timezone} saat diliminde zamanlanmış bir denemeyi onaylar.` : "Bu, ajan işini hemen başlatır ya da ajan meşgulse sıraya alır."}</p>
          {pending && !busy && <p className="text-sm text-warning">Önceki istek sunucuya ulaşmış olabilir. Kaydını kurtarmak için aynı isteği yeniden deneyin.</p>}
          <Button type="submit" variant="primary" loading={busy} disabled={!agentId || !prompt.trim()}>{pending ? "Aynı isteği yeniden dene" : when ? "Zamanlanmış çalıştırmayı onayla" : "Onayla ve hemen başlat"}</Button>
        </form>}
        {item.archived && <p className="text-sm text-muted">Yeni bir deneme başlatmak için bu görevi geri yükleyin.</p>}
        <div className="space-y-3" aria-live="polite">
          <h3 className="font-medium">Denemeler</h3>
          {runs.length === 0 && <p className="text-sm text-muted">Henüz ajan işi istenmedi.</p>}
          {runs.map(run => <article key={run.id} className="space-y-2 rounded-field border border-line p-3 text-sm">
            <p className="font-medium">Deneme {run.attempt} · {STATE_LABEL[run.state] ?? run.state}</p>
            <p className="text-xs text-muted">{agents.find(agent => agent.id === run.agent_id)?.name ?? `Ajan #${run.agent_id}`} · {MODE_LABEL[run.approval_mode] ?? run.approval_mode} · {new Date(run.scheduled_for ?? run.created_at).toLocaleString("tr-TR")}</p>
            {run.state === "queued" && <p className="text-muted">Yürütücünün ya da ajanın uygun olması bekleniyor.</p>}
            {run.state === "interrupted" && <p className="text-warning">İş kesildi ve kendiliğinden yeniden oynatılmayacak. Yeni bir deneme başlatmadan önce sohbetini inceleyin.</p>}
            {run.result && <p className="whitespace-pre-wrap break-words">{run.result}</p>}
            {run.error && <p className="whitespace-pre-wrap text-danger">{run.error}</p>}
            <details><summary className="cursor-pointer text-muted">Onaylanan istem</summary><pre className="whitespace-pre-wrap break-words py-2 font-sans">{run.prompt}</pre></details>
            <div className="flex flex-wrap items-center gap-3">
              {run.thread_id && <Link className="text-accent underline" href={`/chat?thread=${run.thread_id}`} onClick={onOpenThread}>Yürütme sohbetini aç</Link>}
              {activeStates.includes(run.state) && <Button size="sm" disabled={busy} onClick={() => void cancel(run)}>{run.state === "scheduled" || run.state === "queued" ? "İptal" : "Durdur"}</Button>}
              {!active && !item.archived && ["failed", "cancelled", "interrupted", "missed", "skipped"].includes(run.state) && <Button size="sm" disabled={busy || !!pending} onClick={() => { setAgentId(run.agent_id); setPrompt(run.prompt); setMode(run.approval_mode); setWhen(""); setRetrying(true); }}>Yeniden denemeyi hazırla</Button>}
              {run.state === "completed" && <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onReview(); } catch (err) { setError(message(err)); } finally { setBusy(false); } }}>İncelemeye taşı</Button>}
            </div>
          </article>)}
        </div>
        <details><summary className="cursor-pointer text-sm text-muted">Görev etkinliği (son 500 olay)</summary>
          <ol className="mt-2 space-y-1 text-xs text-muted">{events.map(event => <li key={event.id}>
            {new Date(event.created_at).toLocaleString("tr-TR")} · {event.actor} · {event.kind.replaceAll("_", " ")}{event.detail ? ` · ${event.detail}` : ""}
          </li>)}</ol>
        </details>
      </>}
      <div className="flex justify-end"><Button disabled={busy} onClick={onClose}>Kapat</Button></div>
    </div>
  </Dialog>;
}
