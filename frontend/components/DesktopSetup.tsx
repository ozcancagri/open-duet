"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type ApplicationSetting, type ApprovalMode, type DesktopSettings, type Engine } from "@/lib/api";
import { APPROVAL_MODES, modelLabel } from "@/lib/agents";
import { EngineSettings } from "./EngineSettings";
import { EngineModelFields } from "./chat/EngineModelFields";
import { firstReadyEngine } from "@/lib/engines";

const BUTTON = "rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50";
const FIELD = "mt-1 w-full rounded-md border border-line bg-transparent px-3 py-2 text-sm";
const STEPS = ["Motor", "Çalışma klasörü", "Onaylar", "Hazır"];

export function DesktopSetup({ settings, onSaved, onFinished }: {
  settings: DesktopSettings;
  onSaved: (setting: ApplicationSetting) => void;
  onFinished: (agentId?: number, selection?: { provider: string; model: string | null }) => void;
}) {
  const row = (key: string) => settings.settings.find((item) => item.key === key);
  const [step, setStep] = useState(0);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState(String(row("LOCAL_WORKSPACE_ROOT")?.value ?? ""));
  const [tools, setTools] = useState(row("LOCAL_TOOLS_ENABLED")?.value === true);
  const [mode, setMode] = useState<ApprovalMode>("ask");
  const [createAgent, setCreateAgent] = useState<boolean | null>(null);
  const [agentName, setAgentName] = useState("Asistan");
  const [leadsTeam, setLeadsTeam] = useState(true);
  const [existing, setExisting] = useState<{ id: number; name: string; provider: string }[]>([]);
  const [leadPick, setLeadPick] = useState("");
  const [createdAgentId, setCreatedAgentId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engine = engines.find((item) => item.id === provider);
  const enginesChanged = useCallback((items: Engine[]) => {
    setEngines(items);
    setProvider((current) => firstReadyEngine(items, current) ?? current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.listAgents().then((agents) => {
      if (cancelled) return;
      setExisting(agents.filter((agent) => agent.provider === "claude").map((agent) => ({ id: agent.id, name: agent.name, provider: agent.provider })));
      setCreateAgent((previous) => previous ?? agents.length === 0);
    }).catch(() => { if (!cancelled) setError("Ajanlar yüklenemedi. Yeniden denemek için Ayarlar'ı yeniden yükleyin ya da kurulumu sonraya bırakın."); });
    return () => { cancelled = true; };
  }, []);

  const browse = async () => {
    setError(null); setBusy(true);
    try {
      if (!window.openDots) throw new Error("Klasör seçimi masaüstü uygulamasında kullanılabilir.");
      const selected = await window.openDots.choosePath("folder");
      if (selected !== null) setWorkspace(selected);
    } catch (err) { setError(err instanceof Error ? err.message : "Klasör seçilemedi."); }
    finally { setBusy(false); }
  };

  const complete = async (skip = false) => {
    setBusy(true); setError(null);
    let agentId = createdAgentId;
    try {
      if (!skip) {
        if (!engine?.available) throw new Error("Kullanılabilir bir motor seçin ya da kurulumu sonraya bırakın.");
        for (const [key, value] of [["LOCAL_WORKSPACE_ROOT", workspace.trim()], ["LOCAL_TOOLS_ENABLED", tools]] as const) {
          const current = row(key);
          if (!current) throw new Error("Bu sunucu kurulumu desteklemiyor. Sunucuyu güncelleyip yeniden deneyin.");
          if (value !== current.value) onSaved(await api.saveDesktopSetting(key, value, current.version));
        }
        if (createAgent) {
          const input = { name: agentName.trim(), instructions: "", provider, model: model?.trim() || null, approval_mode: mode };
          const saved = agentId === undefined ? await api.createAgent(input) : await api.updateAgent(agentId, input);
          agentId = saved.id;
          setCreatedAgentId(saved.id);
          if (leadsTeam && provider === "claude") await api.requestTeamLead(saved.id);
        } else if (leadPick) {
          await api.requestTeamLead(Number(leadPick));
        }
      }
      const completed = row("DESKTOP_ONBOARDING_COMPLETED");
      if (!completed) throw new Error("Bu sunucu kurulumu desteklemiyor. Sunucuyu güncelleyip yeniden deneyin.");
      if (completed.value !== true) onSaved(await api.saveDesktopSetting(completed.key, true, completed.version));
      onFinished(skip ? undefined : agentId, skip ? undefined : { provider, model: model?.trim() || null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Kurulum tamamlanamadı. Kaydedilen değişiklikleriniz korunuyor; devam etmek için yeniden deneyin.");
    } finally { setBusy(false); }
  };

  return <section aria-label="İlk kurulum" className="space-y-5 rounded-xl border border-line p-5">
    <div><h2 className="text-xl font-semibold">Open Duet&apos;e hoş geldiniz</h2><p className="mt-2 text-sm text-muted">Ajanlarınızın bu bilgisayarda nasıl çalışacağını seçin. Bu seçimleri Ayarlar ve Ajanlar bölümlerinden değiştirebilirsiniz.</p></div>
    <ol className="flex flex-wrap gap-3 text-xs" aria-label="Kurulum ilerlemesi">{STEPS.map((name, index) => <li key={name} aria-current={index === step ? "step" : undefined} className={index === step ? "font-semibold" : "text-muted"}>{index + 1}. {name}</li>)}</ol>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {step === 0 && <div className="space-y-4">
      <p className="text-sm text-muted">{engine?.available ? `${engine.label} hazır. Çalışma klasörünü seçmek için devam edin.` : "Bir yapay zekâ bağlayın"}</p>
      {engine?.available && <details><summary className="cursor-pointer text-sm underline">Gelişmiş: motor ve model</summary><div className="mt-3"><EngineModelFields engines={engines} provider={provider} model={model} disabled={busy} onChange={(nextProvider, nextModel) => { setProvider(nextProvider); setModel(nextModel); }} /></div></details>}
      <EngineSettings onEnginesChanged={enginesChanged} />
      {!engines.length && <p role="status" className="text-sm text-muted">Kurulu motorlar kontrol ediliyor…</p>}
    </div>}
    {step === 1 && <div className="space-y-3">
      <label className="block text-sm">Varsayılan çalışma klasörü kökü<input aria-label="Kurulum çalışma klasörü kökü" className={FIELD} value={workspace} onChange={(event) => setWorkspace(event.target.value)} disabled={busy} placeholder="Uygulamanın kendi çalışma klasörünü kullan" autoComplete="off" spellCheck={false} /></label>
      <button type="button" className={BUTTON} disabled={busy} onClick={() => void browse()}>Klasör seç</button>
      <p className="break-all text-xs text-muted">Uygulama varsayılanı: {String(row("LOCAL_WORKSPACE_ROOT")?.default ?? "")}</p>
      <p className="text-sm text-muted">Yeni ajanlar burada kendi alt klasörlerini alır. Doğrudan mevcut bir projede çalışmak için o ajanın çalışma klasörünü Ajanlar bölümünde ayarlayın.</p>
    </div>}
    {step === 2 && <div className="space-y-4">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={tools} disabled={busy} onChange={(event) => setTools(event.target.checked)} />Bu bilgisayarda araçlara izin ver</label>
      <p className="text-xs text-muted">Kapalıyken yerel CLI&apos;lar yalnız okuma yapar. API uç noktaları yalnız sohbet içindir. Araç kullanabilen motorlar kendi izinlerini ve uygulamanın onay kartlarını kullanır.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={createAgent === true} disabled={busy || createAgent === null} onChange={(event) => setCreateAgent(event.target.checked)} />Seçili motorla bir başlangıç ajanı oluştur</label>
      {createAgent && provider === "claude" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={leadsTeam} disabled={busy} onChange={(event) => setLeadsTeam(event.target.checked)} />Takıma liderlik eder: takım onay ayarlarıyla uzman oluşturabilir ve görev verebilir</label>}
      {createAgent === false && existing.length > 0 && <label className="block text-sm">Takım lideri (isteğe bağlı)<select aria-label="Takım lideri" className={FIELD} value={leadPick} disabled={busy} onChange={(event) => setLeadPick(event.target.value)}><option value="">Henüz lider yok</option>{existing.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><span className="mt-1 block text-xs text-muted">Lider uzman ekleyebilir ve onlara iş verebilir. Bunu daha sonra Takım bölümünden değiştirebilirsiniz.</span></label>}
      {createAgent && <label className="block text-sm">Ajan adı<input aria-label="Başlangıç ajanının adı" className={FIELD} maxLength={80} value={agentName} disabled={busy} onChange={(event) => setAgentName(event.target.value)} /></label>}
      <fieldset className="space-y-2" disabled={busy || !createAgent}><legend className="mb-2 text-sm font-medium">Başlangıç ajanının onay modu</legend>{APPROVAL_MODES.map((option) => <label key={option.value} className="flex items-start gap-2 text-sm"><input type="radio" name="setup-approval" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} /><span>{option.label}<span className="mt-1 block text-xs text-muted">{option.description}</span></span></label>)}</fieldset>
      {!createAgent && <p className="text-xs text-muted">Mevcut ajanlarınız onay modlarını korur. Bunları Ajanlar bölümünde değiştirin.</p>}
    </div>}
    {step === 3 && <div className="space-y-3 text-sm"><h3 className="font-semibold">Başlamaya hazır</h3><p>{engine?.label ?? provider} · {modelLabel(model)}</p><p className="break-all">Çalışma klasörü kökü: {workspace.trim() || "Uygulama varsayılanı"}</p><p>Yerel araçlar: {tools ? "açık" : "kapalı"}</p><p>{createAgent ? `${agentName.trim()} oluşturulacak; onay modu: ${APPROVAL_MODES.find((item) => item.value === mode)?.label}.` : "Mevcut ajanlarınızı kullanın ya da düz bir sohbet başlatın."}</p></div>}
    <div className="flex flex-wrap gap-2">
      {step > 0 && <button type="button" className={BUTTON} disabled={busy} onClick={() => { setError(null); setStep((value) => value - 1); }}>Geri</button>}
      {step < STEPS.length - 1 ? <button type="button" className={BUTTON} disabled={busy || createAgent === null || (step === 0 && !engine?.available) || (step === 2 && createAgent === true && !agentName.trim())} onClick={() => { setError(null); setStep((value) => value + 1); }}>Devam</button> : <button type="button" className={BUTTON} disabled={busy} onClick={() => void complete()}>{busy ? "Kaydediliyor…" : "Sohbete başla"}</button>}
      <button type="button" className={`${BUTTON} ml-auto`} disabled={busy} onClick={() => void complete(true)}>Sonra kur</button>
    </div>
  </section>;
}
