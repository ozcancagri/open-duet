"""Files a person attaches to a message (docs/EVERYDAY.md).

Stored in a private folder outside every workspace, one folder per thread:
`<root>/<thread id>/<uuid><ext>` plus `<uuid>.json` with the display name,
type, size and sha256. The stored name is never derived from the uploaded
file name, which is only ever displayed.
"""

import hashlib
import json
import os
import re
import unicodedata
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

from app.core.config import settings
from app.desktop import profile
from app.core import tenant_paths

IMAGE_MAX_BYTES = 10 * 1024 * 1024
TEXT_MAX_BYTES = 1024 * 1024
THREAD_MAX_BYTES = 200 * 1024 * 1024
MAX_PER_TURN = 8
NAME_MAX_CHARS = 120

IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
TEXT_EXTENSIONS = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".json": "application/json",
    ".log": "text/plain",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".xml": "text/xml",
    ".html": "text/plain",
    ".css": "text/plain",
    ".js": "text/plain",
    ".ts": "text/plain",
    ".tsx": "text/plain",
    ".py": "text/plain",
    ".sh": "text/plain",
    ".sql": "text/plain",
    ".toml": "text/plain",
    ".ini": "text/plain",
}
SUPPORTED_TEXT = (
    "Desteklenenler: görseller (PNG, JPEG, GIF, WebP; en çok 10 MB) ve UTF-8 metin dosyaları ("
    + ", ".join(sorted(TEXT_EXTENSIONS))
    + "; en çok 1 MB)."
)
_ID = re.compile(r"^[0-9a-f]{32}$")


class AttachmentError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class Attachment:
    id: str
    name: str
    mime: str
    bytes: int
    kind: str  # image | text
    sha256: str

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "mime": self.mime, "bytes": self.bytes, "kind": self.kind}


def root_dir() -> Path:
    mine = tenant_paths.root()
    if mine is not None:
        return mine / "attachments"
    desktop = profile.current()
    if desktop is not None:
        return desktop.data_dir / "attachments"
    if settings.ATTACHMENTS_DIR.strip():
        return Path(settings.ATTACHMENTS_DIR).expanduser()
    return Path.home() / ".open-dots" / "attachments"


def thread_dir(thread_id: int) -> Path:
    return root_dir() / str(int(thread_id))


def display_name(raw: str | None) -> str:
    """The uploaded name, safe to show: last path part only, no control or
    direction-override characters, bounded length."""
    name = unicodedata.normalize("NFKC", raw or "").replace("\\", "/").split("/")[-1]
    cleaned = "".join(
        "_"
        if unicodedata.category(ch) in ("Cc", "Cf") or ch in '<>:"|?*'
        else ch
        for ch in name
    ).strip().lstrip(".")
    if len(cleaned) > NAME_MAX_CHARS:
        stem, ext = os.path.splitext(cleaned)
        cleaned = stem[: NAME_MAX_CHARS - len(ext[:16])] + ext[:16]
    return cleaned or "attachment"


def _image_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def classify(name: str, declared_mime: str | None, data: bytes) -> tuple[str, str, str]:
    """(kind, mime, stored extension), or AttachmentError."""
    if not data:
        raise AttachmentError(400, "empty_file", f"{name} boş.")
    declared = (declared_mime or "").split(";")[0].strip().lower()
    ext = os.path.splitext(name)[1].lower()
    sniffed = _image_type(data)
    if declared in IMAGE_TYPES or ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        if sniffed is None:
            raise AttachmentError(
                415, "unsupported_type", f"{name} bir PNG, JPEG, GIF ya da WebP görseline benzemiyor."
            )
        if len(data) > IMAGE_MAX_BYTES:
            raise AttachmentError(413, "too_large", f"{name} 10 MB görsel sınırını aşıyor.")
        return "image", sniffed, IMAGE_TYPES[sniffed]
    if sniffed is not None:
        if len(data) > IMAGE_MAX_BYTES:
            raise AttachmentError(413, "too_large", f"{name} 10 MB görsel sınırını aşıyor.")
        return "image", sniffed, IMAGE_TYPES[sniffed]
    if ext in TEXT_EXTENSIONS:
        if len(data) > TEXT_MAX_BYTES:
            raise AttachmentError(413, "too_large", f"{name} 1 MB metin dosyası sınırını aşıyor.")
        if b"\x00" in data:
            raise AttachmentError(415, "unsupported_type", f"{name} bir metin dosyası değil.")
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise AttachmentError(415, "unsupported_type", f"{name} UTF-8 metin değil.") from None
        return "text", TEXT_EXTENSIONS[ext], ext
    raise AttachmentError(415, "unsupported_type", f"{name} eklenemiyor. {SUPPORTED_TEXT}")


