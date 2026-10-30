// Words for approvals, saved rules and the decision log. Pure: no React, no network.
import type { ApprovalRule, DecisionEntry, DecisionEvent, SentinelIssue } from "./api";

export const DECISION_EVENTS: { value: DecisionEvent; label: string }[] = [
  { value: "shown", label: "Soruldu" },
  { value: "allowed", label: "İzin verildi" },
  { value: "denied", label: "Reddedildi" },
  { value: "auto_allowed", label: "Kayıtlı kuralla izin verildi" },
  { value: "expired", label: "Süresi doldu" },
  { value: "cancelled", label: "İptal edildi" },
  { value: "undone", label: "Her zaman izin kaldırıldı" },
];

export function decisionEventLabel(event: string): string {
  return DECISION_EVENTS.find((e) => e.value === event)?.label ?? event;
}

// One line saying what happened and who decided.
export function decisionText(entry: DecisionEntry): string {
  const what = entry.summary || entry.tool || "bir araç çağrısı";
  switch (entry.event) {
    case "shown":
      return entry.rule?.startsWith("safety_floor:")
        ? `Soruldu: ${what} (kayıtlı bir kural eşleşti, ama güvenlik tabanı bunu size bırakıyor)`
        : `Soruldu: ${what}`;
    case "allowed":
      return entry.remembered ? `İzin verdiniz: ${what} (her zaman izin verilecek)` : `İzin verdiniz: ${what}`;
    case "denied":
      return entry.source === "plan_mode" ? `Reddedildi: ${what} (yalnız plan modunda hiçbir şey değişmez)` : `Reddettiniz: ${what}`;
    case "auto_allowed":
      if (entry.source === "screen_turn_grant") return `Bu tur için verdiğiniz ekran izniyle çalıştı: ${what}`;
      if (entry.source === "computer_screen_read") return `Sormadan çalıştı (bilgisayar ekranını okuma): ${what}`;
      if (entry.source === "computer_browser_read") return `Sormadan çalıştı (ajanın tarayıcısını okuma): ${what}`;
      if (entry.source === "computer_read") return `Sormadan çalıştı (ajanın bilgisayarında okuma): ${what}`;
      if (entry.source === "accept_edits") return `Sormadan çalıştı (bu ajan için düzenlemeler kabul ediliyor): ${what}`;
      return `Sormadan çalıştı (kayıtlı bir kural izin verdi): ${what}`;
    case "expired":
      return `Zamanında yanıt verilmediği için çalışmadı: ${what}`;
    case "cancelled":
      return `Soru geri çekildi: ${what}`;
    case "undone":
      return `Artık her zaman izin verilmiyor: ${ruleCommand(entry.rule) || "bir komut"}`;
    default:
      return what;
  }
}

// "exact@/work: git status" -> "git status".
export function ruleCommand(rule: string | null | undefined): string {
  if (!rule) return "";
  const at = rule.indexOf(": ");
  return at === -1 ? rule : rule.slice(at + 2);
}

export function ruleMatchLabel(rule: Pick<ApprovalRule, "match">): string {
  return rule.match === "prefix" ? "Şununla başlar" : "Tam olarak";
}

export function ruleScopeLabel(rule: Pick<ApprovalRule, "workspace">): string {
  return rule.workspace ? `Klasör: ${rule.workspace}` : "Her klasörde";
}

// The card offers "Always allow this command" only where the backend can save
// one: a shell command with text.
export function canAlwaysAllow(tool: string, input: Record<string, unknown>): boolean {
  const command = input.command;
  // A computer's exec tool is a shell command too; its rules match the same way.
  return (tool === "Bash" || tool === "mcp__computer__exec") && typeof command === "string" && command.trim() !== "";
}

export function csvFileName(threadId: number | null | undefined, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return threadId != null ? `decisions-thread-${threadId}-${day}.csv` : `decisions-${day}.csv`;
}

const ISSUE_KIND: Record<SentinelIssue["kind"], string> = {
  retry_loop: "Yeniden deneme döngüsü",
  repeated_denial: "Reddedildikten sonra yeniden soruldu",
  tool_error: "Araç hatası",
  turn_failure: "Başarısız yanıt",
};

export function issueKindLabel(kind: string): string {
  return ISSUE_KIND[kind as SentinelIssue["kind"]] ?? kind;
}

export function isScreenInput(tool: string): boolean {
  return /^mcp__computer__(click|double_click|move|drag|type|key|scroll|browser_(open|click|fill|type|press|tabs|dialog|restart|close))$/.test(tool);
}
