// Guided tips: short cards that show a person, page by page, what to do and how.
// Which tips were seen lives only in this browser's localStorage (a convenience,
// never server state), so every read and write is guarded: blocked storage shows
// the tips again. No runtime imports, so node tests can load it.

export type TipPage = "chat" | "settings" | "tasks" | "routines";
// `target` names an element marked data-tip="<target>" that the card points at.
export type Tip = { id: string; title: string; body: string; target?: string };

export const TIPS_KEY = "od-tips-seen";
// Sent on window when the person asks to see the tips again.
export const TIPS_RESET_EVENT = "od-tips-reset";

export const TIPS: Record<TipPage, Tip[]> = {
  chat: [
    {
      id: "welcome",
      title: "Open Duet'e hoş geldiniz",
      body: "Burada kendi yapay zekâ ajanlarınızla sohbet edersiniz. Soldaki kenar çubuğunda ajanlarınız ve sohbetleriniz durur. Bu ipuçlarını istediğiniz zaman Ayarlar'dan yeniden açabilirsiniz.",
    },
    {
      id: "new-agent",
      target: "new-agent",
      title: "Önce bir ajan oluşturun",
      body: "\"Yeni ajan\" ile bir ajan ekleyin: adını, ne iş yapacağını (talimatlar), hangi klasörde çalışacağını ve motorunu (Claude ya da Codex) seçin. Örneğin \"Literatür asistanı\" ya da \"Rapor düzenleyici\".",
    },
    {
      id: "new-chat",
      target: "new-chat",
      title: "Sohbet başlatın",
      body: "\"Yeni sohbet\" ile ajanınıza bir iş verin. Her sohbet tek bir konuya odaklanırsa daha iyi sonuç alırsınız; konu değişince yeni sohbet açın.",
    },
    {
      id: "approvals",
      title: "Onay sizde",
      body: "\"Önce sor\" modunda ajan bir dosyayı değiştirmeden ya da komut çalıştırmadan önce sohbette bir onay kartı gösterir. Ne yapacağını okuyun; uygunsa \"İzin ver\", değilse \"Reddet\" deyin.",
    },
    {
      id: "attach",
      target: "composer",
      title: "Dosya ve görsel ekleyin",
      body: "Mesaj kutusunun yanındaki ataşla metin dosyası ya da görsel ekleyebilirsiniz. Hasta adı, TC no gibi kimlik bilgisi içeren içerik eklemeyin: yazdıklarınız ve ekleriniz seçtiğiniz motorun sağlayıcısına gönderilir.",
    },
    {
      id: "cost",
      title: "Kullanım ve maliyet",
      body: "API anahtarıyla çalışan motorlarda her mesaj API kredinizden düşer. Kullanım panelinden token ve maliyeti izleyin; uzun sohbetler daha pahalıdır.",
    },
  ],
  settings: [
    {
      id: "engines",
      target: "engines",
      title: "Motorlar: abonelik mi, API mi?",
      body: "Claude ve Codex için API anahtarı kaydederseniz Open Duet bu motorları API kredisiyle, aboneliğinizden ayrı bir klasörde çalıştırır; aboneliğiniz kendi uygulamalarında kalır. Anahtar yoksa bilgisayardaki giriş (abonelik) kullanılır. Anahtarı kaldırmak için motorun \"Ayarları unut\" düğmesini kullanın.",
    },
    {
      id: "check",
      title: "Motor hazır değilse",
      body: "Bir motor \"Kurulum gerekli\" görünüyorsa altındaki açıklamayı okuyun, gerekeni yapın ve \"Yeniden kontrol et\"e basın.",
    },
    {
      id: "tips-again",
      target: "tips-reset",
      title: "İpuçlarını yeniden görmek",
      body: "Bu ipuçlarını baştan görmek için \"İpuçlarını yeniden göster\" düğmesini kullanın.",
    },
  ],
  tasks: [
    {
      id: "board",
      title: "Görev panosu",
      body: "İşlerinizi kart olarak tutun, bir ajana ya da takıma atayın ve son tarih verin. Karttan ajanı başlatabilir ya da tek seferlik bir çalışma zamanlayabilirsiniz.",
    },
    {
      id: "calendar",
      title: "Takvim",
      body: "Son tarihler ve rutinlerin çalışacağı zamanlar haftalık ya da aylık takvimde birlikte görünür.",
    },
  ],
  routines: [
    {
      id: "what",
      title: "Rutinler",
      body: "Rutin, bir ajana belirli bir saatte, bir web kancasıyla ya da \"Şimdi çalıştır\" ile iş yaptırır. Rutin hiçbir işlemi kendi başına onaylamaz; onay gerekirse size bildirim gelir.",
    },
    {
      id: "open",
      title: "Uygulama açık kalmalı",
      body: "Rutinler Open Duet çalışırken çalışır. Bilgisayar kapalıyken ya da uygulama kapalıyken zamanı gelen rutin çalışmaz.",
    },
  ],
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readSeen(storage: () => StorageLike): Set<string> {
  try {
    const value = JSON.parse(storage().getItem(TIPS_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function markSeen(storage: () => StorageLike, keys: string[]): void {
  try {
    const seen = readSeen(storage);
    for (const key of keys) seen.add(key);
    storage().setItem(TIPS_KEY, JSON.stringify([...seen]));
  } catch {
    // Blocked storage: the tips show again next time.
  }
}

export function resetSeen(storage: () => StorageLike): void {
  try { storage().removeItem(TIPS_KEY); } catch { /* nothing to reset */ }
}

export function tipKey(page: TipPage, tip: Tip): string {
  return `${page}:${tip.id}`;
}

// The page's tips not seen yet, in order.
export function pendingTips(page: TipPage, seen: Set<string>): Tip[] {
  return TIPS[page].filter((tip) => !seen.has(tipKey(page, tip)));
}
