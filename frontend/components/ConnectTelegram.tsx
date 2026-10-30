"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, LinkCode } from "@/lib/api";
import { Button, Card, ErrorText } from "./Card";

const POLL_INTERVAL_MS = 2000;

function isGuestId(userId: string) {
  return userId.startsWith("web_");
}

export function ConnectTelegram({
  userId,
  onLinked,
  onReset,
}: {
  userId: string | null;
  // The server sets the identity: from the link code it saw claimed, or a new guest id.
  onLinked: (identity: { link_code: string } | { guest: true }) => void;
  onReset: () => void;
}) {
  const [mode, setMode] = useState<"choice" | "telegram">("choice");
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const generateCode = async () => {
    setError(null);
    setLoading(true);
    try {
      const code = await api.createLinkCode();
      setLinkCode(code);

      pollRef.current = setInterval(async () => {
        try {
          const status = await api.getLinkStatus(code.code);
          if (status.status === "claimed" && status.user_id) {
            if (pollRef.current) clearInterval(pollRef.current);
            setLinkCode(null);
            onLinked({ link_code: code.code });
          } else if (status.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            setError("Kodun süresi doldu — yeni bir kod oluşturun.");
            setLinkCode(null);
          }
        } catch {
          // transient network hiccup — keep polling
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kod oluşturulamadı.");
    } finally {
      setLoading(false);
    }
  };

  if (userId) {
    return (
      <Card step={1} title="Başlayın" done>
        {isGuestId(userId) ? (
          <p className="text-sm text-muted">
            Telegram olmadan devam ediliyor.
          </p>
        ) : (
          <p className="text-sm text-muted">
            <code className="font-mono">{userId}</code> Telegram kullanıcısı olarak bağlandı.
          </p>
        )}
        <button
          onClick={onReset}
          className="mt-2 text-sm text-muted underline hover:text-ink"
        >
          Baştan başla
        </button>
      </Card>
    );
  }

  const botLink = linkCode?.bot_username
    ? `https://t.me/${linkCode.bot_username}`
    : null;

  if (mode === "choice") {
    return (
      <Card step={1} title="Başlayın">
        <p className="mb-3 text-sm text-muted">
          Bunu kullanmak için Telegram gerekmez — konuk olarak devam edin ya da
          aynı hesabı/geçmişi orada da istiyorsanız Telegram&apos;ı bağlayın.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onLinked({ guest: true })}>
            Telegram olmadan devam et
          </Button>
          <button
            onClick={() => setMode("telegram")}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-hover"
          >
            Bunun yerine Telegram&apos;ı bağla
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card step={1} title="Başlayın">
      <p className="mb-3 text-sm text-muted">
        Tek kullanımlık bir kod oluşturur. Hesabınızı bağlamak için kodu Telegram&apos;daki
        bota gönderin — burada token ya da parola gerekmez.
      </p>

      {!linkCode && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={generateCode} disabled={loading}>
            {loading ? "Oluşturuluyor…" : "Kod oluştur"}
          </Button>
          <button
            onClick={() => setMode("choice")}
            className="text-sm text-muted underline hover:text-ink"
          >
            Geri
          </button>
        </div>
      )}

      {linkCode && (
        <div className="space-y-2">
          <p className="text-sm">
            Bunu bota gönderin:{" "}
            <code className="rounded bg-inset px-2 py-1 font-mono text-base font-semibold">
              /link {linkCode.code}
            </code>
          </p>
          {botLink && (
            <a
              href={botLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-accent underline hover:opacity-80"
            >
              Telegram&apos;ı aç →
            </a>
          )}
          <p className="text-xs text-muted">Göndermeniz bekleniyor…</p>
        </div>
      )}

      <ErrorText message={error} />
    </Card>
  );
}
