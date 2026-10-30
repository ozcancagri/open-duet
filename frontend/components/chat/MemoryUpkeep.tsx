"use client";

// Memory upkeep for one agent (switch, tidy up now, the hour, the helper model,
// learning from group chats) and the About me text every agent reads
// (docs/MEMORY.md). Shown inside the memory panel under an agent's notes.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AboutMe, type Agent, type Engine, type MemorySettings, type MemoryUpkeepStatus } from "@/lib/api";
import { tidyLine } from "@/lib/agents";
import { captureLine, helperChange, helperModelLine, tidyHourLabel, withHelperModel } from "@/lib/memory";

const FIELD =
  "w-full rounded-md border border-line bg-transparent px-3 py-1.5 text-sm placeholder:text-muted";
const SMALL =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_SMALL =
  "cursor-pointer rounded-md px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 bg-accent text-accent-fg hover:opacity-90";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function UpkeepCard({
  agent,
  onAgentChange,
  onError,
  onNotesChanged,
}: {
  agent: Agent;
  onAgentChange: (patch: Partial<Agent>) => void;
  onError: (e: string | null) => void;
  onNotesChanged: () => void;
}) {
  const notesOn = agent.memory_enabled ?? true;
  const upkeepOn = agent.memory_upkeep ?? true;
  const summaryOn = agent.compaction_summary ?? true;
  const helperAllowed = agent.use_helper ?? true;
  const [status, setStatus] = useState<MemoryUpkeepStatus | null>(null);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [model, setModel] = useState("");
  const [engines, setEngines] = useState<Engine[]>([]);
  const [helperEngine, setHelperEngine] = useState("");
  const [helperName, setHelperName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextSettings] = await Promise.all([api.memoryUpkeep(agent.id), api.memorySettings()]);
      setStatus(nextStatus);
      setSettings(nextSettings);
      setModel(nextSettings.helper_models[nextStatus.engine ?? agent.provider] ?? "");
      setHelperEngine(nextSettings.helper?.engine ?? "");
      setHelperName(nextSettings.helper?.model ?? "");
    } catch (err) {
      onError(errorText(err));
    }
  }, [agent.id, agent.provider, onError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, upkeepOn]);

  useEffect(() => {
    api.getEngines().then(setEngines).catch(() => setEngines([]));
  }, []);

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    onError(null);
    try {
      await work();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleSummary = () =>
    guard(async () => {
      await api.updateAgent(agent.id, { compaction_summary: !summaryOn });
      onAgentChange({ compaction_summary: !summaryOn });
    });

  const toggleHelper = () =>
    guard(async () => {
      await api.updateAgent(agent.id, { use_helper: !helperAllowed });
      onAgentChange({ use_helper: !helperAllowed });
      await load();
    });

  const toggleUpkeep = () =>
    guard(async () => {
      await api.updateAgent(agent.id, { memory_upkeep: !upkeepOn });
      onAgentChange({ memory_upkeep: !upkeepOn });
    });

  const tidyNow = () =>
    guard(async () => {
      const report = await api.tidyAgentMemory(agent.id);
      setResult(tidyLine(report));
      onNotesChanged();
      await load();
    });

  const change = (patch: Partial<MemorySettings>) =>
    guard(async () => {
      setSettings(await api.saveMemorySettings(patch));
      await load();
    });

  const engine = status?.engine ?? agent.provider;
  const savedModel = settings?.helper_models[engine] ?? "";
  const tidied = status?.last_tidy;
  const noticed = captureLine(status?.last_capture);
  const active = notesOn && upkeepOn;
  return (
    <div className="space-y-2 rounded-md border border-line p-3 text-xs" aria-label="Bellek bakımı">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          role="switch"
          checked={upkeepOn}
          disabled={busy || !notesOn}
          onChange={() => void toggleUpkeep()}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Bellek bakımı</span>
          <span className="block text-xs text-muted">
            Sohbet sessizleşince bilgileri fark eder ve notları her gece bir kez düzenler; bunu bu ajanın kendi
            motoruna yapılan kısa çağrılarla yapar. Her değişiklik Geçmiş&apos;te görünür ve geri alınabilir.
            {!notesOn && " Önce notları açın."}
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          role="switch"
          checked={summaryOn}
          disabled={busy}
          onChange={() => void toggleSummary()}
          className="mt-0.5"
          aria-label="Uzun sohbetleri bir modelle özetle"
        />
        <span>
          <span className="font-medium">Uzun sohbetleri bir modelle özetle</span>
          <span className="block text-muted">
            Sohbet, onu baştan yeniden gönderen bir motora (OpenAI uyumlu bir uç nokta) sığmayacak kadar uzarsa önceki
            kısım, gizli bilgiler önce çıkarılarak aynı motorla özetlenir; çağrı başarısız olur ya da 20 saniyeyi
            aşarsa bunun yerine alıntılar kullanılır. Kapalı: her zaman alıntılar.
          </span>
        </span>
      </label>
      {active && (
        <>
          {noticed && <p className="text-muted">{noticed}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void tidyNow()} disabled={busy} className={SMALL}>
              {busy ? "Çalışıyor…" : "Şimdi düzenle"}
            </button>
            <span className="text-muted">
              {tidied
                ? `Son düzenleme ${new Date(tidied.at * 1000).toLocaleString()}: ${tidyLine(tidied)}`
                : "Henüz düzenlenmedi."}
            </span>
          </div>
          {result && <p role="status">{result}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`tidy-hour-${agent.id}`}>Her gece şu saatten sonra düzenle</label>
            <select
              id={`tidy-hour-${agent.id}`}
              value={settings?.tidy_hour ?? status?.tidy_hour ?? 3}
              disabled={busy || !settings}
              onChange={(e) => void change({ tidy_hour: Number(e.target.value) })}
              className="rounded-md border border-line bg-transparent px-2 py-1"
            >
              {Array.from({ length: 25 }, (_, h) => (
                <option key={h} value={h}>
                  {tidyHourLabel(h)}
                </option>
              ))}
            </select>
            <span className="text-muted">Tüm ajanlar için geçerlidir; ajan çalışırken asla yapılmaz.</span>
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`helper-model-${agent.id}`}>{engine} için yardımcı model</label>
              <input
                id={`helper-model-${agent.id}`}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="ajanın kendi modeli"
                className={`${FIELD} max-w-56`}
              />
              <button
                onClick={() => settings && void change({ helper_models: withHelperModel(settings.helper_models, engine, model) })}
                disabled={busy || !settings || model.trim() === savedModel}
                className={SMALL}
              >
                Modeli kaydet
              </button>
            </div>
            <p className="text-muted">
              {helperModelLine(status, helperAllowed)}
              {status?.engine_can_call &&
                " Daha küçük bir model yeterlidir. Bu model, ajanın zaten kullandığı motorda çalışır; başka bir sağlayıcıya hiçbir şey gitmez."}
            </p>
          </div>
          <div className="space-y-1 rounded-md border border-line p-2">
            <p className="font-medium">Başka bir sağlayıcıda yardımcı (siz ayarlamadıkça kapalı)</p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`helper-engine-${agent.id}`}>Motor</label>
              <select
                id={`helper-engine-${agent.id}`}
                value={helperEngine}
                disabled={busy || !settings || settings.helper_active?.source === "environment"}
                onChange={(e) => setHelperEngine(e.target.value)}
                className="rounded-md border border-line bg-transparent px-2 py-1"
              >
                <option value="">Yok (ajanın sağlayıcısından dışarı hiçbir şey çıkmaz)</option>
                {engines
                  .filter((e) => e.can_write_text)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
              </select>
              <label htmlFor={`helper-engine-model-${agent.id}`}>Model</label>
              <input
                id={`helper-engine-model-${agent.id}`}
                value={helperName}
                onChange={(e) => setHelperName(e.target.value)}
                placeholder="varsayılan modeli"
                disabled={!helperEngine || settings?.helper_active?.source === "environment"}
                className={`${FIELD} max-w-48`}
              />
              <button
                onClick={() => void change(helperChange(helperEngine, helperName))}
                disabled={
                  busy ||
                  !settings ||
                  settings.helper_active?.source === "environment" ||
                  (helperEngine === (settings.helper?.engine ?? "") && helperName.trim() === (settings.helper?.model ?? ""))
                }
                className={SMALL}
              >
                Yardımcıyı kaydet
              </button>
            </div>
            {settings?.helper_active?.source === "environment" && (
              <p className="text-muted">Sunucunun ortam ayarlarıyla belirlenmiş ({settings.helper_active.engine}); oradan değiştirin.</p>
            )}
            <p className="text-muted">
              Yalnız kendi motoru bu işi yazamayan ajanlar (Codex ve ACP ajanları) için kullanılır: uzun bir sohbetin
              özeti ve bellek bakımı adımları. Motoru bunu yazabilen bir ajan her zaman kendisi yazar. Bir yardımcı
              ayarlıysa <strong>okunan sohbetler, notlar (gizli bilgiler önce çıkarılarak) ve özetlenen geçmiş
              yardımcının sağlayıcısına gönderilir</strong>; bu sağlayıcı bu ajanınkinden farklı olabilir. Her çağrı
              Kullanım altında listelenir.
            </p>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                role="switch"
                checked={helperAllowed}
                disabled={busy}
                onChange={() => void toggleHelper()}
                className="mt-0.5"
                aria-label="Bu ajan için yardımcı modele izin ver"
              />
              <span>
                <span className="font-medium">Bu ajan için yardımcı modele izin ver</span>
                <span className="block text-muted">
                  Kapalı: yukarıda ne ayarlarsanız ayarlayın, yardımcı bu ajanın metinlerini asla yazmaz. Bu yalnız bu
                  ajanın kendi işlerini kapsar; ajanın bir odada söyledikleri diğer ajanların sohbetlerinin parçası olur.
                </span>
              </span>
            </label>
          </div>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              role="switch"
              checked={settings?.learn_from_rooms ?? false}
              disabled={busy || !settings}
              onChange={() => settings && void change({ learn_from_rooms: !settings.learn_from_rooms })}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Grup sohbetlerinden öğren</span>
              <span className="block text-muted">
                Varsayılan olarak tüm ajanlar için kapalıdır. Açıkken bir ajanın bir odada okuduğu ve yanıtladığı
                şeyler de fark edilebilir: sizin satırlarınız size ait sayılır; başka bir kişinin satırlarından yalnız
                ortak işle ilgili bilgiler alınır ve bunlar asla Hakkımda&apos;ya girmez; başka bir ajanın satırlarından
                yalnız onun doğruladığı bir sonuç ya da sizin onayladığınız bir karar alınır. Kayıtlar odayla işaretlenir.
              </span>
            </span>
          </label>
        </>
      )}
    </div>
  );
}

