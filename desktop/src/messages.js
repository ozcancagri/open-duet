// What the person reads when the backend does not start or stops. The exit codes
// are the backend's contract with the launcher (backend/app/desktop/entry.py).

const fs = require("node:fs");

const EXIT = { HANDSHAKE: 2, KEY_MISMATCH: 3, DATABASE: 4, UI_MISSING: 5 };

// The backend explains itself on stderr in lines that start with "[desktop] ".
// They never hold a secret, so the last one can be shown as the reason.
function lastReason(logFile, fsImpl = fs) {
  let text;
  try {
    const size = fsImpl.statSync(logFile).size;
    const length = Math.min(size, 16 * 1024);
    const descriptor = fsImpl.openSync(logFile, "r");
    try {
      const buffer = Buffer.alloc(length);
      fsImpl.readSync(descriptor, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      fsImpl.closeSync(descriptor);
    }
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith("[desktop] "));
  return lines.length ? lines[lines.length - 1].slice("[desktop] ".length) : null;
}

// `kind` is how the start failed (see startBackend): "spawn" means the backend
// program could not be run at all, so it never started and has no exit code.
function describeFailure({ code, logFile, reason, kind }) {
  const where = `Ayrıntılar şu dosyada: ${logFile}`;
  const because = reason ? `\n\n${reason}` : "";
  if (kind === "spawn") {
    return {
      title: "Open Duet sunucusunu başlatamadı",
      body: `Sunucu programı çalıştırılamadı.${because}\n\n${where}`,
    };
  }
  switch (code) {
    case EXIT.KEY_MISMATCH:
      return {
        title: "Open Duet kayıtlı kimlik bilgilerini okuyamıyor",
        body:
          "Şifreleme anahtarı kayıtlı olanı açmıyor; bu yüzden Open Duet hiçbir şeyi değiştirmeden durdu. " +
          `Veri klasöründeki dosyaları değiştirdiyseniz ya da geri yüklediyseniz, eşleşen anahtarı da geri yükleyin.${because}\n\n${where}`,
      };
    case EXIT.DATABASE:
      return {
        title: "Open Duet veritabanını açamadı",
        body: `Veritabanı olduğu gibi bırakıldı.${because}\n\n${where}`,
      };
    case EXIT.UI_MISSING:
      return {
        title: "Open Duet'in gösterecek sayfası yok",
        body: `Masaüstü klasöründe "npm run build" ile derleyin, sonra yeniden başlatın.${because}\n\n${where}`,
      };
    case EXIT.HANDSHAKE:
      return {
        title: "Open Duet sunucusunu başlatamadı",
        body: `Sunucu, başlatıcının başlatma mesajını reddetti.${because}\n\n${where}`,
      };
    default:
      return {
        title: "Open Duet sunucusunu başlatamadı",
        body: `Sunucu hazır olmadan durdu${code === null || code === undefined ? "" : ` (çıkış kodu ${code})`}.${because}\n\n${where}`,
      };
  }
}

function describeUnexpectedExit({ code, logFile, reason }) {
  return {
    title: "Open Duet sunucusu durdu",
    body:
      `Sunucu beklenmedik biçimde durdu${code === null || code === undefined ? "" : ` (çıkış kodu ${code})`}. ` +
      `Claude'un o sırada yanıtladığı her şey kesildi ve yinelenmeyecek.` +
      `${reason ? `\n\n${reason}` : ""}\n\nAyrıntılar şu dosyada: ${logFile}. Devam etmek için Open Duet'i yeniden başlatın.`,
  };
}

module.exports = { EXIT, lastReason, describeFailure, describeUnexpectedExit };
