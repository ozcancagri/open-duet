"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { markSeen, pendingTips, readSeen, resetSeen, TIPS, TIPS_RESET_EVENT, tipKey, type Tip, type TipPage } from "@/lib/tips";

const storage = () => window.localStorage;
const HIGHLIGHT = ["outline", "outline-2", "outline-offset-2", "outline-accent"];

// The page's tips not seen yet, one card at a time, in a corner of the window, or
// in place (`inline`) inside a dialog, where a fixed card would sit under it.
// A tip with a target outlines the element marked data-tip="<target>" while it shows.
export function TipsGuide({ page, inline = false }: { page: TipPage; inline?: boolean }) {
  const [tips, setTips] = useState<Tip[]>([]);
  useEffect(() => {
    const load = () => setTips(pendingTips(page, readSeen(storage)));
    load();
    window.addEventListener(TIPS_RESET_EVENT, load);
    return () => window.removeEventListener(TIPS_RESET_EVENT, load);
  }, [page]);

  const tip = tips[0];
  useEffect(() => {
    if (!tip?.target) return;
    const element = document.querySelector<HTMLElement>(`[data-tip="${tip.target}"]`);
    if (!element) return;
    element.classList.add(...HIGHLIGHT);
    element.scrollIntoView({ block: "nearest" });
    return () => element.classList.remove(...HIGHLIGHT);
  }, [tip]);

  if (!tip) return null;
  const total = TIPS[page].length;
  const number = total - tips.length + 1;
  const done = (keys: Tip[]) => {
    markSeen(storage, keys.map((item) => tipKey(page, item)));
    setTips((current) => current.filter((item) => !keys.includes(item)));
  };
  const place = inline ? "mb-3" : "fixed right-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))] shadow-lg";
  return <aside role={inline ? "note" : "dialog"} aria-label="İpucu" className={`${place} space-y-2 rounded-lg border border-line bg-raised p-4`}>
    <p className="text-xs text-muted">İpucu {number}/{total}</p>
    <h2 className="font-semibold">{tip.title}</h2>
    <p className="text-sm">{tip.body}</p>
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      {tips.length > 1 && <Button size="sm" variant="ghost" onClick={() => done(tips)}>Tümünü geç</Button>}
      <Button size="sm" variant="primary" onClick={() => done([tip])}>{tips.length > 1 ? "Anladım, sonraki" : "Anladım"}</Button>
    </div>
  </aside>;
}

// Shows every page's tips again from the start.
export function TipsResetButton() {
  const [done, setDone] = useState(false);
  return <Button size="sm" data-tip="tips-reset" onClick={() => {
    resetSeen(storage);
    window.dispatchEvent(new Event(TIPS_RESET_EVENT));
    setDone(true);
  }}>{done ? "İpuçları yeniden açıldı" : "İpuçlarını yeniden göster"}</Button>;
}
