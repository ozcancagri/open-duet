"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ClaudeLoginOperation } from "@/lib/api";
import { EngineSignOut } from "./EngineSignOut";
import { trustedLink } from "@/lib/claude-login-link";

const BUTTON = "cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-50";
// `engine` is Claude or an extra Claude account (claude_<name>), each signed in on its own.
export function ClaudeEngineSetup({ engine = "claude", label = "Claude", onChanged, signedIn }: { engine?: string; label?: string; onChanged: () => void; signedIn: boolean | null }) {
  const [flow, setFlow] = useState<ClaudeLoginOperation | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; }, [onChanged]);
  const flowId = flow?.id;
  const phase = flow?.phase;
  useEffect(() => {
    if (!flowId || phase !== "running") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.claudeLoginStatus(flowId, engine);
        if (stopped) return;
        setFlow(next);
        if (next.phase !== "running") { setCode(""); changed.current(); return; }
        timer = setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (!stopped) setError(err instanceof ApiError ? err.message : "Claude girişi kontrol edilemedi.");
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [flowId, phase, engine]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Claude girişi güncellenemedi."); }
    finally { setBusy(false); }
  };
  const running = flow?.phase === "running";
  const link = trustedLink(flow?.authorization_url);
  return <div className="space-y-2">
    <button className={BUTTON} disabled={busy || running || signOutPending} onClick={() => void act(async () => {
      setCode(""); setCopied(false); setFlow(await api.startClaudeEngineLogin(engine));
    })}>{label} hesabına giriş yap</button>
    {signedIn && <EngineSignOut label={label} disabled={busy || running} onSignOut={() => api.logoutClaudeEngine(engine)} onChanged={onChanged} onPendingChange={setSignOutPending} />}
    {running && <button className={`${BUTTON} ml-2`} disabled={busy} onClick={() => void act(async () => {
      await api.cancelClaudeLogin(flow.id, engine); setCode(""); setFlow(null); changed.current();
    })}>{label} girişini iptal et</button>}
    {running && !link && <p role="status" className="text-xs text-muted">Claude girişi hazırlanıyor…</p>}
    {running && link && <div className="space-y-2 text-sm">
      <p><a href={link} target="_blank" rel="noreferrer" className="underline" onClick={(event) => {
        // The desktop window cannot open windows: its shell opens the page in the system browser.
        const open = window.openDots?.openClaudeSignIn;
        if (!open) return;
        event.preventDefault();
        open(link).catch(() => setError("Tarayıcı açılamadı. Bağlantıyı kopyalayıp kendiniz açın."));
      }}>Claude giriş sayfasını</a> açın, giriş yaptıktan sonra gösterilen kodu yapıştırın.{" "}
        <button type="button" className="underline" onClick={() => {
          navigator.clipboard.writeText(link).then(() => setCopied(true), () => setError("Bağlantı kopyalanamadı."));
        }}>{copied ? "Bağlantı kopyalandı" : "Bağlantıyı kopyala"}</button>
        <span className="block text-xs text-muted">Tarayıcınızda giriş yapılmış hesaptan farklı bir hesap kullanmak için kopyalanan bağlantıyı gizli bir pencerede açın.</span></p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (busy || flow.code_sent) return;
        const pasted = code.trim();
        setCode("");
        void act(async () => {
          await api.completeClaudeLogin(flow.id, pasted, engine);
          setFlow((current) => current?.id === flow.id ? { ...current, code_sent: true } : current);
        });
      }}>
        <label className="block text-xs">Claude yetkilendirme kodu
          <input type="password" autoComplete="off" spellCheck={false} maxLength={1024} value={code}
            disabled={busy || flow.code_sent} onChange={(event) => setCode(event.target.value)}
            className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <button className={BUTTON} disabled={busy || flow.code_sent || !code.trim()} type="submit">Kodu gönder</button>
      </form>
      <p className="text-xs text-muted">Kod, sunucunuzdaki Claude CLI&apos;a bir kez gönderilir. Bu giriş beş dakika içinde geçerliliğini yitirir.</p>
      {flow.code_sent && <p role="status" className="text-xs text-muted">Kod gönderildi. Claude&apos;un hesabı doğrulaması bekleniyor…</p>}
    </div>}
    {phase === "succeeded" && <p role="status" className="text-xs text-success">{label} hesabı bağlandı.</p>}
    {(error || flow?.error) && <p role="alert" className="text-xs text-danger">{error || flow?.error}</p>}
  </div>;
}
