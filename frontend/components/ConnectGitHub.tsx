"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, DeviceLogin } from "@/lib/api";
import { Button, Card, ErrorText } from "./Card";

const POLL_INTERVAL_MS = 3000;

export function ConnectGitHub({ boxId }: { boxId: string | null }) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!boxId) {
      // No sandbox to ask about: nothing is being checked.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecking(false);
      return;
    }

    (async () => {
      setChecking(true);
      try {
        const status = await api.getAuthStatus(boxId, "github");
        if (!cancelled) setConnected(status.connected);
      } catch {
        // non-fatal — just leave it as "not connected"
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [boxId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startLogin = async () => {
    if (!boxId) return;
    setError(null);
    setStarting(true);
    try {
      const login = await api.startDeviceLogin(boxId, "github");
      setDeviceLogin(login);

      pollRef.current = setInterval(async () => {
        try {
          const status = await api.getAuthStatus(boxId, "github");
          if (status.connected) {
            if (pollRef.current) clearInterval(pollRef.current);
            setConnected(true);
            setDeviceLogin(null);
          }
        } catch {
          // transient — keep polling
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "GitHub girişi başlatılamadı.");
    } finally {
      setStarting(false);
    }
  };

  if (checking) {
    return (
      <Card step={3} title="GitHub'ı bağla (isteğe bağlı)" disabled={!boxId}>
        <p className="text-sm text-muted">Kontrol ediliyor…</p>
      </Card>
    );
  }

  if (connected) {
    return (
      <Card step={3} title="GitHub'ı bağla (isteğe bağlı)" done>
        <p className="text-sm text-muted">
          GitHub bağlı — bir depoya gönderim (push) yapan görevler sizin hesabınızı kullanır.
        </p>
      </Card>
    );
  }

  return (
    <Card step={3} title="GitHub'ı bağla (isteğe bağlı)" disabled={!boxId}>
      <p className="mb-3 text-sm text-muted">
        Yalnız görevlerin sizin adınıza <code>git push</code> yapmasını istiyorsanız gerekir.
        Buna ihtiyacınız yoksa bu adımı atlayın.
      </p>

      {!deviceLogin && (
        <Button onClick={startLogin} disabled={starting}>
          {starting ? "Başlatılıyor…" : "GitHub'ı bağla"}
        </Button>
      )}

      {deviceLogin && (
        <div className="space-y-2">
          <p className="text-sm">
            Bu kodu girin:{" "}
            <code className="rounded bg-inset px-2 py-1 font-mono text-base font-semibold">
              {deviceLogin.code}
            </code>
          </p>
          <a
            href={deviceLogin.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-accent underline hover:opacity-80"
          >
            {deviceLogin.url} adresini aç →
          </a>
          <p className="text-xs text-muted">
            Onaylamanız bekleniyor — buraya geri dönmenize gerek yok, bu sayfa
            kendiliğinden güncellenir.
          </p>
        </div>
      )}

      <ErrorText message={error} />
    </Card>
  );
}
