const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateClaudeAuthorizationUrl, registerClaudeSignIn } = require("../src/claude-sign-in");

const origin = "http://127.0.0.1:51234";
const valid = "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz";

test("opens only Anthropic's authorize page, from the Settings window", async () => {
  assert.equal(validateClaudeAuthorizationUrl(valid), valid);
  assert.equal(validateClaudeAuthorizationUrl("https://claude.ai/oauth/authorize?state=x"), "https://claude.ai/oauth/authorize?state=x");
  const opened = [];
  const window = { webContents: { getURL: () => `${origin}/settings/` } };
  let handler;
  registerClaudeSignIn({ ipcMain: { handle: (_channel, fn) => { handler = fn; } }, openExternal: async (url) => opened.push(url), getWindow: () => window, getOrigin: () => origin });
  await handler({ sender: window.webContents }, valid);
  assert.deepEqual(opened, [valid]);
});

test("rejects other hosts, paths, schemes, credentials, ports, odd shapes", () => {
  for (const raw of [
    "https://claude.com.evil.test/cai/oauth/authorize?state=x",
    "https://evil.test/cai/oauth/authorize?state=x",
    "https://claude.com@evil.test/cai/oauth/authorize?state=x",
    "https://user:pw@claude.com/cai/oauth/authorize?state=x",
    "https://claude.com:8443/cai/oauth/authorize?state=x",
    "http://claude.com/cai/oauth/authorize?state=x",
    "https://claude.com/settings?state=x",
    "https://claude.com/cai/oauth/authorize",
    "https://claude.com/cai/oauth/authorize?state=x#frag",
    "https://claude.com/cai/oauth/authorize?state=x y",
    `https://claude.com/cai/oauth/authorize?state=${"a".repeat(5000)}`,
    "javascript:alert(1)", "", "not a url", null, undefined, 42, {},
  ]) assert.throws(() => validateClaudeAuthorizationUrl(raw), undefined, String(raw));
});

test("rejects IPC calls from a foreign origin, a stale window or no window", async () => {
  for (const { windowUrl, senderIsWindow } of [{ windowUrl: "https://evil.test/settings/", senderIsWindow: true }, { windowUrl: `${origin}/settings/`, senderIsWindow: false }]) {
    const window = { webContents: { getURL: () => windowUrl } };
    const sender = senderIsWindow ? window.webContents : { getURL: () => `${origin}/settings/` };
    let handler;
    const opened = [];
    registerClaudeSignIn({ ipcMain: { handle: (_channel, fn) => { handler = fn; } }, openExternal: async (value) => opened.push(value), getWindow: () => window, getOrigin: () => origin });
    await assert.rejects(handler({ sender }, valid));
    assert.deepEqual(opened, []);
  }
  let handler;
  registerClaudeSignIn({ ipcMain: { handle: (_channel, fn) => { handler = fn; } }, openExternal: async () => assert.fail("opened"), getWindow: () => null, getOrigin: () => origin });
  await assert.rejects(handler({ sender: {} }, valid));
});
