"""Extra Claude accounts: each is its own engine, and everything it starts runs
with that account's CLAUDE_CONFIG_DIR."""
import os

import pytest
from fastapi.concurrency import run_in_threadpool

from app.services import engine_registry, local_claude_runner
from app.services.claude_adapter import ClaudeAccountAdapter, ClaudeAdapter, account_dir
from app.services.engine_registry import CLAUDE_ACCOUNTS_VARIABLE, claude_accounts

FOLDER = os.path.abspath("claude-gmail")
OTHER = os.path.abspath("claude-work")


def test_accounts_are_read_from_the_variable():
    environ = {CLAUDE_ACCOUNTS_VARIABLE: f" Gmail = {FOLDER} ; work={OTHER};"}
    assert claude_accounts(environ) == [
        ("claude_gmail", "Claude (gmail)", FOLDER),
        ("claude_work", "Claude (work)", OTHER),
    ]
    assert claude_accounts({}) == []


@pytest.mark.parametrize("entry", [
    "gmail=relative/folder", "=" + FOLDER, "bad name=" + FOLDER, "x" * 21 + "=" + FOLDER, "gmail",
])
def test_malformed_entries_are_skipped(entry):
    assert claude_accounts({CLAUDE_ACCOUNTS_VARIABLE: entry}) == []


def test_a_repeated_name_keeps_the_first_folder():
    environ = {CLAUDE_ACCOUNTS_VARIABLE: f"gmail={FOLDER};gmail={OTHER}"}
    assert claude_accounts(environ) == [("claude_gmail", "Claude (gmail)", FOLDER)]


def test_accounts_are_listed_right_after_claude(monkeypatch):
    monkeypatch.setenv(CLAUDE_ACCOUNTS_VARIABLE, f"gmail={FOLDER}")
    keys = list(engine_registry.default_adapters())
    assert keys[keys.index("claude") + 1] == "claude_gmail"
    adapter = engine_registry.default_adapters()["claude_gmail"]
    assert isinstance(adapter, ClaudeAccountAdapter)
    assert account_dir(adapter) == FOLDER
    assert account_dir(ClaudeAdapter()) is None
    # The sign-in hint names this account's folder, not the default account.
    assert FOLDER in adapter.setup["sign_in"] and ClaudeAdapter.setup["sign_in"] == "claude auth login"


async def test_processes_started_for_an_account_get_its_folder(monkeypatch):
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    assert "CLAUDE_CONFIG_DIR" not in local_claude_runner.child_env()
    with local_claude_runner.account(FOLDER):
        assert local_claude_runner.child_env()["CLAUDE_CONFIG_DIR"] == FOLDER
        # Runs and status checks start their processes from worker threads.
        env = await run_in_threadpool(local_claude_runner.child_env)
        assert env["CLAUDE_CONFIG_DIR"] == FOLDER
    assert "CLAUDE_CONFIG_DIR" not in local_claude_runner.child_env()


async def test_the_account_adapter_checks_its_own_account(monkeypatch):
    seen = []

    async def get_status():
        seen.append(local_claude_runner.child_env().get("CLAUDE_CONFIG_DIR"))
        return local_claude_runner.CliStatus(installed=True, version="2", signed_in=True)

    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    monkeypatch.setattr(local_claude_runner, "get_status", get_status)
    assert (await ClaudeAccountAdapter("claude_gmail", "Claude (gmail)", FOLDER).status()).ready
    await ClaudeAdapter().status()
    assert seen == [FOLDER, None]
