"""Bounded CLI sign-out, serialized with the engine's browser sign-in."""

import asyncio
import json
import os
import re
from pathlib import Path

from app.core import data_lease
from app.services import cli_probe
from app.services.codex_login import LoginError
from app.services.local_claude_runner import child_env


async def logout(controller, engine_id: str, executable: Path):
    if controller.task and not controller.task.done():
        raise LoginError("Önce bekleyen hesap işlemini tamamlayın ya da iptal edin.")
    env = child_env()
    variable, folder = ("CODEX_HOME", ".codex") if engine_id == "codex" else ("CLAUDE_CONFIG_DIR", ".claude")
    home = Path(env.get(variable) or str(Path.home() / folder))
    if not home.is_absolute():
        raise LoginError("Tam (mutlak) bir motor hesap klasörü kullanın.")
    home = home.resolve()
    home.mkdir(parents=True, exist_ok=True)
    fd = os.open(home / ".open-dots-login.lock", os.O_RDWR | os.O_CREAT, 0o600)
    if not data_lease._try_lock(fd):
        os.close(fd)
        raise LoginError("Başka bir hesap işlemi sürüyor.")
    # Reserve before yielding. start(), close(), and another controller using
    # this credential home all see the same operation/lock.
    controller.flow = None
    controller.task = asyncio.create_task(_run(engine_id, executable.resolve(), env))

    def release(_task):
        data_lease._unlock(fd)
        os.close(fd)

    controller.task.add_done_callback(release)
    await controller.task


async def _run(engine_id, executable, env):
    args = [str(executable)]
    args += ["logout"] if engine_id == "codex" else ["auth", "logout"]
    result = await _probe(args, timeout=10, env=env)
    if not result.ok:
        raise LoginError("CLI çıkışı tamamlamadı. Kurulumunu kontrol edip yeniden deneyin.")
    args = [str(executable)]
    args += ["login", "status"] if engine_id == "codex" else ["auth", "status", "--json"]
    result = await _probe(args, timeout=8, env=env)
    confirmed = False
    if not result.timed_out and not result.failed_to_start and result.exit_code == 1:
        if engine_id == "codex":
            confirmed = bool(re.search(r"^\s*not logged in\b", result.stdout + "\n" + result.stderr, re.I | re.M))
        else:
            try:
                confirmed = json.loads(result.stdout).get("loggedIn") is False
            except (ValueError, AttributeError):
                pass
    if not confirmed:
        raise LoginError("CLI çıkışı doğrulayamadı. Bir ortam değişkenindeki anahtar bu motoru hâlâ bağlıyor olabilir.")


async def _probe(args, *, timeout, env):
    # Do not interrupt the probe between OS creation and process registration.
    # On cancellation it completes its bounded run/kill/reap before the account
    # lock is released. Shutdown may wait up to this probe's timeout (+2s reap).
    task = asyncio.create_task(cli_probe.run(args, timeout=timeout, env=env))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise
