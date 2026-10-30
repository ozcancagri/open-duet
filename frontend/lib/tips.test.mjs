import assert from "node:assert/strict";
import { test } from "node:test";
import { TIPS, TIPS_KEY, markSeen, pendingTips, readSeen, resetSeen, tipKey } from "./tips.ts";

function memory() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
}

test("seen tips are skipped, page by page, until reset", () => {
  const store = memory();
  const storage = () => store;
  assert.equal(pendingTips("chat", readSeen(storage)).length, TIPS.chat.length);
  markSeen(storage, [tipKey("chat", TIPS.chat[0])]);
  assert.deepEqual(pendingTips("chat", readSeen(storage)).map((t) => t.id), TIPS.chat.slice(1).map((t) => t.id));
  assert.equal(pendingTips("settings", readSeen(storage)).length, TIPS.settings.length);
  resetSeen(storage);
  assert.equal(pendingTips("chat", readSeen(storage)).length, TIPS.chat.length);
});

test("blocked or broken storage shows the tips and never throws", () => {
  const blocked = () => { throw new Error("blocked"); };
  assert.equal(readSeen(blocked).size, 0);
  markSeen(blocked, ["chat:welcome"]);
  resetSeen(blocked);
  const store = memory();
  store.setItem(TIPS_KEY, "{not json");
  assert.equal(readSeen(() => store).size, 0);
  store.setItem(TIPS_KEY, JSON.stringify(["chat:welcome", 3]));
  assert.deepEqual([...readSeen(() => store)], ["chat:welcome"]);
});

test("every tip has an id unique on its page, a title and a body", () => {
  for (const tips of Object.values(TIPS)) {
    assert.equal(new Set(tips.map((t) => t.id)).size, tips.length);
    for (const tip of tips) assert.ok(tip.title && tip.body);
  }
});
