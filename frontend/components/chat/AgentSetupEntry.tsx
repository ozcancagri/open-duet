"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, type Agent, type Engine } from "@/lib/api";
import { collaboration, type TeamState } from "@/lib/collaboration";

export const SETUP_STARTER = "Bir ajan oluşturmak istiyorum. Amacını, beklenen çıktısını ve kısıtlarını belirlememe yardım et. Oluşturmadan önce yalnız gerekli soruları sor.";

export function AgentSetupEntry({ agents, engines, onStart, onCreateLead }: {
  agents: Agent[]; engines: Engine[]; onStart: (id: number) => void; onCreateLead: () => void;
}) {
  const [team, setTeam] = useState<TeamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("");
  useEffect(() => { let live = true; collaboration.team().then(value => { if (live) setTeam(value); }, () => { if (live) setError("Takımınız kontrol edilemedi. Yeniden denemek için Ajanlar'ı yeniden açın."); }); return () => { live = false; }; }, []);
  const lead = agents.find(agent => agent.id === team?.team?.lead_agent_id && !agent.archived_at);
  const engine = engines.find(item => item.id === lead?.provider);
  const ready = team?.enabled !== false && team?.lead_ready.ok && engine?.available;
  const choose = async () => {
    setBusy(true); setError(null);
    try { const updated = await collaboration.lead(Number(choice)); setTeam(updated); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Lider seçilemedi."); }
    finally { setBusy(false); }
  };
  return <section className="space-y-2 rounded-field border border-line p-3 text-sm" aria-label="Sohbet ederek oluştur">
    <strong>Sohbet ederek oluştur</strong>
    <p className="text-xs text-muted">İşi takım liderinize anlatın. Göndermeden önce başlangıç metnini gözden geçirin; sohbeti açmak ajan oluşturmaz.</p>
    {team?.enabled === false ? <p className="text-xs text-warning">Takım araçları kapalı. Ayarlarda Takımlar&apos;ı açın ya da elle doldurulan formu kullanın.</p> : lead ? <>
      {!ready && <p className="text-xs text-warning">{!engine?.available ? engine?.reason ?? "Liderin motoru kontrol ediliyor…" : team?.lead_ready.reason} <Link href="/settings/" className="underline">Motor ayarları</Link></p>}
      <button type="button" className="rounded-field border border-line px-3 py-1.5 disabled:opacity-50" disabled={!ready || busy} onClick={() => onStart(lead.id)}>{lead.name} ile sohbet et</button>
    </> : team && <>
      <p className="text-xs text-muted">Ajan oluşturmaya ve ajanları koordine etmeye yardım edecek bir takım lideri (genel koordinatör) seçin. Bu rol mevcut liderin yerini alır.</p>
      <select aria-label="Kurulum liderini seç" value={choice} disabled={busy} onChange={event => setChoice(event.target.value)} className="w-full rounded-field border border-line bg-raised p-2">
        <option value="">Mevcut bir ajan seçin…</option>
        {agents.filter(agent => !agent.archived_at && engines.some(item => item.id === agent.provider && item.capabilities.mcp && item.available)).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={!choice || busy} className="text-xs underline disabled:opacity-50" onClick={() => void choose()}>Seçili ajanı lider yap</button><button type="button" className="text-xs underline" onClick={onCreateLead}>Formda bir lider oluştur</button></div>
    </>}
    {!team && !error && <p role="status" className="text-xs text-muted">Takım kontrol ediliyor…</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}
