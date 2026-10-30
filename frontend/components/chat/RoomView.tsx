"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, type Agent } from "@/lib/api";
import { collaboration, type Room, type RoomMessage, type SharedApproval as Approval } from "@/lib/collaboration";
import { mentionToken, queueText, roomMemberName } from "@/lib/rooms";
import { useSession } from "@/components/AuthGate";
import { Dialog } from "@/components/ui/Dialog";
import { RoomSettings } from "./RoomSettings";
import { SharedApproval } from "./SharedApproval";
import { Markdown } from "./Markdown";

const BUTTON = "rounded-field border border-line px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50";

export function RoomView({ roomId, agents, onClose, onSelect }: { roomId: number | "new"; agents: Agent[]; onClose: () => void; onSelect: (id: number) => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { session } = useSession();
  const admin = session?.scopes.includes("admin") === true;
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const refresh = useCallback(async () => {
    if (roomId === "new") return;
    const [saved, history, waiting] = await Promise.all([collaboration.room(roomId), collaboration.messages(roomId), collaboration.roomApprovals(roomId)]);
    setRoom(saved); setMessages(history); setApprovals(waiting);
    const seen = history.at(-1)?.seq;
    if (seen && saved.unread > 0 && !document.hidden) await collaboration.readRoom(saved.id, seen);
  }, [roomId]);
  useEffect(() => {
    let stopped = false;
    const load = () => { if (!document.hidden) void refresh().catch(err => { if (!stopped) setError(err instanceof ApiError ? err.message : "Bu oda yüklenemedi."); }); };
    load(); const timer = setInterval(load, 2000); document.addEventListener("visibilitychange", load);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [refresh]);
  useEffect(() => { if (following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [messages.length, approvals.length]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await refresh(); } catch (err) { setError(err instanceof ApiError ? err.message : "Oda güncellenemedi."); } finally { setBusy(false); }
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault(); if (!room || !draft.trim() || busy) return;
    const text = draft; setBusy(true); setError(null);
    try { await collaboration.postMessage(room.id, text); setDraft(""); following.current = true; await refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Gönderilemedi. Mesajınız burada saklanıyor."); }
    finally { setBusy(false); }
  };
  const exportRoom = async (format: "md" | "json") => {
    if (!room) return;
    setBusy(true); setError(null);
    try { const url = await api.roomExportUrl(room.id, format); const link = document.createElement("a"); link.href = url; link.download = `room-${room.id}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Oda dışa aktarılamadı."); } finally { setBusy(false); }
  };
  return <Dialog open title={roomId === "new" ? "Yeni oda" : room?.name ?? "Oda"} description="Üyeler bir sohbeti paylaşır ve sırayla yanıt verir. Araçları yine onayınızı gerektirir." size="lg" onOpenChange={open => { if (!open) onClose(); }}>
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {(roomId === "new" || editing) ? admin ? <RoomSettings key={roomId} room={room ?? undefined} agents={agents} onSaved={saved => { setEditing(false); setRoom(saved); onSelect(saved.id); void refresh(); }} onCancel={() => { if (roomId === "new") onClose(); else setEditing(false); }} /> : <p className="text-sm text-muted">Odaları tam erişimli bir cihaz oluşturup yönetebilir.</p> : room ? <>
        <div className="flex flex-wrap gap-2">{admin && <button type="button" className={BUTTON} disabled={busy} onClick={() => setEditing(true)}>Oda ayarları</button>}<button type="button" className={BUTTON} disabled={busy} onClick={() => void act(() => collaboration.stopRoom(room.id))}>Odayı durdur</button>{admin && <><button type="button" className={BUTTON} disabled={busy} onClick={() => void exportRoom("md")}>Markdown olarak dışa aktar</button><button type="button" className={BUTTON} disabled={busy} onClick={() => void exportRoom("json")}>JSON olarak dışa aktar</button><button type="button" className={BUTTON} disabled={busy} onClick={() => setConfirmDelete(true)}>Odayı sil</button></>}</div>
        {confirmDelete && <div className="rounded-field border border-danger/50 p-3 text-sm"><p>Bu oda ve ortak geçmişi silinsin mi?</p><div className="mt-2 flex gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={() => void act(async () => { await collaboration.deleteRoom(room.id); onClose(); })}>Odayı kalıcı olarak sil</button><button type="button" className={BUTTON} onClick={() => setConfirmDelete(false)}>Odayı koru</button></div></div>}
        {room.bulletin && <details><summary className="cursor-pointer text-xs text-muted">Ortak talimatlar</summary><p className="mt-2 whitespace-pre-wrap text-sm">{room.bulletin}</p></details>}
        <ul aria-label="Oda üyeleri" className="flex flex-wrap gap-2">{room.members.map(member => <li key={member.agent_id} className="flex flex-wrap items-center gap-2 rounded-field border border-line p-2 text-xs"><strong>{member.name}</strong>{member.held && <span className="text-warning">Bekletiliyor</span>}{admin && <button type="button" className="underline" disabled={busy} onClick={() => void act(() => collaboration.holdMember(room.id, member.agent_id, !member.held))}>{member.held ? "Sürdür" : "Beklet"}</button>}<button type="button" className="underline" disabled={busy} onClick={() => void act(() => collaboration.stopRoom(room.id, member.agent_id))}>Durdur</button>{member.member_thread_id && <Link className="underline" href={`/chat?thread=${member.member_thread_id}`}>İşi gör</Link>}</li>)}</ul>
        {queueText(room.members, room.dispatches) && <p role="status" className="rounded-field bg-inset p-2 text-xs text-muted">{queueText(room.members, room.dispatches)}</p>}
        <div ref={scroller} onScroll={() => { const element = scroller.current; if (element) following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }} className="max-h-[45dvh] space-y-4 overflow-y-auto rounded-field border border-line p-3" aria-label="Oda sohbeti" tabIndex={0}>
          {messages.length === 0 && <p className="text-sm text-muted">Sohbeti başlatın. Bir üyenin yanıt vermesini istemek için onu etiketleyin.</p>}
          {messages.map(message => <article key={message.seq} className="min-w-0 space-y-1"><p className="text-xs font-semibold text-muted">{message.author?.label ?? (message.author?.agent_id ? roomMemberName(room.members, message.author?.agent_id) : message.author?.kind === "person" ? "Siz" : "Oda")} <time className="ml-1 font-normal" dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</time></p><div className="break-words text-sm"><Markdown text={message.text} /></div>{message.source?.thread_id && <Link className="text-xs underline" href={`/chat?thread=${message.source.thread_id}`}>İşi gör</Link>}</article>)}
          {approvals.filter(item => item.status === "pending").map(approval => <SharedApproval key={approval.id} approval={approval} onChanged={() => void refresh()} />)}
        </div>
        {room.dispatches.filter(item => ["failed", "stopped"].includes(item.status)).map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 text-xs text-warning"><span>{roomMemberName(room.members, item.agent_id)}: {item.status === "failed" ? "başarısız" : "durduruldu"}{item.error_code ? ` (${item.error_code})` : ""}</span>{admin && <button type="button" className="underline" disabled={busy} onClick={() => void act(() => collaboration.retryDispatch(room.id, item.id))}>Yeniden dene</button>}</div>)}
        <form onSubmit={send} className="space-y-2"><label className="block text-sm">Odaya mesaj yaz<textarea required maxLength={100000} rows={3} className="mt-1 w-full resize-y rounded-field border border-line bg-raised p-3 text-sm" value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} placeholder="Bir mesaj yazın ya da bir üyeyi etiketleyin…" /></label><div className="flex flex-wrap gap-2"><select aria-label="Bir üyeyi an" className={BUTTON} value="" disabled={busy} onChange={event => { if (event.target.value) setDraft(previous => `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${event.target.value}`); }}><option value="">Üye an…</option><option value="@everyone ">@everyone</option>{room.members.map(member => <option key={member.agent_id} value={mentionToken(member.name)}>{member.name}</option>)}</select><button className={BUTTON} type="submit" disabled={busy || !draft.trim()}>{busy ? "Gönderiliyor…" : "Mesajı gönder"}</button></div></form>
      </> : !error && <p role="status" className="text-sm text-muted">Oda yükleniyor…</p>}
    </div>
  </Dialog>;
}
