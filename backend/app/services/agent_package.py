"""An agent as one portable file, to keep or to give to someone else.

The file is an allowlist, not a dump of the row. It can carry only:

- the agent's name, title, description and instructions;
- optionally its notes (MEMORY.md), as starter notes for the copy;
- optionally its saved skills, as text only (name, description, instructions).
  An imported skill always starts turned off.

It has no field for a model, a provider, a folder, an approval mode, a pin,
conversation history, or anything about this computer. Whatever a file says
beyond the allowlist is dropped on import, so a hand-edited file can never
widen what an imported agent may do: it always starts on `ask`, with the
default model and its own new folder.

Every text part passes through the notes' secret redaction on the way out and
again on the way in; export reports which parts were changed.
"""

import json
from datetime import UTC, datetime
from typing import Any

from app.schemas.agent import INSTRUCTIONS_MAX_BYTES
from app.services import agent_skills, memory_topics
from app.services.agent_memory import FILE_MAX_BYTES, redact_secrets

FORMAT = "open-dots.agent"
VERSION = 1
# All topic notes together, so the file stays well inside PACKAGE_MAX_BYTES.
TOPICS_MAX_BYTES = 600_000
# The whole file, as JSON text.
PACKAGE_MAX_BYTES = 1_000_000
# All skills together.
SKILLS_MAX_BYTES = 300_000

_LIMITS = {"name": 80, "title": 200, "description": 4000}


class PackageError(ValueError):
    pass


def _clean(value: str | None) -> tuple[str | None, bool]:
    if value is None:
        return None, False
    text, count = redact_secrets(value)
    return text, count > 0


def export_package(
    agent,
    notes: str | None,
    topics: dict[str, str] | None = None,
    skipped: list[str] | None = None,
    skills: list[dict] | None = None,
) -> tuple[dict, list[str]]:
    """The file for `agent`, and the names of the parts that had something
    redacted. `notes` None leaves the notes out; `topics` (file name -> text)
    are the topic notes that travel with them. A topic note the file's caps
    cannot hold (over 64 KB, past 100 notes, or past 600 KB together) is left
    out and its name appended to `skipped`."""
    redacted: list[str] = []
    body: dict[str, Any] = {"name": agent.name}
    for field in ("title", "description", "instructions"):
        value, changed = _clean(getattr(agent, field))
        if value:
            body[field] = value
        if changed:
            redacted.append(field)
    document: dict[str, Any] = {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "agent": body,
    }
    if notes is not None and notes.strip():
        text, changed = _clean(notes)
        document["notes"] = {"MEMORY.md": text}
        if changed:
            redacted.append("notes")
    if notes is not None and topics:
        clean: dict[str, str] = {}
        total = 0
        for name, body_text in sorted(topics.items()):
            cleaned, changed = _clean(body_text)
            if cleaned.strip():
                size = len(cleaned.encode("utf-8"))
                if (
                    size > memory_topics.TOPIC_MAX_BYTES
                    or len(clean) >= memory_topics.MAX_TOPICS
                    or total + size > TOPICS_MAX_BYTES
                ):
                    if skipped is not None:
                        skipped.append(name)
                    continue
                clean[name] = cleaned
                total += size
            if changed and "topic notes" not in redacted:
                redacted.append("topic notes")
        if clean:
            document.setdefault("notes", {})["topics"] = clean
    if skills:
        kept, total = [], 0
        for item in skills:
            description, d_changed = _clean(item["description"])
            body_text, b_changed = _clean(item["body"])
            size = len(body_text.encode("utf-8"))
            if len(kept) >= agent_skills.MAX_SKILLS or total + size > SKILLS_MAX_BYTES:
                if skipped is not None:
                    skipped.append("skill " + item["name"])
                continue
            kept.append({"name": item["name"], "description": description, "body": body_text})
            total += size
            if (d_changed or b_changed) and "skills" not in redacted:
                redacted.append("skills")
        if kept:
            document["skills"] = kept
    return document, redacted


def file_name(agent_name: str) -> str:
    """A safe file name for the download, from the agent's name."""
    stem = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in agent_name.strip().lower())
    stem = "-".join(part for part in stem.split("-") if part)[:60] or "agent"
    return f"{stem}.agent.json"


def _text(container: dict, field: str, *, required: bool = False) -> str | None:
    value = container.get(field)
    if value is None or (isinstance(value, str) and not value.strip() and not required):
        if required:
            raise PackageError(f"agent.{field} zorunlu")
        return None
    if not isinstance(value, str):
        raise PackageError(f"agent.{field} metin olmalı")
    return value


