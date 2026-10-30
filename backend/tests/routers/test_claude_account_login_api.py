"""Sign-in and sign-out of an extra Claude account run on that account's folder
and its own sign-in controller; other engines get no Claude sign-in."""
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.core.config import settings
from app.routers.engines import get_runtime
from app.services import engine_logout, local_claude_runner
from app.services.claude_adapter import ClaudeAccountAdapter
from app.services.claude_login import ClaudeLogin
from tests.auth.test_auth_api import (  # noqa: F401
    app, factory, auth_settings, client, login, pairing_code, set_owner,
)

FOLDER = os.path.abspath("claude-gmail")


@pytest.fixture
def runtime(app, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_EXECUTION_ENABLED", True)
    monkeypatch.setattr(local_claude_runner, "resolve_claude_executable", lambda: Path("/fake/claude"))
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    seen = []

    async def start(self, owner, executable):
        seen.append(("start", local_claude_runner.child_env().get("CLAUDE_CONFIG_DIR")))
        self.flow = {"id": "b" * 32, "owner": owner, "phase": "succeeded"}
        return self.view(owner, self.flow["id"])

    async def logout(controller, engine_id, executable):
        seen.append(("logout", engine_id, local_claude_runner.child_env().get("CLAUDE_CONFIG_DIR")))

    monkeypatch.setattr(ClaudeLogin, "start", start)
    monkeypatch.setattr(engine_logout, "logout", logout)
    rt = SimpleNamespace(
        claude_login=ClaudeLogin(), claude_account_logins={}, codex_login=object(),
        adapters={"claude": object(), "claude_gmail": ClaudeAccountAdapter("claude_gmail", "Claude (gmail)", FOLDER),
                  "gemini": object()},
        _closing=False, engines=Mock(), _runs={}, _starting_turns=0, _account_changing=False,
    )
    app.dependency_overrides[get_runtime] = lambda: rt
    return rt, seen


async def test_account_sign_in_and_out_use_its_folder(app, factory, runtime):
    rt, seen = runtime
    await set_owner(factory)
    async with client(app) as owner:
        headers = {"X-CSRF-Token": (await login(owner))["csrf_token"]}
        started = await owner.post("/api/v1/engines/claude_gmail/login", headers=headers)
        assert started.status_code == 202, started.text
        assert rt.claude_login.flow is None
        assert rt.claude_account_logins["claude_gmail"].flow["id"] == started.json()["id"]
        read = await owner.get(f"/api/v1/engines/claude_gmail/login/{started.json()['id']}")
        assert read.json()["phase"] == "succeeded"
        rt.engines.forget.assert_called_with("claude_gmail")
        assert (await owner.post("/api/v1/engines/claude_gmail/logout", headers=headers)).status_code == 204
        assert (await owner.post("/api/v1/engines/claude/login", headers=headers)).status_code == 202
    assert seen == [("start", FOLDER), ("logout", "claude", FOLDER), ("start", None)]


async def test_engines_without_claude_sign_in_are_not_found(app, factory, runtime):
    await set_owner(factory)
    async with client(app) as owner:
        headers = {"X-CSRF-Token": (await login(owner))["csrf_token"]}
        for engine in ("gemini", "claude_other"):
            assert (await owner.post(f"/api/v1/engines/{engine}/login", headers=headers)).status_code == 404
            assert (await owner.post(f"/api/v1/engines/{engine}/logout", headers=headers)).status_code == 404
            assert (await owner.get(f"/api/v1/engines/{engine}/login/{'b' * 32}")).status_code == 404