export function AboutMeTab({ onError }: { onError: (e: string | null) => void }) {
  const [about, setAbout] = useState<AboutMe | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ current: string; hash: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.aboutMe();
      setAbout(next);
      setText(next.text);
    } catch (err) {
      onError(errorText(err));
    }
  }, [onError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async (overwrite = false) => {
    if (!about) return;
    setBusy(true);
    onError(null);
    try {
      const next = await api.saveAboutMe(text, overwrite ? null : about.hash);
      setAbout(next);
      setText(next.text);
      setConflict(null);
      setSaved(next.redacted ? `Kaydedildi. Gizli bilgiye benzeyen ${next.redacted} öğe değiştirildi.` : "Kaydedildi.");
    } catch (err) {
      if (err instanceof ApiError && err.code === "memory_changed") {
        const current = await api.aboutMe();
        setConflict({ current: current.text, hash: current.hash });
      } else onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    onError(null);
    try {
      const next = await api.removeLearnedFact(id);
      if (about && text === about.text) setText(next.text);
      setAbout(next);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (about === null) return <p className="text-xs text-muted">Yükleniyor…</p>;
  const dirty = text !== about.text;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Tüm ajanlarınızın sizin hakkınızda bilmesini istedikleriniz. Notları kapalı olanlar dahil tüm ajanlarınız bunu
        okur. Ajanlar, onlara kendinizle ilgili kalıcı bir şey söylediğinizde bir satır ekler (başka bir kişinin
        sözlerinden ya da bir ajanın söylediklerinden asla eklemez); bu bir talimat değil, arka plan bilgisidir.
      </p>
      <textarea
        value={text}
        rows={6}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(null);
        }}
        aria-label="Hakkımda"
        placeholder={"- Ankara'da yaşıyorum\n- Kısa yanıtları severim"}
        className={`${FIELD} resize-y font-mono`}
      />
      <p className="text-xs text-muted">
        {text.length.toLocaleString()} / {about.max_chars.toLocaleString()} karakter
      </p>
      {conflict && (
        <div role="alert" className="rounded-md border border-warning/60 p-3 text-xs">
          <p>Siz düzenlerken bir ajan Hakkımda&apos;ya ekleme yaptı. Yeni metni yükleyin ya da kendi metninizi koruyup onun üzerine yazın.</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                setAbout({ ...about, text: conflict.current, hash: conflict.hash });
                setText(conflict.current);
                setConflict(null);
              }}
              disabled={busy}
              className={SMALL}
            >
              Yeni metni yükle
            </button>
            <button onClick={() => void save(true)} disabled={busy} className={SMALL}>
              Benimkiyle üzerine yaz
            </button>
          </div>
        </div>
      )}
      {saved && <p className="text-xs text-muted">{saved}</p>}
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={busy || !dirty} className={PRIMARY_SMALL}>
          {busy ? "Kaydediliyor…" : "Hakkımda'yı kaydet"}
        </button>
        {dirty && (
          <button onClick={() => setText(about.text)} disabled={busy} className={SMALL}>
            Vazgeç
          </button>
        )}
      </div>
      <div className="space-y-1 border-t border-line pt-2">
        <p className="text-xs font-medium">Ajanlarınızın ekledikleri</p>
        {about.learned.length === 0 ? (
          <p className="text-xs text-muted">Henüz bir şey yok.</p>
        ) : (
          <ul className="space-y-1">
            {about.learned.map((fact) => (
              <li key={fact.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span>{fact.text}</span>
                <span className="text-muted">
                  öğrenen: {fact.agent_name || "bir ajan"} · {new Date(fact.at * 1000).toLocaleDateString()}
                </span>
                <button onClick={() => void remove(fact.id)} disabled={busy} className={SMALL}>
                  Kaldır
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Kaldırılan bir bilgi bir daha eklenmez.</p>
      </div>
    </div>
  );
}