def _parse_skills(raw: Any) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > agent_skills.MAX_SKILLS:
        raise PackageError(f"skills en çok {agent_skills.MAX_SKILLS} beceriden oluşan bir liste olmalı")
    out, seen, total = [], set(), 0
    for item in raw:
        if not isinstance(item, dict):
            raise PackageError("her beceri bir nesne olmalı")
        name, description, body = item.get("name"), item.get("description"), item.get("body")
        try:
            agent_skills.check_name(name)
        except agent_skills.SkillError:
            raise PackageError(f"{name!r} bir beceri adı değil") from None
        if name in seen:
            raise PackageError(f"{name} becerisi iki kez geçiyor")
        seen.add(name)
        if not isinstance(description, str) or not isinstance(body, str):
            raise PackageError(f"{name} becerisinin metin olarak açıklaması ve talimatları olmalı")
        try:
            description, body, _, _ = agent_skills._clean(description, body, "imported")
        except agent_skills.SkillError as exc:
            raise PackageError(f"skill {name}: {exc.message}") from None
        total += len(body.encode("utf-8"))
        if total > SKILLS_MAX_BYTES:
            raise PackageError("Beceriler toplamda 300 KB'tan büyük.")
        out.append({"name": name, "description": description, "body": body})
    return out


def parse_package(document: Any) -> dict:
    """What an import may use from `document`:
    `{name, title, description, instructions, notes, topics, skills}`. Raises PackageError."""
    if not isinstance(document, dict):
        raise PackageError("Bu bir ajan dosyası değil.")
    if document.get("format") != FORMAT:
        raise PackageError("Bu bir ajan dosyası değil.")
    if document.get("version") != VERSION:
        raise PackageError(f"Bu ajan dosyasının sürümü {document.get('version')!r}; bu uygulama {VERSION} sürümünü okur.")
    if len(json.dumps(document, ensure_ascii=False).encode("utf-8")) > PACKAGE_MAX_BYTES:
        raise PackageError("Ajan dosyası 1 MB'tan büyük.")
    body = document.get("agent")
    if not isinstance(body, dict):
        raise PackageError("Ajan dosyasında ajan yok.")

    name = _text(body, "name", required=True).strip()
    if not name:
        raise PackageError("agent.name zorunlu")
    if "\n" in name or "\r" in name:
        raise PackageError("agent.name tek satıra sığmalı")
    title = _text(body, "title")
    if title is not None:
        title = title.strip()
        if "\n" in title or "\r" in title:
            raise PackageError("agent.title tek satıra sığmalı")
    description = _text(body, "description")
    instructions = _text(body, "instructions") or ""
    for field, value in (("name", name), ("title", title), ("description", description)):
        if value is not None and len(value) > _LIMITS[field]:
            raise PackageError(f"agent.{field} en çok {_LIMITS[field]} karakter olmalı")
    if len(instructions.encode("utf-8")) > INSTRUCTIONS_MAX_BYTES:
        raise PackageError(f"agent.instructions en çok {INSTRUCTIONS_MAX_BYTES} bayt olmalı")

    notes = None
    topics: dict[str, str] = {}
    raw_notes = document.get("notes")
    if raw_notes is not None:
        if not isinstance(raw_notes, dict) or not isinstance(raw_notes.get("MEMORY.md", ""), str):
            raise PackageError("notes {\"MEMORY.md\": metin} biçiminde olmalı")
        notes = raw_notes.get("MEMORY.md") or None
        if notes is not None and len(notes.encode("utf-8")) > FILE_MAX_BYTES:
            raise PackageError(f"Notlar en çok {FILE_MAX_BYTES // 1024} KB olmalı.")
        raw_topics = raw_notes.get("topics")
        if raw_topics is not None:
            if not isinstance(raw_topics, dict) or len(raw_topics) > memory_topics.MAX_TOPICS:
                raise PackageError(f"notes.topics en çok {memory_topics.MAX_TOPICS} konu notu içermeli")
            for name, value in raw_topics.items():
                try:
                    memory_topics.check_name(name)
                except memory_topics.InvalidTopicName:
                    raise PackageError(f"{name!r} bir konu notu adı değil") from None
                if name == memory_topics.ARCHIVE_NAME or not isinstance(value, str):
                    raise PackageError(f"{name} konu notu metin olmalı")
                if len(value.encode("utf-8")) > memory_topics.TOPIC_MAX_BYTES:
                    raise PackageError(f"{name} konu notu en çok {memory_topics.TOPIC_MAX_BYTES // 1024} KB olmalı")
            if sum(len(v.encode("utf-8")) for v in raw_topics.values()) > TOPICS_MAX_BYTES:
                raise PackageError("Konu notları toplamda 600 KB'tan büyük.")
            topics = {n: _clean(v)[0] for n, v in raw_topics.items() if v.strip()}

    skills = _parse_skills(document.get("skills"))

    return {
        "skills": skills,
        "name": name,
        "title": title or None,
        "description": _clean(description)[0] or None,
        "instructions": _clean(instructions)[0] or "",
        "notes": _clean(notes)[0] if notes else None,
        "topics": topics,
    }