def _used_bytes(folder: Path) -> int:
    try:
        return sum(p.stat().st_size for p in folder.iterdir() if p.is_file() and p.suffix != ".json")
    except FileNotFoundError:
        return 0


def save(thread_id: int, filename: str | None, declared_mime: str | None, data: bytes) -> Attachment:
    name = display_name(filename)
    kind, mime, ext = classify(name, declared_mime, data)
    folder = thread_dir(thread_id)
    if _used_bytes(folder) + len(data) > THREAD_MAX_BYTES:
        raise AttachmentError(
            507, "attachments_full", "Bu sohbette zaten 200 MB ek var."
        )
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(folder.parent, 0o700)
    os.chmod(folder, 0o700)
    attachment = Attachment(
        id=uuid.uuid4().hex,
        name=name,
        mime=mime,
        bytes=len(data),
        kind=kind,
        sha256=hashlib.sha256(data).hexdigest(),
    )
    target = folder / f"{attachment.id}{ext}"
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
    meta = folder / f"{attachment.id}.json"
    fd = os.open(meta, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump({**asdict(attachment), "ext": ext}, handle)
    return attachment


def _paths(thread_id: int, attachment_id: str) -> tuple[Attachment, Path]:
    if not _ID.match(attachment_id or ""):
        raise AttachmentError(404, "attachment_not_found", "Böyle bir ek yok.")
    folder = thread_dir(thread_id)
    try:
        meta = json.loads((folder / f"{attachment_id}.json").read_text(encoding="utf-8"))
        ext = meta.pop("ext")
        attachment = Attachment(**meta)
    except (OSError, ValueError, TypeError, KeyError):
        raise AttachmentError(404, "attachment_not_found", "Böyle bir ek yok.") from None
    if ext not in set(IMAGE_TYPES.values()) | set(TEXT_EXTENSIONS):
        raise AttachmentError(404, "attachment_not_found", "Böyle bir ek yok.")
    return attachment, folder / f"{attachment_id}{ext}"


def load(thread_id: int, attachment_id: str) -> tuple[Attachment, Path]:
    attachment, path = _paths(thread_id, attachment_id)
    if not path.is_file() or path.is_symlink():
        raise AttachmentError(404, "attachment_not_found", "Böyle bir ek yok.")
    return attachment, path


def read_bytes(thread_id: int, attachment_id: str) -> tuple[Attachment, bytes]:
    attachment, path = load(thread_id, attachment_id)
    return attachment, path.read_bytes()


def resolve_for_turn(thread_id: int, ids: list[str]) -> list[tuple[Attachment, Path]]:
    if len(ids) > MAX_PER_TURN:
        raise AttachmentError(
            422, "too_many_attachments", f"Bir mesaja en çok {MAX_PER_TURN} dosya ekleyin."
        )
    unique = list(dict.fromkeys(ids))
    return [load(thread_id, attachment_id) for attachment_id in unique]


def remove_thread(thread_id: int) -> None:
    folder = thread_dir(thread_id)
    if not folder.is_dir() or folder.is_symlink():
        return
    for child in folder.iterdir():
        if child.is_file() and not child.is_symlink():
            child.unlink(missing_ok=True)
    try:
        folder.rmdir()
    except OSError:
        pass


def prompt_with_text_files(prompt: str, files: list[tuple[Attachment, Path]]) -> str:
    """The message with each attached text file appended as a fenced block."""
    parts = [prompt]
    for attachment, path in files:
        if attachment.kind != "text":
            continue
        body = path.read_text(encoding="utf-8")
        fence = "```"
        while fence in body:
            fence += "`"
        parts.append(f"Attached file {attachment.name}:\n{fence}\n{body}\n{fence}")
    return "\n\n".join(parts)
