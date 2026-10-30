// Topic notes, recall chips, compaction markers, the journal and proposed
// notes (docs/MEMORY.md). Pure: no React, no network.
import type { CaptureReport, MemoryJournalRow, MemoryUpkeepStatus } from "./api";

// A topic is one file name: letters, digits, dashes and underscores, then ".md".
const TOPIC_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}\.md$/;

export function isTopicName(name: string): boolean {
  return TOPIC_NAME.test(name) && name.toLowerCase() !== "memory.md";
}

// What a person types ("Asha's school") as a topic file name ("asha-s-school.md");
// null when nothing usable is left.
export function topicFileName(raw: string): string | null {
  const base = raw
    .trim()
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 59)
    .replace(/-+$/, "");
  const name = `${base}.md`;
  return base && isTopicName(name) ? name : null;
}

export type RecalledNote = { name: string; title: string | null; snippet: string };
export type RecalledPassage = { thread_id: number; title: string | null; role: string; at: string | null; snippet: string };

// The chip's one line: what was put in front of the message.
export function recalledLabel(notes: number, conversations: number): string {
  const parts = [];
  if (notes) parts.push(`${notes} not`);
  if (conversations) parts.push(`önceki sohbetlerden ${conversations} bölüm`);
  return `Hatırlandı: ${parts.join(" ve ") || "hiçbir şey"}`;
}

// The marker's one line.
export function compactedLabel(folded: number, writtenBy?: string): string {
  const base =
    folded > 0
      ? `Önceki mesajlar özetlendi: ${folded} mesaj motor için bir özete katlandı. Sohbetin tamamı burada kalır.`
      : "Önceki mesajlar motor için özetlendi. Sohbetin tamamı burada kalır.";
  // A helper model wrote it: the conversation went to that engine, not the agent's own.
  return writtenBy ? `${base} Özeti yazan yardımcı model: ${writtenBy}.` : base;
}

const ACTORS: Record<string, string> = { person: "Siz", proposal: "Kabul edilen öneri", undo: "Geri alma", upkeep: "Bellek bakımı", agent: "Ajan", import: "İçe aktarılan ajan dosyası" };
const KINDS: Record<string, string> = { created: "oluşturuldu", edited: "düzenlendi", deleted: "silindi" };
const VIA: Record<string, string> = { tidy: "toparlama", organize: "düzenleme", capture: "fark etme" };

export function journalLabel(row: Pick<MemoryJournalRow, "actor" | "kind" | "path" | "added" | "removed"> & { via?: string | null }): string {
  const step = row.actor === "upkeep" && row.via && VIA[row.via] ? ` (${VIA[row.via]})` : "";
  const who = (ACTORS[row.actor] ?? row.actor) + step;
  const counts = row.kind === "edited" ? ` (+${row.added} −${row.removed})` : "";
  return `${who}: ${row.path} ${KINDS[row.kind] ?? row.kind}${counts}`;
}

// The hour the nightly tidy-up may start after, as the person reads it (24-hour clock).
export function tidyHourLabel(hour: number): string {
  if (hour >= 24) return "hiçbir zaman";
  return `${String(hour).padStart(2, "0")}:00`;
}

// What the last capture noticed, or "" when it noticed nothing.
export function captureLine(r: CaptureReport | null | undefined): string {
  if (!r) return "";
  const parts = [
    r.added ? `notlar için ${r.added}` : "",
    r.topics ? `konu notları için ${r.topics}` : "",
    r.about_me ? `Hakkımda için ${r.about_me}` : "",
  ].filter(Boolean);
  if (parts.length) return `Son fark edilenler: ${parts.join(", ")}.`;
  return r.note ?? "";
}

// Which model the quick calls use, and why a different one might be wanted.
export function helperModelLine(
  status: Pick<MemoryUpkeepStatus, "engine" | "helper_model" | "engine_can_call" | "helper" | "helper_used"> | null,
  allowed = true,
): string {
  if (!status) return "";
  if (!status.engine_can_call) {
    const helper = status.helper;
    if (helper && helper.usable && allowed) {
      return `Bu ajanın motoru hızlı çağrıyı yapamıyor; bu yüzden yardımcı model (${helper.label}${helper.model ? `, ${helper.model}` : ""}) yazıyor: okunan metin bu ajanın sağlayıcısına değil, ${helper.label} tarafına gider.`;
    }
    if (helper && !allowed) return "Bu ajanın motoru hızlı çağrıyı yapamıyor ve ajan yardımcı modeli hiç kullanmıyor; bu yüzden yalnız süresi dolmuş notlar ve tekrarlar toparlanır.";
    if (helper) return `Bu ajanın motoru hızlı çağrıyı yapamıyor ve yardımcı model (${helper.label}) kullanılamıyor; bu yüzden yalnız süresi dolmuş notlar ve tekrarlar toparlanır.`;
    return "Bu ajanın motoru hızlı çağrıyı yapamıyor; bu yüzden yalnız süresi dolmuş notlar ve tekrarlar toparlanır.";
  }
  const engine = status.engine ?? "kendi motoru";
  return status.helper_model
    ? `Hızlı çağrılar ${engine} üzerinde ${status.helper_model} kullanır.`
    : `Hızlı çağrılar ${engine} üzerinde bu ajanın kendi modelini kullanır.`;
}

// The settings change that sets (or, with an empty engine, removes) the helper model.
export function helperChange(engine: string, model: string): { helper: { engine: string; model: string } | null } {
  const e = engine.trim();
  return { helper: e ? { engine: e, model: model.trim() } : null };
}

// The settings with one engine's helper model set (an empty name clears it).
export function withHelperModel(models: Record<string, string>, engine: string, model: string): Record<string, string> {
  const next = { ...models };
  const name = model.trim();
  if (name) next[engine] = name;
  else delete next[engine];
  return next;
}
