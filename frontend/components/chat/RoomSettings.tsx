"use client";

import { useState } from "react";
import { ApiError, type Agent } from "@/lib/api";
import { collaboration, type Room, type RoomInput } from "@/lib/collaboration";

const FIELD = "mt-1 w-full rounded-field border border-line bg-raised px-3 py-2 text-sm";
export function RoomSettings({ room, agents, onSaved, onCancel }: { room?: Room; agents: Agent[]; onSaved: (room: Room) => void; onCancel: () => void }) {
  const [name, setName] = useState(room?.name ?? "");
  const [bulletin, setBulletin] = useState(room?.bulletin ?? "");
  const [members, setMembers] = useState<number[]>(room?.members.map(member => member.agent_id) ?? []);
  const [expectedMembers] = useState(room?.members.map(member => member.agent_id) ?? []);
  const [kind, setKind] = useState<Room["default_responder_kind"]>(room?.default_responder_kind ?? "mentions");
  const [responder, setResponder] = useState<number | null>(room?.default_responder_agent_id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = [
    ...agents.filter(agent => !agent.archived_at || expectedMembers.includes(agent.id)),
    ...(room?.members ?? []).filter(member => !agents.some(agent => agent.id === member.agent_id))
      .map(member => ({ id: member.agent_id, name: member.name })),
  ];
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const input: RoomInput = { name: name.trim(), bulletin, member_ids: members, default_responder_kind: kind, default_responder_agent_id: kind === "member" ? responder : null };
      const saved = room ? await collaboration.saveRoom(room.id, { ...input, expected_member_ids: expectedMembers }) : await collaboration.createRoom(input);
      onSaved(saved);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Bu oda kaydedilemedi."); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
    <label className="block text-sm">Oda adı<input required maxLength={80} className={FIELD} value={name} onChange={event => setName(event.target.value)} /></label>
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm">Üyeler</legend>
      {choices.map(agent => <label key={agent.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={members.includes(agent.id)} onChange={event => setMembers(previous => event.target.checked ? [...previous, agent.id] : previous.filter(id => id !== agent.id))} />
        {agent.name}
      </label>)}
      <p className="text-xs text-muted">En fazla 12 ajan seçin. Sırayla tek tek yanıt verirler.</p>
      {room && <p className="text-xs text-muted">Kaldırma, sıradaki yanıtları atlar. Çalışan üyeleri durdurun ve kaldırmadan önce işlerini bitirmelerini bekleyin. Yeniden eklenen üyenin iş geçmişi korunur ve yeni oda mesajlarıyla başlar; eski yanıtlar asla kendiliğinden yeniden denenmez.</p>}
    </fieldset>
    <label className="block text-sm">Ortak talimatlar<textarea maxLength={12000} rows={4} className={FIELD} value={bulletin} onChange={event => setBulletin(event.target.value)} /><span className="mt-1 block text-xs text-muted">Odanın tüm üyeleri görür. Buraya kimlik bilgisi yazmayın.</span></label>
    <label className="block text-sm">Etiket olmadan kim yanıt verir?<select className={FIELD} value={kind} onChange={event => setKind(event.target.value as Room["default_responder_kind"])}><option value="mentions">Yalnız etiketlenen üyeler</option><option value="member">Bir üye</option><option value="everyone">Herkes</option></select></label>
    {kind === "member" && <label className="block text-sm">Varsayılan yanıtlayıcı<select required className={FIELD} value={responder ?? ""} onChange={event => setResponder(Number(event.target.value) || null)}><option value="">Bir üye seçin…</option>{agents.filter(agent => members.includes(agent.id)).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex gap-2"><button className="rounded-field border border-line px-3 py-2 text-sm hover:bg-hover" type="submit" disabled={!name.trim() || members.length === 0 || members.length > 12 || (kind === "member" && (!responder || !members.includes(responder)))}>{busy ? "Kaydediliyor…" : room ? "Odayı kaydet" : "Oda oluştur"}</button><button className="px-3 py-2 text-sm underline" type="button" onClick={onCancel}>İptal</button></div>
  </fieldset></form>;
}
