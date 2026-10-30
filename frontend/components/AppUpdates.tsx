"use client";

import { useEffect, useState } from "react";

export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
  current: string;
  version?: string;
  percent?: number;
  message?: string;
  canDownload?: boolean;
  verified?: boolean;
};

export type UpdatesBridge = {
  run(action: "state" | "check" | "download" | "install" | "release-page"): Promise<UpdateState>;
  onState(listener: (state: UpdateState) => void): () => void;
};

const buttonClass = "cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

function summary(state: UpdateState) {
  switch (state.status) {
    case "checking": return "Güncellemeler denetleniyor…";
    case "available": return `${state.version} sürümü hazır.`;
    case "downloading": return `${state.version} sürümü indiriliyor… %${state.percent ?? 0}`;
    case "downloaded": return `${state.version} sürümü İndirilenler klasörünüze kaydedildi${state.verified ? " ve doğrulandı" : ""}.`;
    case "installing": return state.message ?? "Yükleyici açıldı.";
    case "error": return state.message ?? "Güncelleme başarısız oldu.";
    default: return state.message ?? "Open Duet yeni sürümleri arka planda denetler.";
  }
}

// Only the desktop app has the bridge; a browser tab shows nothing.
export function AppUpdates() {
  const bridge = typeof window === "undefined" ? undefined : window.openDots?.updates;
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.run("state").then((value) => { if (alive) setState(value); }).catch(() => {});
    const stop = bridge.onState((value) => { if (alive) setState(value); });
    return () => { alive = false; stop(); };
  }, [bridge]);

  if (!bridge || !state) return null;
  const act = (action: Parameters<UpdatesBridge["run"]>[0]) => void bridge.run(action).then(setState).catch((error) => setState({ ...state, status: "error", message: String(error?.message ?? error) }));
  const working = state.status === "checking" || state.status === "downloading";
  return <section aria-labelledby="app-updates" className="space-y-3 rounded-card border border-line bg-raised p-5">
    <div><h3 id="app-updates" className="font-semibold">Uygulama güncellemeleri</h3><p className="mt-1 text-xs text-muted">Kullandığınız sürüm: {state.current}. Güncellemeler projenin GitHub sürümlerinden gelir; siz tıklamadan hiçbir şey yüklenmez.</p></div>
    <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-danger" : ""}`}>{summary(state)}</p>
    <div className="flex flex-wrap gap-2">
      {state.status === "available" && state.canDownload && <button className={buttonClass} onClick={() => act("download")}>{state.version} sürümünü indir</button>}
      {state.status === "downloaded" && <button className={buttonClass} onClick={() => act("install")}>Yükleyiciyi aç</button>}
      {(state.status === "available" || state.status === "downloaded") && <button className={buttonClass} onClick={() => act("release-page")}>Sürüm notları</button>}
      {state.status === "error" && state.canDownload && <button className={buttonClass} onClick={() => act("download")}>İndirmeyi yeniden dene</button>}
      <button className={buttonClass} disabled={working} onClick={() => act("check")}>{state.status === "checking" ? "Denetleniyor…" : "Güncellemeleri denetle"}</button>
    </div>
  </section>;
}
