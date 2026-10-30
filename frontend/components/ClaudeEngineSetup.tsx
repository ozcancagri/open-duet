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
        if (!stopped) setError(err instanceof ApiError ? err.message : "Could not check Claude sign-in.");
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [flowId, phase, engine]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not update Claude sign-in."); }
    finally { setBusy(false); }
  };
  const running = flow?.phase === "running";
  const link = trustedLink(flow?.authorization_url);
  return <div className="space-y-2">
    <button className={BUTTON} disabled={busy || running || signOutPending} onClick={() => void act(async () => {
      setCode(""); setCopied(false); setFlow(await api.startClaudeEngineLogin(engine));
    })}>Sign in to {label}</button>
    {signedIn && <EngineSignOut label={label} disabled={busy || running} onSignOut={() => api.logoutClaudeEngine(engine)} onChanged={onChanged} onPendingChange={setSignOutPending} />}
    {running && <button className={`${BUTTON} ml-2`} disabled={busy} onClick={() => void act(async () => {
      await api.cancelClaudeLogin(flow.id, engine); setCode(""); setFlow(null); changed.current();
    })}>Cancel {label} sign-in</button>}
    {running && !link && <p role="status" className="text-xs text-muted">Preparing Claude sign-in…</p>}
    {running && link && <div className="space-y-2 text-sm">
      <p>Open <a href={link} target="_blank" rel="noreferrer" className="underline" onClick={(event) => {
        // The desktop window cannot open windows: its shell opens the page in the system browser.
        const open = window.openDots?.openClaudeSignIn;
        if (!open) return;
        event.preventDefault();
        open(link).catch(() => setError("Could not open the browser. Copy the link and open it yourself."));
      }}>Claude sign-in</a>, then paste the code shown after signing in.{" "}
        <button type="button" className="underline" onClick={() => {
          navigator.clipboard.writeText(link).then(() => setCopied(true), () => setError("Could not copy the link."));
        }}>{copied ? "Link copied" : "Copy link"}</button>
        <span className="block text-xs text-muted">To use another account than the one signed in to your browser, open the copied link in a private window.</span></p>
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
        <label className="block text-xs">Claude authorization code
          <input type="password" autoComplete="off" spellCheck={false} maxLength={1024} value={code}
            disabled={busy || flow.code_sent} onChange={(event) => setCode(event.target.value)}
            className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <button className={BUTTON} disabled={busy || flow.code_sent || !code.trim()} type="submit">Submit code</button>
      </form>
      <p className="text-xs text-muted">The code is sent once to the Claude CLI on your server. This sign-in expires in five minutes.</p>
      {flow.code_sent && <p role="status" className="text-xs text-muted">Code submitted. Waiting for Claude to confirm the account…</p>}
    </div>}
    {phase === "succeeded" && <p role="status" className="text-xs text-success">{label} account connected.</p>}
    {(error || flow?.error) && <p role="alert" className="text-xs text-danger">{error || flow?.error}</p>}
  </div>;
}
