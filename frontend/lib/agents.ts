import type { Agent, AgentMemory, ApprovalMode } from "./api";

// Suggestions for the model box; any text the Claude CLI accepts also works.
export const MODEL_SUGGESTIONS = ["default", "sonnet", "opus", "haiku"] as const;

export const APPROVAL_MODES: { value: ApprovalMode; label: string; description: string }[] = [
  {
    value: "ask",
    label: "Önce sor",
    description: "Ajanınız bir dosya yazmadan ya da komut çalıştırmadan önce sorar. Okumaya izin verilir.",
  },
  {
    value: "accept_edits",
    label: "Düzenlemeleri kabul et",
    description: "Dosya düzenlemeleri sormadan yapılır. Komutlar için yine önce sorulur.",
  },
  {
    value: "plan",
    label: "Yalnız plan",
    description: "Ajanınız etrafı inceler ve bir plan yazar, ama hiçbir şeyi değiştirmez.",
  },
];

export function approvalModeLabel(mode: string): string {
  return APPROVAL_MODES.find((m) => m.value === mode)?.label ?? mode;
}

// "default" in the box means the provider's own default, which is stored as no model.
export function modelFromInput(text: string): string | null {
  const model = text.trim();
  const lower = model.toLocaleLowerCase("tr");
  return model === "" || model.toLowerCase() === "default" || lower === "varsayılan" ? null : model;
}

export function modelLabel(model: string | null): string {
  return model ?? "varsayılan";
}

// Names by id, for lists that show which agent a conversation uses.
export function agentNames(agents: Agent[] | null): Map<number, string> {
  return new Map((agents ?? []).map((agent) => [agent.id, agent.name]));
}

// The agents a person can start a chat with: archived ones are left out.
export function activeAgents(agents: Agent[] | null): Agent[] {
  return (agents ?? []).filter((agent) => agent.archived_at === null);
}

// How full the notes are against what loads each turn: by lines or by bytes,
// whichever is closer to its limit. "near" from 80%, "over" once anything is cut.
export type MemoryGauge = { percent: number; level: "ok" | "near" | "over"; text: string };

export function memoryGauge(memory: Pick<AgentMemory, "lines" | "bytes" | "max_lines" | "max_bytes" | "truncated" | "loaded_lines" | "expired" | "expired_lines">): MemoryGauge {
  const share = Math.max(memory.lines / memory.max_lines, memory.bytes / memory.max_bytes);
  const percent = Math.min(100, Math.round(share * 100));
  const level = memory.truncated ? "over" : share >= 0.8 ? "near" : "ok";
  const size = `${memory.lines} / ${memory.max_lines} satır · ${formatKB(memory.bytes)} / ${formatKB(memory.max_bytes)}`;
  const past = Math.max(0, memory.lines - (memory.expired_lines ?? 0) - memory.loaded_lines);
  const cut = memory.truncated ? ` · sınırı aşan ${past} satır yüklenmez` : "";
  const expired = memory.expired ? ` · süresi dolmuş ${memory.expired} not yüklenmez` : "";
  return { percent, level, text: size + cut + expired };
}

function formatKB(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
}

// One line for what a tidy-up did.
export function tidyLine(r: { organized: number; expired: number; duplicates: number; superseded: number; note: string | null }): string {
  const parts = [
    r.organized ? `${r.organized} not konu notlarına taşındı` : "",
    r.expired ? `süresi dolmuş ${r.expired} not arşive taşındı` : "",
    r.duplicates ? `${r.duplicates} tekrar kaldırıldı` : "",
    r.superseded ? `çelişen ${r.superseded} notun üstü çizildi` : "",
  ].filter(Boolean);
  return (parts.length ? `Toparlandı: ${parts.join(", ")}.` : "Toparlanacak bir şey yok.") + (r.note ? ` ${r.note}` : "");
}

// The text of an agent file as saved to disk.
export function agentFileText(document: unknown): string {
  return JSON.stringify(document, null, 2) + "\n";
}

// An agent file read back from disk. Throws an Error with a sentence a person
// can act on; the backend checks everything else.
export function parseAgentFile(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Bu dosya bir ajan dosyası değil (JSON değil).");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bu dosya bir ajan dosyası değil.");
  }
  return value as Record<string, unknown>;
}

// Whether a parsed agent file carries notes, so the import can offer to skip them.
export function agentFileHasNotes(document: Record<string, unknown>): boolean {
  const notes = document.notes as Record<string, unknown> | undefined;
  const topics = notes?.topics as Record<string, unknown> | undefined;
  return (
    (typeof notes?.["MEMORY.md"] === "string" && (notes["MEMORY.md"] as string).trim() !== "") ||
    (typeof topics === "object" && topics !== null && Object.keys(topics).length > 0)
  );
}

// After an export: which parts had something that looked like a secret replaced.
export function redactionNotice(parts: string[]): string | null {
  if (parts.length === 0) return null;
  return `Gizli bilgiye benzeyen bir şey şu bölümlerde değiştirildi: ${parts.join(", ")}.`;
}
