"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, isLaunchTokenMissing, type ApplicationSetting, type DesktopSettings } from "@/lib/api";
import { ApprovalsTabs } from "@/components/approvals/ApprovalsPanel";
import { EngineSettings } from "@/components/EngineSettings";
import { ConnectedAppsSection } from "@/components/ConnectedAppsSection";
import { DesktopSetup } from "@/components/DesktopSetup";
import { DevicesSection } from "@/components/DevicesSection";
import { AppUpdates } from "@/components/AppUpdates";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { TipsGuide, TipsResetButton } from "@/components/TipsGuide";

declare global {
  interface Window {
    openDots?: {
      choosePath(kind: "file" | "folder"): Promise<string | null>;
      openGoogleSignIn(url: string): Promise<void>;
      openClaudeSignIn?(url: string): Promise<void>;
      openComposioLink(url: string): Promise<void>;
      nativeControl(request: import("@/components/chat/NativeComputer").NativeRequest): Promise<import("@/components/chat/NativeComputer").NativeStatus | { held: boolean }>;
      updates?: import("@/components/AppUpdates").UpdatesBridge;
    };
  }
}

const fields: Record<string, { label: string; help: string; type: "file" | "folder" | "checkbox" | "number"; min?: number; max?: number }> = {
  LOCAL_CLAUDE_CLI_PATH: { label: "Claude çalıştırılabilir dosyası", help: "PATH üzerinden otomatik bulunması için boş bırakın. Seçilen dosya sizin hesabınızla çalışır. Windows'taki npm claude.cmd ara dosyaları desteklenir.", type: "file" },
  LOCAL_WORKSPACE_ROOT: { label: "Çalışma klasörü kökü", help: "Yeni sohbetler burada bir alt klasör kullanır. Mevcut sohbetler kendi klasörlerini korur. Uygulamanın varsayılanı için boş bırakın.", type: "folder" },
  LOCAL_TOOLS_ENABLED: { label: "Yerel araçlara izin ver", help: "Bu bilgisayarda dosya okuma, dosya değiştirme ve komut çalıştırmaya izin verir. Claude'un sorduğu çağrılar yine İzin ver ya da Reddet yanıtı bekler; mevcut Claude izin kurallarınız da geçerlidir. Kapalıyken Claude yalnız sohbet edebilir.", type: "checkbox" },
  LOCAL_TASK_TIMEOUT_SECONDS: { label: "Yanıt zaman aşımı (saniye)", help: "Onay beklenirken bu sayaç durur.", type: "number", min: 30, max: 3600 },
  LOCAL_APPROVAL_TIMEOUT_SECONDS: { label: "Onay zaman aşımı (saniye)", help: "Yeni onaylar bu sınırı kullanır. Bekleyen sorular kendi son tarihlerini korur. Yanıtlanmayan sorular reddedilir.", type: "number", min: 30, max: 3600 },
  LOCAL_MAX_OUTPUT_BYTES: { label: "Yanıt çıktısı sınırı (bayt)", help: "Her çalıştırmadan saklanan yanıt metninin üst sınırı.", type: "number", min: 1024, max: 16000000 },
};

const inputClass = "block w-full rounded-md border border-line bg-transparent px-3 py-2 text-sm disabled:opacity-50";
const buttonClass = "cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
const display = (value: unknown) => value === null || value === undefined ? "Kullanılamıyor" : value === "" ? "Otomatik / uygulama varsayılanı" : typeof value === "string" ? value : JSON.stringify(value);
const applies = (row: ApplicationSetting) => row.key === "LOCAL_WORKSPACE_ROOT" ? "Yeni sohbetlerde" : row.key === "LOCAL_APPROVAL_TIMEOUT_SECONDS" ? "Yeni onaylarda" : row.applies === "next_run" ? "Sonraki yanıtta" : row.applies === "restart" ? "Yeniden başlatınca" : "Hemen";

