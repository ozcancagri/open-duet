"""Private, bounded device-code login. CLI output is never logged or returned."""

import asyncio
import os
import re
from pathlib import Path
from uuid import uuid4

from app.core import data_lease, engine_processes
from app.services import cli_probe
from app.services.local_claude_runner import child_env
from app.core import host_exec

DEVICE_URL = "https://auth.openai.com/codex/device"
_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_CODE = re.compile(r"(?<![A-Z0-9-])([A-Z0-9]{4,8}-[A-Z0-9]{4,8})(?![A-Z0-9-])")


class LoginError(ValueError):
    pass


class CodexLogin:
    def __init__(self):
        self.flow = None
        self.task = None
        self.lifetime = 300
        self.prompt_timeout = 30

    async def start(self, owner: str, executable: Path):
        if self.task and not self.task.done():
            raise LoginError("Zaten süren bir Codex girişi var. Önce onu tamamlayın ya da iptal edin.")
        env = child_env()
        configured_home = Path(env.get("CODEX_HOME") or str(Path.home() / ".codex"))
        if not configured_home.is_absolute():
            raise LoginError("Giriş yapmadan önce tam (mutlak) bir CODEX_HOME yolu kullanın.")
        home = configured_home.resolve()
        home.mkdir(parents=True, exist_ok=True)
        fd = os.open(home / ".open-dots-login.lock", os.O_RDWR | os.O_CREAT, 0o600)
        if not data_lease._try_lock(fd):
            os.close(fd)
            raise LoginError("Bu sunucuda zaten süren bir Codex girişi var.")
        self.flow = {"id": uuid4().hex, "owner": owner, "phase": "running"}
        flow = self.flow
        self.task = asyncio.create_task(self._run(flow, executable.resolve(), env))
        def release(task):
            if task.cancelled():
                flow["phase"] = "cancelled"
            flow.pop("user_code", None)
            flow.pop("authorization_url", None)
            data_lease._unlock(fd)
            os.close(fd)
        self.task.add_done_callback(release)
        return self.view(owner, flow["id"])

    def view(self, owner: str, flow_id: str):
        if not self.flow or self.flow["owner"] != owner or self.flow["id"] != flow_id:
            raise KeyError("Giriş bulunamadı")
        return {key: value for key, value in self.flow.items() if key != "owner"}

    async def cancel(self, owner: str, flow_id: str):
        self.view(owner, flow_id)
        await self.close()

    async def close(self):
        if self.task and not self.task.done():
            if not self.task.cancelling():
                self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)

    async def _run(self, flow, executable, env):
        proc = None
        result = {"phase": "failed"}
        try:
            # An existing working account is never silently replaced.
            status = await cli_probe.run([str(executable), "login", "status"], timeout=8, env=env)
            said = status.stdout + "\n" + status.stderr
            if status.ok and re.search(r"^\s*logged in\b", said, re.I | re.M):
                result = {"phase": "succeeded"}
                return
            if status.failed_to_start or status.timed_out or not re.search(r"^\s*not logged in\b", said, re.I | re.M):
                raise LoginError("Codex hesap durumunu doğrulayamadı. Sunucudaki kurulumunu kontrol edin.")
            host_exec.ensure_allowed("motor girişi")
            starting = asyncio.create_task(asyncio.create_subprocess_exec(
                str(executable), "login", "--device-auth", stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                env=env, cwd=str(Path.home()), start_new_session=os.name != "nt",
            ))
            # If cancellation arrives during OS process creation, retain the
            # resulting child so the finally block can kill and reap it.
            try:
                proc = await asyncio.shield(starting)
            except asyncio.CancelledError:
                proc = await starting
                raise
            await asyncio.to_thread(engine_processes.record, proc.pid, str(executable))
            async def receive():
                output = b""
                async with asyncio.timeout(self.prompt_timeout):
                    while "user_code" not in flow:
                        chunk = await proc.stdout.read(1024)
                        if not chunk:
                            raise LoginError("Codex bir cihaz kodu vermedi. CLI'ı güncelleyin ve ChatGPT güvenlik ayarlarınızda cihaz koduyla girişi açın.")
                        output += chunk
                        if len(output) > 16384:
                            raise LoginError("Codex çok fazla giriş çıktısı döndürdü.")
                        text = _ANSI.sub("", output.decode("utf-8", "replace"))
                        code = next((_CODE.search(line) for line in text.split("\n")[:-1] if _CODE.search(line)), None)
                        if re.search(r"https://auth\.openai\.com/codex/device(?=[\s\x1b]|$)", text) and code:
                            flow.update(authorization_url=DEVICE_URL, user_code=code[1])
                # Keep draining without retaining arbitrary provider output.
                total = len(output)
                while chunk := await proc.stdout.read(1024):
                    total += len(chunk)
                    if total > 32768:
                        raise LoginError("Codex çok fazla giriş çıktısı döndürdü.")
                if await proc.wait() != 0:
                    raise LoginError("Codex girişi tamamlanmadı. ChatGPT'de cihaz koduyla girişi açıp yeniden deneyin.")
                checked = await cli_probe.run([str(executable), "login", "status"], timeout=8, env=env)
                if not checked.ok or not re.search(r"^\s*logged in\b", checked.stdout + "\n" + checked.stderr, re.I | re.M):
                    raise LoginError("Codex yeni hesabı doğrulamadı. Sunucudaki durumunu kontrol edin.")
            await asyncio.wait_for(receive(), timeout=self.lifetime)
            result = {"phase": "succeeded"}
        except asyncio.CancelledError:
            result = {"phase": "cancelled"}
        except TimeoutError:
            result = {"phase": "expired", "error": "Codex girişi zaman aşımına uğradı. Yeni bir kod için yeniden başlatın."}
        except LoginError as exc:
            result = {"phase": "failed", "error": str(exc)}
        except Exception:
            result = {"phase": "failed", "error": "Codex girişi başlatılamadı. Sunucudaki CLI kurulumunu kontrol edin."}
        finally:
            if proc:
                cli_probe.kill_group(proc)
                try:
                    await asyncio.wait_for(proc.wait(), 2)
                except TimeoutError:
                    pass
                engine_processes.forget(proc.pid)
            flow.pop("user_code", None)
            flow.pop("authorization_url", None)
            flow.update(result)
