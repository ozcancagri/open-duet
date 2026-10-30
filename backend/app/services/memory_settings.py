"""Memory upkeep settings that belong to the whole installation rather than to
one agent (docs/MEMORY.md): whether room conversations feed an agent's notes,
the hour after which the daily tidy-up runs, and which model each engine uses
for the quick background calls.

Kept in one small file beside the journal, outside every agent's folder. A
missing or damaged file means the defaults.
"""

import json
import re

from app.core.config import settings
from app.core.logging import get_logger
from app.services import agent_memory, memory_journal

logger = get_logger(__name__)

MODEL_MAX = 80
ENGINE_MAX = 40


def _path():
    return memory_journal.state_root() / "settings.json"


def _read() -> dict:
    try:
        data = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _hour(value) -> int | None:
    """0 to 23, or 24 for "never" (the same meaning as MEMORY_TIDY_HOUR=24)."""
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 24 else None


def learn_from_rooms() -> bool:
    return _read().get("learn_from_rooms") is True


def tidy_hour() -> int:
    """The local hour after which the daily tidy-up may run; 24 means never."""
    saved = _hour(_read().get("tidy_hour"))
    return saved if saved is not None else min(24, max(0, int(settings.MEMORY_TIDY_HOUR)))


def helper_models() -> dict[str, str]:
    raw = _read().get("helper_models")
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, str) and k and v}


def helper() -> dict | None:
    """The saved helper (docs/MEMORY.md, "The helper model"): `{"engine", "model"}`
    or None. The environment's `HELPER_ENGINE` is applied by side_jobs.configured()."""
    raw = _read().get("helper")
    if not isinstance(raw, dict) or not isinstance(raw.get("engine"), str) or not raw["engine"]:
        return None
    model = raw.get("model")
    return {"engine": raw["engine"], "model": model if isinstance(model, str) else ""}


def read() -> dict:
    from app.services import side_jobs

    active = side_jobs.configured()
    return {
        "learn_from_rooms": learn_from_rooms(),
        "tidy_hour": tidy_hour(),
        "helper_models": helper_models(),
        "helper": helper(),
        # What is in force: the environment can set or switch off the saved helper.
        "helper_active": {"engine": active.engine, "model": active.model, "source": active.source} if active else None,
    }


class InvalidSetting(ValueError):
    pass


def _clean_helper(value) -> dict | None:
    """`{"engine": "claude", "model": "claude-haiku-4-5"}`; None or an empty engine removes it."""
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {"engine", "model"}:
        raise InvalidSetting("Yardımcı bir motordur ve isteğe bağlı olarak o motorun modellerinden biridir.")
    engine, model = value.get("engine"), value.get("model") or ""
    if not isinstance(engine, str) or not isinstance(model, str):
        raise InvalidSetting("Yardımcı bir motordur ve isteğe bağlı olarak o motorun modellerinden biridir.")
    engine, model = engine.strip(), " ".join(model.split())
    if not engine:
        return None
    if len(engine) > ENGINE_MAX or len(model) > MODEL_MAX or not re.match(r"^[A-Za-z0-9_.-]+$", engine):
        raise InvalidSetting("Yardımcı motor tek bir motor kimliğidir; modeli en çok 80 karakter olabilir.")
    if model and not re.match(r"^[A-Za-z0-9][\x21-\x7e]*$", model):
        raise InvalidSetting("Model adı tek bir sözcüktür ve tireyle başlayamaz.")
    return {"engine": engine, "model": model}


def update(*, learn_from_rooms=None, tidy_hour=None, helper_models=None, **more) -> dict:
    """Change the given settings. `helper_models` replaces the whole map; an
    empty model name removes that engine's entry. Raises InvalidSetting."""
    data = _read()
    if learn_from_rooms is not None:
        if not isinstance(learn_from_rooms, bool):
            raise InvalidSetting("Grup sohbetlerinden öğrenme açık ya da kapalı olmalı.")
        data["learn_from_rooms"] = learn_from_rooms
    if tidy_hour is not None:
        if _hour(tidy_hour) is None:
            raise InvalidSetting("Düzenleme saati 0 ile 23 arasında tam bir saattir; kapatmak için 24 girin.")
        data["tidy_hour"] = tidy_hour
    if "helper" in more:
        data["helper"] = _clean_helper(more.pop("helper"))
    if more:
        raise InvalidSetting("Bilinmeyen ayar.")
    if helper_models is not None:
        if not isinstance(helper_models, dict):
            raise InvalidSetting("Yardımcı modeller her motor için bir model adıdır.")
        clean: dict[str, str] = {}
        for engine, model in helper_models.items():
            if not isinstance(engine, str) or not isinstance(model, str):
                raise InvalidSetting("Yardımcı modeller her motor için bir model adıdır.")
            engine, model = engine.strip(), " ".join(model.split())
            if not engine or len(engine) > ENGINE_MAX or len(model) > MODEL_MAX or model.startswith("-"):
                raise InvalidSetting(f"Model adı en çok {MODEL_MAX} karakterdir ve tireyle başlayamaz.")
            if model:
                clean[engine] = model
        data["helper_models"] = clean
    try:
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        agent_memory.write_atomic(path, json.dumps(data))
    except OSError:
        logger.exception("could not save the memory settings")
        raise InvalidSetting("Ayarlar kaydedilemedi.") from None
    return read()
