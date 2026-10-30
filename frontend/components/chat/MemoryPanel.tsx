"use client";

// Below an agent's MEMORY.md editor: its topic notes, the notes proposed from
// quiet conversations, and the history of changes with Undo (docs/MEMORY.md).
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Agent, type MemoryJournalRow, type MemoryProposal, type TopicDoc, type TopicList } from "@/lib/api";
import { journalLabel, topicFileName } from "@/lib/memory";
import { AboutMeTab, UpkeepCard } from "./MemoryUpkeep";

const FIELD =
  "w-full rounded-md border border-line bg-transparent px-3 py-1.5 text-sm placeholder:text-muted";
const SMALL =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_SMALL =
  "cursor-pointer rounded-md px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 bg-accent text-accent-fg hover:opacity-90";

type Tab = "topics" | "proposed" | "about" | "history";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function MemoryPanel({
  agent,
  onAgentChange,
  onNotesChanged,
}: {
  agent: Agent;
  onAgentChange: (patch: Partial<Agent>) => void;
  onNotesChanged: () => void;
}) {
  const agentId = agent.id;
  const [tab, setTab] = useState<Tab>("topics");
  const [proposed, setProposed] = useState<MemoryProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProposed = useCallback(async () => {
    try {
      setProposed(await api.memoryProposals(agentId));
    } catch (err) {
      setError(errorText(err));
    }
  }, [agentId]);

  useEffect(() => {
    // Reading the queue also reads any conversation that went quiet since.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProposed();
  }, [loadProposed]);

  const tabs: [Tab, string][] = [
    ["topics", "Konu notları"],
    ["proposed", `Önerilenler${proposed && proposed.length ? ` (${proposed.length})` : ""}`],
    ["about", "Hakkımda"],
    ["history", "Geçmiş"],
  ];
  return (
    <section className="space-y-3 border-t border-line pt-3" aria-label="Diğer bellek ayarları">
      <UpkeepCard agent={agent} onAgentChange={onAgentChange} onError={setError} onNotesChanged={onNotesChanged} />
      <div role="tablist" className="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`${SMALL} ${tab === id ? "bg-inset" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {tab === "topics" && <Topics agentId={agentId} onError={setError} />}
      {tab === "proposed" && (
        <Proposed
          agentId={agentId}
          items={proposed}
          onError={setError}
          onDone={() => {
            void loadProposed();
            onNotesChanged();
          }}
        />
      )}
      {tab === "about" && <AboutMeTab onError={setError} />}
      {tab === "history" && <History agentId={agentId} onError={setError} onUndone={onNotesChanged} />}
    </section>
  );
}

type Open = { doc: TopicDoc; text: string; conflict: boolean; saved: string | null };

