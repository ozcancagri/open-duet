// Words for agent computers. Pure: no React, no network.
import type { Computer, ComputerNetwork, ComputerSummary } from "./api";

export const COMPUTER_TOOL_PREFIX = "mcp__computer__";

export const NETWORK_MODES: { value: ComputerNetwork; label: string; description: string }[] = [
  { value: "none", label: "Ağ yok", description: "Bilgisayar internete ya da başka hiçbir yere ulaşamaz." },
  { value: "default", label: "İnternet", description: "Docker'ın varsayılan ağı: internete ulaşabilir; dışarıdan ona ulaşılamaz." },
];

export function computerCreationGate(supported: boolean | undefined, engineLabel: string): { enabled: boolean; reason: string | null } {
  if (supported === true) return { enabled: true, reason: null };
  if (supported === false) {
    return {
      enabled: false,
      reason: `${engineLabel} araçlarını bir ajan bilgisayarında çalıştıramıyor. Bilgisayar oluşturmak için bilgisayarları destekleyen bir motor seçin.`,
    };
  }
  return {
    enabled: false,
    reason: `${engineLabel} için bilgisayar desteği doğrulanamadı. Oluşturmadan önce motor bilgilerini yenileyin.`,
  };
}

const STATE_LABEL: Record<string, string> = {
  missing: "Henüz oluşturulmadı",
  creating: "Başlatılıyor…",
  running: "Çalışıyor",
  stopped: "Durduruldu",
  error: "Sorun var",
  deleting: "Kaldırılıyor…",
  foreign: "Ad kullanımda",
  unsafe: "Güvensiz",
  unavailable: "Ulaşılamıyor",
};

export function computerStateLabel(state: string | null | undefined): string {
  if (!state) return "Bilinmiyor";
  return STATE_LABEL[state] ?? state;
}

// What to show: what Docker says now when known, else what the app last saw.
export function effectiveState(computer: Pick<Computer, "state" | "live_state">): string {
  return computer.live_state ?? computer.state;
}

export function computerChip(summary: ComputerSummary | null | undefined, liveState?: string | null): string | null {
  if (!summary) return null;
  return `${summary.kind === "desktop" ? "Masaüstü" : "Bilgisayar"} · ${computerStateLabel(liveState ?? summary.state).toLocaleLowerCase("tr")}`;
}

// Short image name for a narrow space: "python:3.12-slim-bookworm" from a pinned reference.
export function imageLabel(image: string): string {
  const withoutDigest = image.split("@")[0];
  const parts = withoutDigest.split("/");
  return parts[parts.length - 1] || image;
}

export function limitsText(computer: Pick<Computer, "cpus" | "memory_mb" | "pids_limit">): string {
  const memory = computer.memory_mb >= 1024 && computer.memory_mb % 1024 === 0 ? `${computer.memory_mb / 1024} GB` : `${computer.memory_mb} MB`;
  return `${computer.cpus} CPU · ${memory} · ${computer.pids_limit} süreç`;
}

export function isComputerTool(tool: string | null | undefined): boolean {
  return typeof tool === "string" && tool.startsWith(COMPUTER_TOOL_PREFIX);
}

const TOOL_LABEL: Record<string, string> = {
  exec: "bir komut çalıştırmak",
  read_file: "bir dosya okumak",
  write_file: "bir dosya yazmak",
  list_files: "bir klasörü listelemek",
};

// "kendi bilgisayarında bir komut çalıştırmak" for mcp__computer__exec; the name itself otherwise.
export function toolLabel(tool: string): string {
  if (!isComputerTool(tool)) return tool;
  const name = tool.slice(COMPUTER_TOOL_PREFIX.length);
  return `kendi bilgisayarında ${TOOL_LABEL[name] ?? name}`;
}

// What the person can do next, in check order.
export type ComputerAction = "prepare-image" | "start" | "stop" | "recreate";

export function nextActions(computer: Computer): ComputerAction[] {
  const state = effectiveState(computer);
  if (computer.health && !computer.health.available) return [];
  const actions: ComputerAction[] = [];
  if (state === "missing" || state === "error") actions.push("prepare-image", "start");
  else if (state === "stopped") actions.push("start");
  else if (state === "running") actions.push("stop");
  // A machine that exists (or is unusable) can be made again from the settings.
  if (["running", "stopped", "unsafe", "error"].includes(state)) actions.push("recreate");
  return actions;
}

export const ACTION_LABEL: Record<ComputerAction, string> = {
  "prepare-image": "İmajı indir",
  start: "Başlat",
  stop: "Durdur",
  recreate: "Yeniden oluştur",
};

export function lastCommandText(computer: Pick<Computer, "last_command">): string | null {
  const last = computer.last_command;
  if (!last || !last.subject) return null;
  const outcome = last.timed_out ? "zaman aşımı" : last.exit_code === null ? "çıkış kodu yok" : `çıkış ${last.exit_code}`;
  const verb = last.tool === "exec" || last.tool === null ? "" : `${last.tool} `;
  return `${verb}${last.subject} (${outcome})`;
}

// An older backend has no computer routes: it answers 404 for all of them.
export function computersUnsupported(status: number, code: string | null): boolean {
  return status === 404 && code !== "no_computer";
}
