"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ComposioStatus } from "@/lib/api";
import {
  POLL_INTERVAL_MS, accountsOf, outcomeFor, pollDeadline, reservePage, statusLabel,
  type ComposioAccount, type ComposioApp, type TabWindow,
} from "@/lib/connected-apps";

const BUTTON = "cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "block w-full rounded-md border border-line bg-transparent px-3 py-2 text-sm disabled:opacity-50";

type Waiting = { accountId: string; toolkit: string; expiresIn: number };

const message = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

// Settings: the owner's Composio key, and connecting, listing and disconnecting
// apps. Agent access is granted separately in each eligible agent's settings.
export function ConnectedAppsSection() {
  const [status, setStatus] = useState<ComposioStatus | null>(null);
  const [accounts, setAccounts] = useState<ComposioAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState(false);

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await api.listComposioAccounts()); setError(null); }
    catch (err) { setError(message(err, "Bağlı uygulamalarınız yüklenemedi.")); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getComposioStatus().then((value) => {
      if (cancelled) return;
      setStatus(value);
      if (value.configured) void loadAccounts();
    }).catch((err: unknown) => { if (!cancelled) setError(message(err, "Bağlı uygulamalar yüklenemedi.")); });
    return () => { cancelled = true; };
  }, [loadAccounts]);

  // Waiting for the person to finish in the browser: stops on success, failure,
  // cancel, the link's lifetime, and when this section goes away.
  const accountId = waiting?.accountId;
  const expiresIn = waiting?.expiresIn;
  useEffect(() => {
    if (!accountId || expiresIn === undefined) return;
    const deadline = pollDeadline(expiresIn, Date.now());
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await api.listComposioAccounts();
        if (cancelled) return;
        setAccounts(latest);
        const outcome = outcomeFor(latest, accountId);
        if (outcome === "connected") { setWaiting(null); setNotice("Uygulama bağlandı."); return; }
        if (outcome === "failed") { setWaiting(null); setError("Bağlantı tamamlanmadı. Aşağıdan kaldırıp yeniden deneyin."); return; }
        if (outcome === "gone") { setWaiting(null); setError("Bu bağlantı artık yok."); return; }
      } catch (err) {
        if (cancelled) return;
        setWaiting(null); setError(message(err, "Bağlantı kontrol edilemedi.")); return;
      }
      if (Date.now() > deadline) { setWaiting(null); setError("Bağlanma adresinin süresi işlem bitmeden doldu. Yeniden deneyin."); return; }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accountId, expiresIn]);

  const saveKey = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("key"); setError(null); setNotice(null);
    try {
      const saved = await api.saveComposioKey(keyDraft.trim());
      setKeyDraft(""); setReplacing(false); setStatus(saved); setAccounts(null); setWaiting(null);
      setNotice("Anahtar kaydedildi.");
      await loadAccounts();
    } catch (err) { setError(message(err, "Anahtar kaydedilemedi.")); }
    finally { setBusy(null); }
  };

  const removeKey = async () => {
    setBusy("key"); setError(null); setNotice(null);
    try {
      await api.deleteComposioKey();
      setStatus((previous) => previous && { ...previous, configured: false });
      setAccounts(null); setWaiting(null); setRemovingKey(false);
      setNotice("Anahtar bu uygulamadan kaldırıldı. Bağlı hesapların Composio'daki erişimi iptal edilmedi.");
    } catch (err) { setError(message(err, "Anahtar kaldırılamadı.")); }
    finally { setBusy(null); }
  };

  const connect = async (app: ComposioApp) => {
    setBusy(`connect:${app.slug}`); setError(null); setNotice(null);
    // Opened now, during the click, so a browser does not block it.
    const page = reservePage(window.openDots, (url, target) => window.open(url, target) as TabWindow | null);
    try {
      const link = await api.connectComposioApp(app.slug, names[app.slug]?.trim() || undefined);
      await page.navigate(link.redirect_url);
      setNames((previous) => ({ ...previous, [app.slug]: "" }));
      setWaiting({ accountId: link.account_id, toolkit: app.slug, expiresIn: link.expires_in_seconds });
      await loadAccounts();
    } catch (err) { page.cancel(); setError(message(err, "Bağlantı başlatılamadı.")); }
    finally { setBusy(null); }
  };

  const disconnect = async (account: ComposioAccount) => {
    setBusy(`remove:${account.id}`); setError(null); setNotice(null);
    try {
      await api.disconnectComposioAccount(account.id);
      setConfirming(null);
      if (waiting?.accountId === account.id) setWaiting(null);
      setNotice("Bağlantı kesildi.");
      await loadAccounts();
    } catch (err) { setError(message(err, "Bağlantı kesilemedi. Yeniden deneyin.")); }
    finally { setBusy(null); }
  };

  const showKeyForm = status !== null && (!status.configured || replacing);
  return <section aria-labelledby="connected-apps-title" className="space-y-4 rounded-lg border border-line p-5">
    <div>
      <h3 id="connected-apps-title" className="font-semibold">Bağlı uygulamalar</h3>
      <p className="mt-1 text-xs text-muted">Uygulamaları kendi Composio hesabınız üzerinden bağlayın. Anahtarınız bu bilgisayarda şifrelenmiş olarak saklanır ve bir daha gösterilmez. Ardından bir uygulamaya Ajanlar → bir ajan seçin → Bağlı uygulamalar bölümünden izin verin. Ajanlar izin verilen uygulamaları yalnız sizin başlattığınız sohbetlerde kullanabilir.</p>
    </div>
    {error && <p role="alert" className="rounded-md border border-danger/50 p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-line p-3 text-sm">{notice}</p>}
    {!status && !error && <p role="status" className="text-sm text-muted">Yükleniyor…</p>}

    {showKeyForm && <form onSubmit={saveKey} className="space-y-2">
      <label htmlFor="composio-key" className="block text-sm font-medium">{status.configured ? "Yeni Composio proje anahtarı" : "Composio proje anahtarı"}</label>
      <input id="composio-key" type="password" className={FIELD} value={keyDraft} disabled={busy !== null} required minLength={11}
        onChange={(event) => setKeyDraft(event.target.value)} autoComplete="off" spellCheck={false} placeholder="ak_…" />
      <p className="text-xs text-muted">Composio panonuzda bir proje anahtarı oluşturun (<code>ak_</code> ile başlar). Anahtar kaydedilmeden önce Composio ile doğrulanır. Kapsamı sınırlı bir anahtar şu izinleri gerektirir: Connected accounts: Read, Session management: Write ve Session tool execution: Write. Hesapların bağlantısını kesebilmek için Connected accounts: Write iznini de ekleyin. Composio kapsamları anahtar oluşturulurken sabitler; kapsamları değiştirdikten sonra yeni bir anahtar oluşturun.</p>
      <div className="flex gap-2">
        <button type="submit" className={BUTTON} disabled={busy !== null || keyDraft.trim().length < 11}>{busy === "key" ? "Kontrol ediliyor…" : "Anahtarı kaydet"}</button>
        {replacing && <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => { setReplacing(false); setKeyDraft(""); }}>İptal</button>}
      </div>
    </form>}

    {status?.configured && <>
      {accounts === null && !error && <p role="status" className="text-sm text-muted">Uygulamalarınız yükleniyor…</p>}
      <ul className="space-y-3">
        {status.apps.map((app) => {
          const mine = accountsOf(accounts ?? [], app.slug);
          const connecting = waiting?.toolkit === app.slug;
          return <li key={app.slug} className="space-y-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{app.label}</span>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`name-${app.slug}`}>Yeni {app.label} hesabı için ad (isteğe bağlı)</label>
                <input id={`name-${app.slug}`} className="w-40 rounded-md border border-line bg-transparent px-2 py-1 text-sm disabled:opacity-50" placeholder="Ad (isteğe bağlı)" maxLength={40}
                  value={names[app.slug] ?? ""} disabled={busy !== null || waiting !== null} autoComplete="off"
                  onChange={(event) => setNames((previous) => ({ ...previous, [app.slug]: event.target.value }))} />
                <button type="button" className={BUTTON} disabled={busy !== null || waiting !== null || accounts === null} onClick={() => void connect(app)}>
                  {busy === `connect:${app.slug}` ? "Açılıyor…" : mine.length ? "Bir tane daha ekle" : "Bağla"}
                </button>
              </div>
            </div>
            {connecting && <p role="status" className="text-xs text-muted">
              {app.label} bağlantısını tarayıcınızda tamamlayın. İşiniz bitince bu sayfa bunu fark eder.{" "}
              <button type="button" className="underline" onClick={() => { setWaiting(null); setNotice("Beklemeyi bıraktınız. Bekleyen bağlantıyı aşağıdan kaldırabilirsiniz; hiçbir erişim iptal edilmedi."); }}>Beklemeyi bırak</button>
            </p>}
            {mine.length > 0 && <ul className="divide-y divide-line text-sm">
              {mine.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{account.alias ?? account.id} <span className="text-xs text-muted">· {statusLabel(account.status)}</span></span>
                {confirming === account.id
                  ? <span className="flex items-center gap-2 text-xs">Bu hesabın bağlantısı kesilsin mi?
                      <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void disconnect(account)}>{busy === `remove:${account.id}` ? "İşleniyor…" : "Bağlantıyı kes"}</button>
                      <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setConfirming(null)}>Vazgeç</button></span>
                  : <button type="button" className={BUTTON} disabled={busy !== null} aria-label={`${account.alias ?? account.id} bağlantısını kes`} onClick={() => setConfirming(account.id)}>Bağlantıyı kes</button>}
              </li>)}
            </ul>}
          </li>;
        })}
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {!replacing && <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setReplacing(true)}>Anahtarı değiştir</button>}
        {removingKey
          ? <span className="flex flex-wrap items-center gap-2 text-xs">Anahtar bu uygulamadan kaldırılsın mı? Bağlı hesaplar Composio&apos;da kalır; erişimlerini iptal etmek için önce bağlantılarını kesin.
              <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void removeKey()}>Anahtarı kaldır</button>
              <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setRemovingKey(false)}>Vazgeç</button></span>
          : <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setRemovingKey(true)}>Anahtarı kaldır</button>}
      </div>
    </>}
  </section>;
}
