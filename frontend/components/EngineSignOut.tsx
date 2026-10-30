"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";

const BUTTON = "cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-50";

export function EngineSignOut({ label, disabled, onSignOut, onChanged, onPendingChange }: {
  label: string;
  disabled: boolean;
  onSignOut: () => Promise<void>;
  onChanged: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSignOut();
      setConfirming(false);
      onPendingChange(false);
      onChanged();
    } catch (err) {
      // Keep provider and command output out of the settings UI.
      setError(err instanceof ApiError && err.status === 409
        ? "Çıkış doğrulanamadı. Etkin sohbetleri durdurun, bekleyen girişi tamamlayın ve motor durumunu ya da ayarlı API anahtarını kontrol edin."
        : `${label} hesabından çıkış yapılamadı. Motor durumunu kontrol edip yeniden deneyin.`);
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-2">
    {!confirming ? <button type="button" className={BUTTON} disabled={disabled || busy} onClick={() => { setError(null); setConfirming(true); onPendingChange(true); }}>{label} hesabından çıkış yap</button> : <div className="space-y-2 rounded-md border border-warning/50 p-3 text-sm">
      <p>Bu işlem {label} için sunucudaki ortak CLI hesabından çıkış yapar. Bu uygulamanın dışındaki CLI kullanımını da etkileyebilir. Hesap değiştirmek için burada çıkış yapın, sonra mevcut giriş akışını kullanın.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={disabled || busy} onClick={() => void signOut()}>{busy ? "Çıkış yapılıyor…" : `${label} hesabından çıkış yap`}</button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => { setConfirming(false); onPendingChange(false); }}>Girişli kal</button>
      </div>
    </div>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
