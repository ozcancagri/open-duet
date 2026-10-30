export type NeedsYouRow = {
  kind: "signed_out" | "out_of_credit" | "usage_limit" | "approval" | "routine" | "repeated_failure" | "question" | "due" | "routine_completed";
  key: string;
  title: string;
  detail: string | null;
  thread_id: number | null;
  at?: string | null;
  source?: string;
  routine_id?: number | null;
  work_item_id?: number | null;
};

// What the one action on a row says. Every kind has exactly one next step.
const ACTIONS: Record<NeedsYouRow["kind"], string> = {
  signed_out: "Ayarları aç",
  out_of_credit: "Ayarları aç",
  usage_limit: "Kullanımı gör",
  approval: "İncele",
  routine: "Çalıştırmayı aç",
  repeated_failure: "İncele",
  question: "Yanıtla",
  due: "Görevi incele",
  routine_completed: "Çalıştırmaları gör",
};

export function rowAction(row: NeedsYouRow): { label: string; href: string | null } {
  const label = ACTIONS[row.kind] ?? "Aç";
  if (row.thread_id !== null) return { label, href: `/chat?thread=${row.thread_id}` };
  if (row.routine_id) return { label, href: `/chat?view=routines&routine=${row.routine_id}` };
  if (row.work_item_id) return { label, href: `/chat?view=planner&task=${row.work_item_id}` };
  if (row.kind === "usage_limit") return { label, href: "/chat?panel=usage" };
  if (row.kind === "signed_out" || row.kind === "out_of_credit") return { label, href: "/settings/" };
  return { label, href: null };
}

export function summary(rows: number, more: number): string {
  const total = rows + more;
  return total === 0 ? "Şu an sizi bekleyen bir şey yok." : `Sizi bekleyen ${total} iş var`;
}
