"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { auth } from "@/lib/auth";
import { AuthGate, useSession } from "@/components/AuthGate";
import { ConnectTelegram } from "@/components/ConnectTelegram";
import { ConnectClaude } from "@/components/ConnectClaude";
import { ConnectGitHub } from "@/components/ConnectGitHub";
import { SubmitTask } from "@/components/SubmitTask";

// The original Telegram and Boat task page. It moved here when /chat became the
// home page; nothing in it changed. It is not linked from the app: open /tasks/
// on a server install that has Boat and Telegram configured.
export default function TasksPage() {
  return (
    <AuthGate>
      <Home />
    </AuthGate>
  );
}

function Home() {
  // Who the web UI acts as comes from the signed-in session (docs/AUTH.md),
  // never from this browser's storage.
  const { session, setUserId } = useSession();
  const userId = session?.user_id ?? null;
  const [identityError, setIdentityError] = useState<string | null>(null);
  // Claude is signed in inside the sandbox: tasks can be submitted.
  const [boxId, setBoxId] = useState<string | null>(null);
  // The sandbox exists, signed in or not: enough to connect GitHub.
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  // null until the backend has said whether Boat sandboxes are configured.
  const [boatEnabled, setBoatEnabled] = useState<boolean | null>(null);
  const [boatReason, setBoatReason] = useState<string | null>(null);
  // Set when the backend could not be reached at all (not when it answered with an error).
  const [backendProblem, setBackendProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getProviders()
      .then((providers) => {
        if (cancelled) return;
        setBoatEnabled(providers.boat.enabled);
        setBoatReason(providers.boat.reason);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          // The backend answered but has no /providers (an older version):
          // behave as before and show the Boat steps.
          setBoatEnabled(true);
          return;
        }
        // No answer at all: the backend is down, or the browser blocked the
        // request because this page's address is not in FRONTEND_ORIGINS.
        setBackendProblem(
          `Arka uca ulaşılamıyor. Çalıştığını ve bu sayfanın adresinin (${window.location.origin}) backend/.env dosyasındaki FRONTEND_ORIGINS içinde yer aldığını kontrol edin.`
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLinked = async (identity: { link_code: string } | { guest: true }) => {
    setIdentityError(null);
    try {
      const { user_id } = await auth.setIdentity(identity);
      setUserId(user_id);
    } catch (err) {
      setIdentityError(err instanceof ApiError ? err.message : "Kimliğiniz kaydedilemedi.");
    }
  };

  const handleReset = async () => {
    setIdentityError(null);
    try {
      await auth.clearIdentity();
    } catch (err) {
      setIdentityError(err instanceof ApiError ? err.message : "Baştan başlanamadı.");
      return;
    }
    setUserId(null);
    setBoxId(null);
    setSandboxId(null);
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-inset px-4 py-12">
      <main className="w-full max-w-lg space-y-4">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold">Open Duet</h1>
          <p className="text-sm text-muted">
            Hesaplarınızı bağlayın, ardından bir görev gönderin.
          </p>
          <Link href="/chat" className="mt-2 inline-block text-sm font-medium underline">
            Sohbeti aç
          </Link>
        </div>

        {backendProblem ? (
          <section className="rounded-lg border border-danger/50 p-5">
            <h2 className="text-base font-semibold">Arka uca ulaşılamıyor</h2>
            <p className="mt-1 text-sm text-muted">{backendProblem}</p>
          </section>
        ) : boatEnabled === null ? (
          <p className="text-center text-sm text-muted">Yükleniyor…</p>
        ) : (
          <>
            <ConnectTelegram userId={userId} onLinked={handleLinked} onReset={handleReset} />
            {identityError && <p role="alert" className="text-sm text-danger">{identityError}</p>}

            {boatEnabled ? (
              <>
                {userId ? (
                  <ConnectClaude
                    key={userId}
                    userId={userId}
                    onReady={setBoxId}
                    onSandbox={setSandboxId}
                  />
                ) : (
                  <section className="rounded-lg border border-line p-5 opacity-50">
                    <h2 className="text-base font-semibold">2. Claude&apos;u bağlayın</h2>
                  </section>
                )}

                {userId ? (
                  <ConnectGitHub boxId={sandboxId} />
                ) : (
                  <section className="rounded-lg border border-line p-5 opacity-50">
                    <h2 className="text-base font-semibold">3. GitHub&apos;ı bağlayın (isteğe bağlı)</h2>
                  </section>
                )}

                {userId ? (
                  <SubmitTask userId={userId} boxId={boxId} />
                ) : (
                  <section className="rounded-lg border border-line p-5 opacity-50">
                    <h2 className="text-base font-semibold">4. Bir görev gönderin</h2>
                  </section>
                )}
              </>
            ) : (
              <>
                <section className="rounded-lg border border-line p-5">
                  <h2 className="text-base font-semibold">Boat korumalı alanları kapalı</h2>
                  <p className="mt-1 text-sm text-muted">
                    Claude&apos;u korumalı alanda bağlamak, GitHub, zamanlamalar ve araç görevleri
                    Boat gerektirir. Yukarıdaki yerel Claude onsuz da çalışır.
                    {boatReason ? ` (${boatReason}.)` : ""}
                  </p>
                </section>

                {userId && (
                  <SubmitTask
                    userId={userId}
                    boxId={null}
                    step={2}
                    showComposer={false}
                    blockedReason="Boat kapalıyken yeni Boat görevleri kullanılamaz."
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
