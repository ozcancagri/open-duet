// Connected apps (Composio): the parts of the Settings flow that are plain
// logic, kept apart from the component so they can be tested.

export type ComposioApp = { slug: string; label: string };
export type ComposioAccount = {
  id: string;
  toolkit: string;
  alias: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};
export type ComposioLink = { redirect_url: string; account_id: string; expires_in_seconds: number };

export const POLL_INTERVAL_MS = 3000;

const WAITING = new Set(["INITIATED", "INITIALIZING"]);
const FAILED = new Set(["FAILED", "EXPIRED"]);

export function statusLabel(status: string): string {
  if (status === "ACTIVE") return "Bağlandı";
  if (WAITING.has(status)) return "Tarayıcınızda işlemi bitirmeniz bekleniyor";
  if (status === "FAILED") return "Bağlantı kurulamadı";
  if (status === "EXPIRED") return "Bağlantının süresi doldu";
  if (status === "INACTIVE") return "Etkin değil";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export type Outcome = "connected" | "waiting" | "failed" | "gone";

// What the account we are waiting for looks like in the latest listing.
export function outcomeFor(accounts: ComposioAccount[], accountId: string): Outcome {
  const found = accounts.find((account) => account.id === accountId);
  if (!found) return "gone";
  if (found.status === "ACTIVE") return "connected";
  if (FAILED.has(found.status)) return "failed";
  return "waiting";
}

// Only an https link on composio.dev is ever opened; the server checks too.
export function isComposioLink(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 4096 || /\s/.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && url.port === ""
      && (url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"));
  } catch {
    return false;
  }
}

export type LinkBridge = { openComposioLink?: (url: string) => Promise<void> };
export type TabWindow = { opener: unknown; closed?: boolean; location: { href: string }; close(): void };
export type Opener = (url: string, target: string) => TabWindow | null;

export type ReservedPage = { navigate(url: string): Promise<void>; cancel(): void };

// A browser blocks a window opened after an await, so the tab is opened during
// the click and sent to the link once the server has made it. The desktop app
// has no tabs: its shell opens the link in the system browser.
export function reservePage(bridge: LinkBridge | undefined, open: Opener): ReservedPage {
  if (bridge?.openComposioLink) {
    const openLink = bridge.openComposioLink;
    return {
      navigate: async (url) => { if (!isComposioLink(url)) throw new Error("Bu bağlantı Composio'dan gelmiyor."); await openLink(url); },
      cancel: () => {},
    };
  }
  const tab = open("about:blank", "_blank");
  if (tab) tab.opener = null;
  return {
    navigate: async (url) => {
      if (!isComposioLink(url)) { tab?.close(); throw new Error("Bu bağlantı Composio'dan gelmiyor."); }
      if (!tab || tab.closed) throw new Error("Tarayıcınız yeni sekmeyi engelledi. Bu sayfa için açılır pencerelere izin verip yeniden deneyin.");
      tab.location.href = url;
    },
    cancel: () => { tab?.close(); },
  };
}

// Waiting stops at the link's life (a little over, so a late success is seen).
export function pollDeadline(expiresInSeconds: number, now: number): number {
  const seconds = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? Math.min(expiresInSeconds, 3600) : 600;
  return now + (seconds + 15) * 1000;
}

export function accountsOf(accounts: ComposioAccount[], toolkit: string): ComposioAccount[] {
  return accounts.filter((account) => account.toolkit === toolkit);
}

// The apps and engines an agent can be allowed to use in this version.
export const AGENT_APPS: { slug: string; label: string; read: string; write: string | null }[] = [
  {
    slug: "github", label: "GitHub",
    read: "Profilinizi, depolarınızı, issue'ları, pull request'leri, commit'leri ve dosyaları okur; arama yapar.",
    write: "Ayrıca issue açar, yorum yazar, issue kapatır ya da yeniden açar. Her değişikliği önce siz onaylarsınız.",
  },
  {
    slug: "gmail", label: "Gmail",
    read: "Mesajlarda arar, mesaj zincirlerini okur ve bağlı hesabın profilini görür.",
    write: "Ayrıca var olan bir zincire düz metin taslak yanıt oluşturur. Her taslağı siz onaylarsınız; hiçbiri gönderilmez.",
  },
  {
    slug: "googlecalendar", label: "Google Takvim",
    read: "Takvimleri listeler ve en çok 31 günlük bir tarih aralığında etkinlik özetlerinde arar.",
    write: null,
  },
];
const APPS_ENGINES = new Set(["claude", "codex"]);

export function supportsConnectedApps(provider: string): boolean {
  // Extra Claude accounts (claude_<name>) are the Claude engine on another account.
  return APPS_ENGINES.has(provider) || /^claude_[a-z0-9]{1,20}$/.test(provider);
}

export type Level = "off" | "read" | "write";
export type Scopes = Record<string, string>;

export function levelOf(scopes: Scopes | null | undefined, slug: string): Level {
  const level = scopes?.[slug];
  return level === "read" || level === "write" ? level : "off";
}

// The scopes after setting one app's level. "off" removes it; the others are untouched.
export function withApp(scopes: Scopes | null | undefined, slug: string, level: Level): Scopes {
  const next: Scopes = { ...(scopes ?? {}) };
  if (level === "off") delete next[slug]; else next[slug] = level;
  return next;
}

// What to send when saving an agent: nothing for an engine that cannot use apps
// (this also clears them if the engine was changed), else the known levels or null.
export function scopesToSend(scopes: Scopes | null | undefined, provider: string): Scopes | null {
  if (!supportsConnectedApps(provider)) return null;
  const known = Object.fromEntries(Object.entries(scopes ?? {}).filter(([slug, level]) => {
    const app = AGENT_APPS.find((candidate) => candidate.slug === slug);
    return Boolean(app && (level === "read" || (level === "write" && app.write)));
  }));
  return Object.keys(known).length ? known : null;
}
