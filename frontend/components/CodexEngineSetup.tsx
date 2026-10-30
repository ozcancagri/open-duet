"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type CodexLoginOperation } from "@/lib/api";
import { EngineSignOut } from "./EngineSignOut";

const BUTTON = "cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-50";

export function CodexEngineSetup({ onChanged, signedIn }: { onChanged: () => void; signedIn: boolean | null }) {
  const [flow, setFlow] = useState<CodexLoginOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; }, [onChanged]);

  const flowId = flow?.id;
  const flowPhase = flow?.phase;
  useEffect(() => {
    if (!flowId || flowPhase !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await api.codexLoginStatus(flowId);
        if (cancelled) return;
        setFlow(status);
        if (status.phase !== "running") { changed.current(); return; }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Codex girişi kontrol edilemedi.");
        return;
      }
      timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [flowId, flowPhase]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Codex girişi güncellenemedi."); }
    finally { setBusy(false); }
  };
  const running = flow?.phase === "running";
  return <div className="space-y-2">
    <button className={BUTTON} disabled={busy || running || signOutPending} onClick={() => void act(async () => setFlow(await api.startCodexLogin()))}>Codex hesabına giriş yap</button>
    {signedIn && <EngineSignOut label="Codex" disabled={busy || running} onSignOut={api.logoutCodexEngine} onChanged={onChanged} onPendingChange={setSignOutPending} />}
    {running && <button className={`${BUTTON} ml-2`} disabled={busy} onClick={() => void act(async () => {
      await api.cancelCodexLogin(flow.id); setFlow(null); changed.current();
    })}>Girişi iptal et</button>}
    {running && !flow.user_code && <p role="status" className="text-xs text-muted">Cihaz kodu hazırlanıyor…</p>}
    {running && flow.authorization_url === "https://auth.openai.com/codex/device" && flow.user_code && <div className="space-y-2 text-sm">
      <p><a href={flow.authorization_url} target="_blank" rel="noreferrer" className="underline">ChatGPT cihaz girişi</a> sayfasını açın ve <code className="select-all font-semibold">{flow.user_code}</code> kodunu girin.</p>
      <p className="text-xs text-muted">İstenirse ChatGPT güvenlik ayarlarınızda cihaz koduyla girişi açın. Bu kod beş dakika içinde geçerliliğini yitirir.</p>
    </div>}
    {flow?.phase === "succeeded" && <p role="status" className="text-xs text-success">Codex hesabı bağlandı.</p>}
    {(error || flow?.error) && <p role="alert" className="text-xs text-danger">{error || flow?.error}</p>}
  </div>;
}
