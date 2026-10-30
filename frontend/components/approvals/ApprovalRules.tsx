"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type ApprovalRule } from "@/lib/api";
import { ruleMatchLabel, ruleScopeLabel } from "@/lib/approvals";
import { BUTTON, FIELD, FIELD_BOX, PRIMARY } from "./styles";

// The saved "always allow" rules for shell commands: list, add and remove.
// With a `workspace`, it starts on the rules that apply in that folder.
export function ApprovalRules({
  workspace = null,
  threadId = null,
}: {
  workspace?: string | null;
  threadId?: number | null;
}) {
  const [rules, setRules] = useState<ApprovalRule[] | null>(null);
  const [onlyHere, setOnlyHere] = useState(workspace !== null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<"exact" | "prefix">("exact");
  const [command, setCommand] = useState("");
  const [folder, setFolder] = useState(workspace ?? "");

  useEffect(() => {
    let cancelled = false;
    api
      .listApprovalRules(onlyHere ? workspace : null)
      .then((list) => {
        if (!cancelled) {
          setRules(list);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Kayıtlı kurallar yüklenemedi.");
      });
    return () => {
      cancelled = true;
    };
  }, [onlyHere, workspace, tick]);

  const run = async (action: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      then?.();
      setTick((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İşlem başarısız oldu.");
    } finally {
      setBusy(false);
    }
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    run(
      () => api.addApprovalRule({ match, command: command.trim(), workspace: folder.trim() || null }),
      () => setCommand("")
    );
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted">
        Kayıtlı bir kural, bir kabuk komutunun sormadan çalışmasını sağlar. Diğer her şey yine sorar; güvenlik
        tabanındaki bir komut (ev klasörünüzü silmek, bir diski biçimlendirmek, zorla gönderme (force push)…) kural
        ne derse desin her zaman sorar. Belirli sözcüklerle başlayan bir kural, arkasına başka bir komut ekleyen
        bir komutla asla eşleşmez.
      </p>
      {workspace !== null && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} />
          Yalnız bu sohbetin klasöründe geçerli kurallar
        </label>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {rules === null && !error && <p className="text-xs text-muted">Yükleniyor…</p>}
      {rules !== null && rules.length === 0 && (
        <p className="rounded-md bg-inset px-3 py-3 text-xs text-muted">
          {onlyHere ? "Bu klasör için kayıtlı kural yok" : "Kayıtlı kural yok"}. Bir istekte &ldquo;Bu komuta her
          zaman izin ver&rdquo; seçeneğini seçin ya da aşağıdan bir kural ekleyin.
        </p>
      )}
      {rules !== null && rules.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-start gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-all font-mono text-xs">{rule.command}</p>
                <p className="mt-0.5 break-all text-xs text-muted">
                  {ruleMatchLabel(rule)} · {ruleScopeLabel(rule)}
                </p>
              </div>
              <button
                className={BUTTON}
                disabled={busy}
                aria-label={`${rule.command} kuralını kaldır`}
                onClick={() => run(() => api.deleteApprovalRule(rule.id, threadId))}
              >
                Kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="space-y-2 rounded-md border border-line p-3">
        <p className="text-xs font-medium">Kural ekle</p>
        <div className="flex gap-2">
          <select
            aria-label="Komutun nasıl eşleşeceği"
            value={match}
            onChange={(e) => setMatch(e.target.value === "prefix" ? "prefix" : "exact")}
            className={`${FIELD_BOX} w-36 shrink-0`}
          >
            <option value="exact">Tam olarak</option>
            <option value="prefix">Şununla başlar</option>
          </select>
          <input
            aria-label="Komut"
            className={`${FIELD} font-mono`}
            placeholder={match === "prefix" ? "git status" : "npm test"}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            maxLength={1000}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <input
          aria-label="Klasör"
          className={`${FIELD} font-mono`}
          placeholder="Klasör (boş: tüm klasörler)"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className={PRIMARY} disabled={busy || !command.trim()}>
          {busy ? "Kaydediliyor…" : "Kural ekle"}
        </button>
      </form>
    </div>
  );
}
