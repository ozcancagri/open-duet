const { sameOrigin } = require("./origin");

// The sign-in page Claude Code prints (Anthropic's own authorize page), opened
// from Settings → Engines. The window itself cannot open windows, so the shell
// opens it in the system browser. Same rule as frontend/lib/claude-login-link.ts.
const HOSTS = new Set(["claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"]);
const AUTHORIZE_PATH = /^(\/[a-z]{1,8})?\/oauth\/authorize$/u;

function validateClaudeAuthorizationUrl(raw) {
  if (typeof raw !== "string" || raw.length > 4096 || /\s/u.test(raw)) {
    throw new Error("Invalid Claude sign-in URL.");
  }
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("Invalid Claude sign-in URL."); }
  if (
    url.protocol !== "https:" || !HOSTS.has(url.hostname) || !AUTHORIZE_PATH.test(url.pathname)
    || url.username || url.password || url.port || url.hash || !url.search
  ) throw new Error("Invalid Claude sign-in URL.");
  return url.href;
}

function registerClaudeSignIn({ ipcMain, openExternal, getWindow, getOrigin }) {
  ipcMain.handle("open-dots:claude-sign-in", async (event, raw) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || !sameOrigin(window.webContents.getURL(), getOrigin())) {
      throw new Error("Claude sign-in must be started from Open Duet Settings.");
    }
    await openExternal(validateClaudeAuthorizationUrl(raw));
  });
}

module.exports = { validateClaudeAuthorizationUrl, registerClaudeSignIn };
