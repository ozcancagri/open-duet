"""API mode for the Claude and Codex engines.

With an API key saved for the engine in Open Duet (Settings → Engines, encrypted
like every credential), its CLI runs on a folder of its own (CLAUDE_CONFIG_DIR or
CODEX_HOME) with that key, so turns are billed to API credits. The subscription
signed in to the CLI's default folder is then neither used nor changed, and the
person keeps it for the CLI's own apps. Without a key the engine uses the CLI's
sign-in, as before.
"""

import hashlib
from pathlib import Path

from app.desktop import profile


def field(help_text: str) -> dict:
    return {"name": "api_key", "label": "API anahtarı", "kind": "secret", "help": help_text}


def key_of(config: dict | None) -> str | None:
    key = (config or {}).get("api_key")
    return key if isinstance(key, str) and key else None


def validate(payload: dict, current: dict | None, *, prefix: str, service: str) -> dict:
    """The configuration to save: the new key, the saved one kept when none is
    given, or nothing (back to the CLI's sign-in) with `clear_api_key`."""
    if payload.get("clear_api_key"):
        return {}
    key = payload.get("api_key")
    if isinstance(key, str) and key.strip():
        key = key.strip()
        if len(key) > 4096 or any(ord(c) < 33 for c in key):
            raise ValueError("Anahtar boşluksuz tek bir satır olmalı.")
        if not key.startswith(prefix):
            raise ValueError(f"Bu bir {service} API anahtarına benzemiyor ({prefix} ile başlar).")
        return {"api_key": key}
    return {"api_key": current["api_key"]} if key_of(current) else {}


def public(config: dict | None) -> dict | None:
    """What the API says about the configuration: the mode, never the key."""
    return {"mode": "api", "has_api_key": True} if key_of(config) else None


def home(engine_id: str) -> Path:
    """The engine's own folder for API mode, next to this app's data."""
    current = profile.current()
    base = current.data_dir if current is not None else Path.home() / ".open-duet"
    folder = base / "engine-api" / engine_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()