function Topics({ agentId, onError }: { agentId: number; onError: (e: string | null) => void }) {
  const [list, setList] = useState<TopicList | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setList(await api.listTopics(agentId));
    } catch (err) {
      onError(errorText(err));
    }
  }, [agentId, onError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const openTopic = async (name: string) => {
    onError(null);
    try {
      const doc = await api.getTopic(agentId, name);
      setOpen({ doc, text: doc.text, conflict: false, saved: null });
    } catch (err) {
      onError(errorText(err));
    }
  };

  const create = async () => {
    const name = topicFileName(newName);
    if (!name) {
      onError("Konuya harf ya da rakam içeren bir ad verin, örneğin seyahat.");
      return;
    }
    setNewName("");
    await openTopic(name);
  };

  const save = async (overwrite = false) => {
    if (!open) return;
    setBusy(true);
    onError(null);
    try {
      const doc = await api.saveTopic(agentId, open.doc.name, open.text, overwrite ? null : open.doc.hash);
      const saved = doc.redacted > 0 ? `Kaydedildi. Gizli bilgiye benzeyen ${doc.redacted} öğe değiştirildi.` : "Kaydedildi.";
      setOpen({ doc, text: doc.text, conflict: false, saved });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "memory_changed") setOpen({ ...open, conflict: true, saved: null });
      else onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await api.deleteTopic(agentId, open.doc.name);
      setOpen(null);
      await refresh();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    const dirty = open.text !== open.doc.text;
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">
          <span className="font-mono">memory/{open.doc.name}</span>
          {open.doc.exists ? "" : " (yeni)"} · bütünüyle yüklenmez: ajan gerektiğinde okur, eşleşen bölümler de bir
          mesajın önüne hatırlatılır. Konu için başka sözcükler vermek üzere ön bilgiyle (<span className="font-mono">title:</span>,{" "}
          <span className="font-mono">aliases:</span>) başlayın.
        </p>
        <textarea
          value={open.text}
          rows={10}
          onChange={(e) => setOpen({ ...open, text: e.target.value, saved: null })}
          aria-label={`Konu notu ${open.doc.name}`}
          placeholder={"---\ntitle: Seyahat\naliases: [geziler, uçuşlar]\n---\n- Koridor koltuğunu tercih eder"}
          className={`${FIELD} resize-y font-mono`}
        />
        {open.conflict && (
          <div role="alert" className="rounded-md border border-warning/60 p-3 text-xs">
            <p>Siz düzenlerken ajan bu notu değiştirdi. Ajanın sürümünü yükleyin ya da kendi metninizi koruyup onun üzerine yazın.</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => openTopic(open.doc.name)} disabled={busy} className={SMALL}>
                Ajanın sürümünü yükle
              </button>
              <button onClick={() => save(true)} disabled={busy} className={SMALL}>
                Benimkiyle üzerine yaz
              </button>
            </div>
          </div>
        )}
        {open.saved && <p className="text-xs text-muted">{open.saved}</p>}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => save(false)} disabled={busy || !dirty} className={PRIMARY_SMALL}>
            {busy ? "Kaydediliyor…" : "Konuyu kaydet"}
          </button>
          <button onClick={() => setOpen(null)} disabled={busy} className={SMALL}>
            {dirty ? "Vazgeç" : "Konulara dön"}
          </button>
          {open.doc.exists && (
            <button onClick={remove} disabled={busy} className={SMALL}>
              Sil (Geçmiş&apos;ten geri getirilebilir)
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Her biri tek bir konuyu anlatan daha uzun notlar; konumu:{" "}
        <span className="font-mono break-all">{list?.folder ?? "memory/"}</span>. Her sohbete yalnız adları yüklenir;
        bir mesajla eşleşen bölümler o mesajın önüne hatırlatılır.
      </p>
      {list === null ? (
        <p className="text-xs text-muted">Yükleniyor…</p>
      ) : list.topics.length === 0 ? (
        <p className="text-xs text-muted">Henüz konu notu yok.</p>
      ) : (
        <ul className="space-y-1">
          {list.topics.map((t) => (
            <li key={t.name}>
              <button onClick={() => openTopic(t.name)} className="text-left text-sm hover:underline">
                <span className="font-mono">{t.name}</span>
                {t.title && <span className="text-muted"> — {t.title}</span>}
                <span className="text-xs text-muted"> · {Math.max(1, Math.round(t.bytes / 1024))} KB</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="Yeni konu, ör. seyahat"
          aria-label="Yeni konu adı"
          className={FIELD}
        />
        <button onClick={create} disabled={!newName.trim()} className={SMALL}>
          Yeni konu
        </button>
      </div>
    </div>
  );
}

function Proposed({
  agentId,
  items,
  onError,
  onDone,
}: {
  agentId: number;
  items: MemoryProposal[] | null;
  onError: (e: string | null) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (p: MemoryProposal, accept: boolean) => {
    setBusy(p.id);
    onError(null);
    try {
      if (accept) await api.acceptProposal(agentId, p.id);
      else await api.rejectProposal(agentId, p.id);
      onDone();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  if (items === null) return <p className="text-xs text-muted">Yükleniyor…</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Bir sohbet iki dakika sessiz kaldıktan sonra kendi mesajlarınızdan seçilen satırlar. Siz kabul edene kadar
        hiçbir şey kaydedilmez; reddedilen bir satır bir daha önerilmez.
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted">Şu anda öneri yok.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id} className="rounded-md border border-line p-2 text-sm">
              <p className="font-mono text-xs break-words">{p.line}</p>
              <p className="mt-1 text-xs text-muted">
                Kaynak: “{p.thread_title || "bir sohbet"}” · gideceği yer: {p.target}
              </p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => decide(p, true)} disabled={busy !== null} className={PRIMARY_SMALL}>
                  Kabul et
                </button>
                <button onClick={() => decide(p, false)} disabled={busy !== null} className={SMALL}>
                  Reddet
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function History({
  agentId,
  onError,
  onUndone,
}: {
  agentId: number;
  onError: (e: string | null) => void;
  onUndone: () => void;
}) {
  const [rows, setRows] = useState<MemoryJournalRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await api.memoryJournal(agentId));
    } catch (err) {
      onError(errorText(err));
    }
  }, [agentId, onError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const undo = async (row: MemoryJournalRow) => {
    setBusy(row.id);
    onError(null);
    try {
      await api.undoMemoryChange(agentId, row.id);
      await refresh();
      onUndone();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) return <p className="text-xs text-muted">Yükleniyor…</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Burada, kabul edilen önerilerle ve geri almayla yapılan değişiklikler. Geri al, dosyayı o değişiklikten önceki
        hâline döndürür. Ajanın kendi dosya araçlarıyla yaptığı düzenlemeler listelenmez.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">Henüz değişiklik yok.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span>{journalLabel(row)}</span>
                <span className="text-muted">{new Date(row.at).toLocaleString()}</span>
                {row.diff && (
                  <button onClick={() => setShown(shown === row.id ? null : row.id)} className="underline">
                    {shown === row.id ? "Gizle" : "Farkı göster"}
                  </button>
                )}
                {row.can_undo ? (
                  <button onClick={() => undo(row)} disabled={busy !== null} className={SMALL}>
                    {busy === row.id ? "Geri alınıyor…" : "Geri al"}
                  </button>
                ) : (
                  <span className="text-muted" title={row.reason ?? ""}>
                    geri alınamaz
                  </span>
                )}
              </div>
              {shown === row.id && (
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-inset p-2 font-mono">
                  {row.diff}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
