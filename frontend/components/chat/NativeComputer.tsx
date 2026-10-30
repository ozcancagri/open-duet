"use client";
import { useEffect, useState } from "react";

export type NativeStatus = { supported: boolean; enabled: boolean; held: boolean; busy: boolean; ready: boolean; reason: string | null };
export type NativeRequest = { method: "status" | "enable" | "disable" | "take" | "release"; agent: number };

export function NativeComputer({ agent, supported }: { agent: number; supported: boolean }) {
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = () => void window.openDots?.nativeControl({ method: "status", agent }).then(value => { if (alive) setStatus(value as NativeStatus); }).catch(() => {});
    read();
    const timer = setInterval(read, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [agent]);
  if (!status?.supported) return null;
  async function act(method: NativeRequest["method"]) {
    setBusy(true); setError(null);
    try {
      await window.openDots?.nativeControl({ method, agent });
      const value = await window.openDots?.nativeControl({ method: "status", agent });
      if (value) setStatus(value as NativeStatus);
    } catch (e) { setError(e instanceof Error ? e.message : "Yerel masaüstü kullanılamıyor."); }
    finally { setBusy(false); }
  }
  return <section className="mb-4 space-y-2 rounded-md border border-line p-3 text-sm" aria-label="Yerel masaüstü">
    <h3 className="font-medium">Bu Mac — yerel masaüstü</h3>
    <p className="text-xs text-muted">Bu Mac&apos;teki uygulamalara, çalışma klasörünün dışı da dahil, isteğe bağlı erişim. Her girdi onay gerektirir. Açıldığında bu ajan yeni turlarda yerel masaüstünü kullanır.</p>
    <p>{status.enabled ? (status.held ? "Denetim sizde. Ajan girdisi durduruldu." : status.busy ? "Yerel masaüstünde bir tur sürüyor." : "Bu ajan için açık.") : "Bu ajan için kapalı. Docker bilgisayarları aşağıda kullanılabilir durumda."}</p>
    {status.reason && <p className="text-xs text-muted">{status.reason}</p>}
    {!supported && <p className="text-xs text-muted">Yerel masaüstü araçlarını kullanmak için Claude&apos;u seçin.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button className="rounded border border-line px-2 py-1 disabled:opacity-50" disabled={busy || (!supported && !status.enabled)} onClick={() => void act(status.enabled ? "disable" : "enable")}>{status.enabled ? "Yerel masaüstünü kapat" : "Bu ajan için aç…"}</button>
      {status.enabled && <button className="rounded border border-line px-2 py-1 disabled:opacity-50" disabled={busy} onClick={() => void act(status.held ? "release" : "take")}>{status.held ? "Denetimi geri ver" : "Denetimi al"}</button>}
    </div>
  </section>;
}
