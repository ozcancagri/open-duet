"""API mode: with a key saved for Claude or Codex, the CLI runs on a folder of its
own with that key; without one it uses the CLI's own sign-in."""
import json
from pathlib import Path

import pytest

from app.services import cli_probe, codex_adapter, engine_api_mode, local_claude_runner
from app.services.claude_adapter import ClaudeAccountAdapter, ClaudeAdapter
from app.services.codex_adapter import CodexAdapter
from app.services.local_claude_runner import RunOutput

CLAUDE_KEY = "sk-ant-api03-test"
OPENAI_KEY = "sk-proj-test"


@pytest.fixture(autouse=True)
def homes(tmp_path, monkeypatch):
    def home(engine_id):
        folder = tmp_path / engine_id
        folder.mkdir(exist_ok=True)
        return folder
    monkeypatch.setattr(engine_api_mode, "home", home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return tmp_path


def test_keys_are_checked_kept_and_cleared():
    claude = ClaudeAdapter()
    assert claude.validate_config({"api_key": f" {CLAUDE_KEY} "}, None) == {"api_key": CLAUDE_KEY}
    assert claude.validate_config({}, {"api_key": CLAUDE_KEY}) == {"api_key": CLAUDE_KEY}
    assert claude.validate_config({"clear_api_key": True}, {"api_key": CLAUDE_KEY}) == {}
    assert claude.validate_config({}, None) == {}
    for bad in ("sk-proj-openai", "sk-ant- two words"):
        with pytest.raises(ValueError):
            claude.validate_config({"api_key": bad}, None)
    assert CodexAdapter().validate_config({"api_key": OPENAI_KEY}, None) == {"api_key": OPENAI_KEY}
    with pytest.raises(ValueError):
        CodexAdapter().validate_config({"api_key": "pk-not-openai"}, None)
    assert claude.public_config({"api_key": CLAUDE_KEY}) == {"mode": "api", "has_api_key": True}
    assert claude.public_config({}) is None


async def test_claude_api_mode_runs_on_its_own_folder_and_key(homes, monkeypatch):
    seen = []

    async def get_status():
        env = local_claude_runner.child_env()
        seen.append((env.get("CLAUDE_CONFIG_DIR"), env.get("ANTHROPIC_API_KEY")))
        return local_claude_runner.CliStatus(installed=True, version="2", signed_in=True)

    monkeypatch.setattr(local_claude_runner, "get_status", get_status)
    claude = ClaudeAdapter()
    await claude.status()
    claude.config = {"api_key": CLAUDE_KEY}
    await claude.status()
    gmail = ClaudeAccountAdapter("claude_gmail", "Claude (gmail)", str(homes / "gmail"))
    gmail.config = {"api_key": CLAUDE_KEY}
    await gmail.status()
    gmail.config = None
    await gmail.status()
    assert seen == [
        (None, None),
        (str(homes / "claude"), CLAUDE_KEY),
        (str(homes / "claude_gmail"), CLAUDE_KEY),
        (str(homes / "gmail"), None),
    ]


def _claude_cli(auth: dict):
    def run_blocking(args, **_kwargs):
        if args[1:] == ["--version"]:
            return RunOutput("2.1 (Claude Code)", "", 0)
        return RunOutput(json.dumps(auth), "", 0 if auth.get("loggedIn") else 1)
    return run_blocking


def test_api_mode_is_ready_only_when_the_cli_uses_the_key(monkeypatch):
    monkeypatch.setattr(local_claude_runner, "resolve_claude_executable", lambda: Path("/fake/claude"))
    monkeypatch.setattr(local_claude_runner, "run_blocking", _claude_cli({"loggedIn": True, "authMethod": "claude.ai"}))
    assert local_claude_runner._status_blocking().signed_in is True
    with local_claude_runner.engine_env({"ANTHROPIC_API_KEY": CLAUDE_KEY}):
        status = local_claude_runner._status_blocking()
        assert status.signed_in is False and "API key" in status.error
        monkeypatch.setattr(local_claude_runner, "run_blocking", _claude_cli({"loggedIn": True, "authMethod": "api_key"}))
        assert local_claude_runner._status_blocking().signed_in is True


async def test_codex_api_mode_signs_its_folder_in_once_per_key(homes, monkeypatch):
    monkeypatch.setattr(codex_adapter, "resolve_codex_executable", lambda: Path("/fake/codex"))
    logins = []

    def run_blocking(args, *, stdin_text, cwd, **_kwargs):
        logins.append((args[1:], stdin_text, local_claude_runner.child_env().get("CODEX_HOME")))
        (Path(cwd) / "auth.json").write_text("{}")
        return RunOutput("API key saved.", "", 0)

    async def probe(args, *, timeout, **_kwargs):
        home = local_claude_runner.child_env().get("CODEX_HOME")
        if args[1:] == ["--version"]:
            return cli_probe.ProbeRun(0, "codex-cli 1.0", "")
        said = "API key configured - sk-pr***test" if home else "Logged in using ChatGPT"
        return cli_probe.ProbeRun(0, said, "")

    monkeypatch.setattr(local_claude_runner, "run_blocking", run_blocking)
    monkeypatch.setattr(cli_probe, "run", probe)
    codex = CodexAdapter()
    assert (await codex.probe(models=False)).ready
    assert logins == []
    codex.config = {"api_key": OPENAI_KEY}
    assert (await codex.probe(models=False)).ready
    assert (await codex.probe(models=False)).ready
    folder = str(homes / "codex")
    assert logins == [(["login", "--with-api-key"], OPENAI_KEY, folder)]
    codex.config = {"api_key": OPENAI_KEY + "2"}
    await codex.probe(models=False)
    assert len(logins) == 2 and logins[1][1] == OPENAI_KEY + "2"