export function SettingsApp() {
  const router = useRouter();
  const [data, setData] = useState<DesktopSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadTick, setLoadTick] = useState(0);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [headless, setHeadless] = useState(false);
  const [setupReplay, setSetupReplay] = useState(false);
  const settingUp = setupReplay || data?.settings.some((row) => row.key === "DESKTOP_ONBOARDING_COMPLETED" && row.value === false) === true;

  useEffect(() => {
    let cancelled = false;
    api.getDesktopSettings().then((value) => {
      if (cancelled) return;
      setData(value);
      setHeadless(false);
      setDrafts(Object.fromEntries(value.settings.map((row) => [row.key, row.value])));
      setError(null);
      setNotice(null);
    }).catch((err: unknown) => {
      if (cancelled) return;
      if (err instanceof ApiError && err.status === 404) { setHeadless(true); setError(null); }
      else setError(isLaunchTokenMissing(err) ? "Ayarları Open Duet uygulama penceresinin içinden açın." : err instanceof ApiError ? err.message : "Arka uca ulaşılamadı. Uygulamanın çalıştığını kontrol edin.");
    });
    return () => { cancelled = true; };
  }, [loadTick]);

  const save = async (row: ApplicationSetting, event: React.FormEvent) => {
    event.preventDefault();
    setBusy(row.key); setError(null); setNotice(null);
    try {
      const saved = await api.saveDesktopSetting(row.key, drafts[row.key], row.version);
      setData((previous) => previous && ({ ...previous, settings: previous.settings.map((item) => item.key === row.key ? saved : item) }));
      setDrafts((previous) => ({ ...previous, [row.key]: saved.value }));
      setNotice(`${fields[row.key].label} kaydedildi. Ne zaman geçerli: ${applies(saved).toLocaleLowerCase("tr-TR")}. Süren yanıtlar ve mevcut onay son tarihleri değişmez.`);
      if (row.key === "LOCAL_CLAUDE_CLI_PATH") setStatus(null);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Kaydedilemedi. Değişiklikleriniz formda duruyor."); }
    finally { setBusy(null); }
  };

  const browse = async (row: ApplicationSetting) => {
    setBusy(row.key); setError(null);
    try {
      if (!window.openDots) throw new Error("Göz atma yalnız masaüstü uygulamasında kullanılabilir.");
      const selected = await window.openDots.choosePath(fields[row.key].type === "file" ? "file" : "folder");
      if (selected !== null) setDrafts((previous) => ({ ...previous, [row.key]: selected }));
    } catch (err) { setError(err instanceof Error ? err.message : "Seçici açılamadı."); }
    finally { setBusy(null); }
  };

  const check = async () => {
    setChecking(true);
    try {
      const result = await api.testDesktopClaude();
      setStatus(result.available ? `Hazır${result.version ? ` · ${result.version}` : ""}` : result.error || "Claude hazır değil.");
    } catch { setStatus("Claude kontrol edilemedi. Yeniden deneyin."); }
    finally { setChecking(false); }
  };

  return <div className="min-h-dvh">
    <header className="flex h-12 items-center gap-4 border-b border-line px-4"><Link href="/chat/" className="text-sm text-muted hover:underline">← Sohbet</Link><h1 className="text-sm font-semibold">Ayarlar</h1></header>
    <main className="mx-auto max-w-2xl space-y-6 px-5 py-8">
      <div><h2 className="text-xl font-semibold">Ayarlar</h2><p className="mt-2 text-sm text-muted">Motorları ve onayları yapılandırın. Uygulamayı kullanırken masaüstü tercihlerini aşağıda kaydedebilirsiniz.</p></div>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-raised p-5">
        <div><h3 className="font-semibold">Görünüm</h3><p className="mt-1 text-xs text-muted">Varsayılan olarak sisteminizi izler. Yalnız bu tarayıcıda saklanır.</p></div>
        <ThemeToggle />
      </section>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-raised p-5">
        <div><h3 className="font-semibold">İpuçları</h3><p className="mt-1 text-xs text-muted">Uygulamanın neyi nasıl yaptığını adım adım gösteren kartlar.</p></div>
        <TipsResetButton />
      </section>
      <TipsGuide page="settings" />
      <AppUpdates />
      {error && <p role="alert" className="rounded-md border border-danger/50 p-3 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-line p-3 text-sm">{notice}</p>}
      {headless && <p className="text-sm text-muted">Bu kurulumda çalışma klasörü, çalıştırılabilir dosya ve zaman aşımı tercihleri arka ucun ortam yapılandırmasından gelir.</p>}
      {!data && !error && !headless && <p role="status">Ayarlar yükleniyor…</p>}
      {!headless && <button className={buttonClass} disabled={busy !== null} onClick={() => setLoadTick((n) => n + 1)}>{data ? "Kayıtlı ayarları yeniden yükle" : "Yeniden dene"}</button>}
      {data && settingUp && <DesktopSetup settings={data} onSaved={(saved) => {
        setData((previous) => previous && ({ ...previous, settings: previous.settings.map((item) => item.key === saved.key ? saved : item) }));
        setDrafts((previous) => ({ ...previous, [saved.key]: saved.value }));
      }} onFinished={(agentId, selection) => {
        setSetupReplay(false);
        const query = new URLSearchParams();
        if (agentId !== undefined) query.set("agent", String(agentId));
        else if (selection) { query.set("engine", selection.provider); if (selection.model) query.set("model", selection.model); }
        router.push(`/chat/${query.size ? `?${query}` : ""}`);
      }} />}
      {data && !settingUp && <>
        {data.settings.some((row) => row.key === "DESKTOP_ONBOARDING_COMPLETED") && <button type="button" className={buttonClass} onClick={() => setSetupReplay(true)}>Kurulumu yeniden çalıştır</button>}
        <section className="space-y-5 rounded-lg border border-line p-5">
          <h3 className="font-semibold">Claude Code</h3>
          {data.settings.map((row) => {
            const field = fields[row.key];
            if (!field) return null;
            const value = drafts[row.key];
            const dirty = JSON.stringify(value) !== JSON.stringify(row.value);
            return <form key={row.key} onSubmit={(event) => save(row, event)} className="space-y-2 border-b border-line pb-5 last:border-0 last:pb-0">
              <label htmlFor={row.key} className="block text-sm font-medium">{field.label}</label>
              <div className="flex items-center gap-2">
                {field.type === "checkbox" ? <input id={row.key} type="checkbox" disabled={busy !== null} checked={value === true} onChange={(event) => setDrafts((previous) => ({ ...previous, [row.key]: event.target.checked }))} /> : <input id={row.key} className={inputClass} disabled={busy !== null} type={field.type === "number" ? "number" : "text"} min={field.min} max={field.max} step={1} required={field.type === "number"} value={field.type === "number" ? typeof value === "number" ? value : "" : typeof value === "string" ? value : ""} onChange={(event) => setDrafts((previous) => ({ ...previous, [row.key]: field.type === "number" ? event.target.value === "" ? null : Number(event.target.value) : event.target.value }))} autoComplete="off" spellCheck={false} />}
                {(field.type === "file" || field.type === "folder") && <button type="button" aria-label={`${field.label}: göz at`} disabled={busy !== null} className={buttonClass} onClick={() => browse(row)}>Göz at</button>}
              </div>
              <p className="text-xs text-muted">{field.help}{field.type === "number" ? ` Aralık: ${field.min}–${field.max}.` : ""}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted"><span className="rounded bg-inset px-2 py-1">Kaynak: {row.source}</span><span className="rounded bg-inset px-2 py-1">{applies(row)}</span></div>
              <p className="break-all text-xs text-muted">Geçerli değer: {display(row.effective_value)} · Varsayılan: {display(row.default)}</p>
              {row.resolved_path && <p className="break-all font-mono text-xs text-muted">Yeni sohbet klasörü: {row.resolved_path}</p>}
              {row.error && <p role="alert" className="text-xs text-danger">{row.error} Kayıtlı değer: {display(row.value)}</p>}
              <div className="flex gap-2"><button type="submit" disabled={busy !== null || !dirty} className={buttonClass} aria-label={`${field.label}: kaydet`}>{busy === row.key ? "İşleniyor…" : "Kaydet"}</button><button type="button" className={buttonClass} disabled={busy !== null || !dirty} onClick={() => setDrafts((previous) => ({ ...previous, [row.key]: row.value }))}>Vazgeç</button></div>
            </form>;
          })}
          <button className={buttonClass} disabled={checking || busy !== null} onClick={check}>{checking ? "Kontrol ediliyor…" : "Claude durumunu kontrol et"}</button>
          {status && <p role="status" className="text-sm">{status}</p>}
          <p className="text-xs text-muted">Kayıtlı ayarları kontrol eder. Giriş yapmak için Motorlar bölümündeki Claude&apos;a giriş yap düğmesini kullanın (ya da bir terminalde <code>claude auth login</code> çalıştırın), ardından yeniden kontrol edin.</p>
        </section>
        <section className="space-y-4 rounded-lg border border-line p-5"><h3 className="font-semibold">Depolama</h3><p className="text-xs text-muted">Masaüstü uygulaması yönetir. Bu konumlar buradan değiştirilemez.</p><dl className="space-y-3 text-sm">{Object.entries(data.storage).map(([name, value]) => <div key={name}><dt className="font-medium capitalize">{name.replaceAll("_", " ")}</dt><dd className="mt-1 break-all text-xs text-muted">{value}</dd></div>)}</dl></section>
      </>}
      {!settingUp && <>
        <DevicesSection />
        <EngineSettings />
        <ConnectedAppsSection />
        <section className="rounded-lg border border-line p-5"><h3 className="mb-1 font-semibold">Onaylar</h3><p className="mb-4 text-xs text-muted">Her zaman izin verdiğiniz komutlar, araç çağrılarıyla ilgili tüm kararlar ve son sohbetlerin salt okunur sağlık taraması.</p><ApprovalsTabs /></section>
      </>}
    </main>
  </div>;
}
