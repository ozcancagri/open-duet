"""When a routine runs: schedule kinds, next occurrences, and a plain-language
summary. Pure: no database, no clock (callers pass `after`).

Kinds and their `spec`:

    cron      {"expression": "0 9 * * 1-5"}           five fields, Sunday = 0
    weekdays  {"days": [1, 2, 3, 4, 5], "time": "09:00"}
    interval  {"every_minutes": 90, "anchor": "<ISO datetime>"}
    once      {"at": "<ISO datetime>"}                no offset: the routine's zone
    manual    {}                                      Run now and webhooks only

Wall-clock kinds (cron, weekdays) are evaluated in the routine's IANA zone. A
time inside a spring-forward gap fires after the gap at the same offset; a
time in the repeated autumn hour fires once, at its first occurrence. Interval
counts elapsed minutes from its anchor and ignores clock changes.
"""

import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.services.schedule_service import _crontab_trigger

KINDS = ("cron", "weekdays", "interval", "once", "manual")
MIN_INTERVAL_MINUTES = 5
MAX_INTERVAL_MINUTES = 7 * 24 * 60
DAY_NAMES = ("Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt")
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
# Bounds the search when every candidate falls on a skipped repeated hour.
_MAX_SKIPS = 200


class InvalidSchedule(ValueError):
    pass


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise InvalidSchedule(f"Bilinmeyen saat dilimi: {name!r}") from None


def _parse_datetime(value, tz: ZoneInfo, what: str) -> datetime:
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str) and value.strip():
        try:
            moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            raise InvalidSchedule(f"{what} ISO biçiminde bir tarih ve saat olmalı") from None
    else:
        raise InvalidSchedule(f"{what} zorunlu")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=tz)
    return moment.astimezone(UTC)


def _days(value) -> list[int]:
    if not isinstance(value, list) or not value:
        raise InvalidSchedule("En az bir gün seçin")
    days = set()
    for day in value:
        if not isinstance(day, int) or isinstance(day, bool) or not 0 <= day <= 6:
            raise InvalidSchedule("Günler 0 (Pazar) ile 6 (Cumartesi) arasında sayılardır")
        days.add(day)
    return sorted(days)


def normalize(kind: str, spec: dict | None, timezone: str, *, now: datetime) -> dict:
    """A clean copy of `spec` for `kind`, or InvalidSchedule saying what is wrong."""
    tz = zone(timezone)
    spec = dict(spec or {})
    if kind == "cron":
        expression = spec.get("expression")
        if not isinstance(expression, str) or len(expression.split()) != 5:
            raise InvalidSchedule("Bir cron ifadesinin beş alanı vardır: dakika saat gün ay haftanın günü")
        expression = " ".join(expression.split())
        try:
            _crontab_trigger(expression, tz)
        except ValueError as exc:
            raise InvalidSchedule(f"Geçersiz cron ifadesi: {exc}") from None
        return {"expression": expression}
    if kind == "weekdays":
        time = spec.get("time")
        if not isinstance(time, str) or not _TIME.match(time):
            raise InvalidSchedule("Saat SS:DD (24 saat) biçiminde olmalı")
        return {"days": _days(spec.get("days")), "time": time}
    if kind == "interval":
        every = spec.get("every_minutes")
        if not isinstance(every, int) or isinstance(every, bool) or not (
            MIN_INTERVAL_MINUTES <= every <= MAX_INTERVAL_MINUTES
        ):
            raise InvalidSchedule(
                f"Aralık {MIN_INTERVAL_MINUTES} ile {MAX_INTERVAL_MINUTES} arasında tam sayı (dakika) olmalı"
            )
        anchor = spec.get("anchor")
        anchor_at = _parse_datetime(anchor, tz, "Başlangıç") if anchor else now.astimezone(UTC).replace(second=0, microsecond=0)
        return {"every_minutes": every, "anchor": anchor_at.isoformat()}
    if kind == "once":
        return {"at": _parse_datetime(spec.get("at"), tz, "Tarih ve saat").isoformat()}
    if kind == "manual":
        return {}
    raise InvalidSchedule(f"Zamanlama türü şunlardan biri olmalı: {', '.join(KINDS)}")


def _cron_expression(kind: str, spec: dict) -> str:
    if kind == "cron":
        return spec["expression"]
    hour, minute = spec["time"].split(":")
    return f"{int(minute)} {int(hour)} * * {','.join(str(d) for d in spec['days'])}"


def _second_of_repeated_hour(moment: datetime, tz: ZoneInfo) -> bool:
    """True when `moment` is the later of two instants with the same wall clock."""
    local = moment.astimezone(tz)
    naive = local.replace(tzinfo=None)
    first = naive.replace(tzinfo=tz, fold=0)
    second = naive.replace(tzinfo=tz, fold=1)
    if first.utcoffset() == second.utcoffset():
        return False
    return local.utcoffset() == second.utcoffset()


def _carried_gap_after(expression: str, tz: ZoneInfo, after: datetime) -> datetime | None:
    """Find a still-future occurrence from a recent skipped wall-clock interval."""
    # UTC offsets are less than 24 hours in magnitude, so a gap's carried
    # occurrence cannot remain future for 48 hours. The supported IANA dataset
    # has no offset transitions closer than this window (checked in qualification).
    local_now = after.astimezone(tz)
    previous = (after - timedelta(hours=48)).astimezone(tz)
    change = local_now.utcoffset() - previous.utcoffset()
    if change <= timedelta(0):
        return None
    # Under the same one-transition window, the last carried instant is
    # expired once the entire forward shift lies in the new offset.
    if (after - change).astimezone(tz).utcoffset() == local_now.utcoffset():
        return None

    # Evaluate the same calendar fields in UTC to walk the missing *wall*
    # times. Walking in the real zone would normalize into the post-gap hour
    # and lose the remaining imaginary times again.
    wall_end = local_now.replace(tzinfo=UTC)
    cursor = wall_end - change
    shadow = _crontab_trigger(expression, ZoneInfo("UTC"))
    # Five-field cron can match at most once a minute in this <48-hour window.
    for _ in range(48 * 60 + 1):
        wall = shadow.get_next_fire_time(None, cursor)
        if wall is None or wall > wall_end:
            return None
        naive = wall.replace(tzinfo=None)
        carried = naive.replace(tzinfo=tz, fold=0).astimezone(UTC)
        roundtrip = carried.astimezone(tz).replace(tzinfo=None)
        if roundtrip > naive and carried > after:
            return carried
        cursor = wall + timedelta(microseconds=1)
    raise InvalidSchedule("Saat değişikliği araması sınırlı aralığını aştı")


def next_after(kind: str, spec: dict, timezone: str, after: datetime) -> datetime | None:
    """The first occurrence strictly after `after` (UTC), or None if there is none."""
    after = after.astimezone(UTC)
    tz = zone(timezone)
    if kind == "manual":
        return None
    if kind == "once":
        at = datetime.fromisoformat(spec["at"]).astimezone(UTC)
        return at if at > after else None
    if kind == "interval":
        anchor = datetime.fromisoformat(spec["anchor"]).astimezone(UTC)
        step = timedelta(minutes=spec["every_minutes"])
        if anchor > after:
            return anchor
        elapsed = (after - anchor) // step
        return anchor + (elapsed + 1) * step
    expression = _cron_expression(kind, spec)
    carried = _carried_gap_after(expression, tz, after)
    trigger = _crontab_trigger(expression, tz)
    cursor = after
    for _ in range(_MAX_SKIPS):
        # get_next_fire_time is inclusive of its `now`; nudge past it.
        candidate = trigger.get_next_fire_time(None, cursor + timedelta(microseconds=1))
        if candidate is None:
            return carried
        candidate = candidate.astimezone(UTC)
        if not _second_of_repeated_hour(candidate, tz):
            return min(candidate, carried) if carried is not None else candidate
        cursor = candidate
    return carried


def next_dates(kind: str, spec: dict, timezone: str, after: datetime, count: int = 3) -> list[datetime]:
    dates: list[datetime] = []
    cursor = after
    while len(dates) < count:
        upcoming = next_after(kind, spec, timezone, cursor)
        if upcoming is None:
            break
        dates.append(upcoming)
        cursor = upcoming
    return dates


def latest_due(
    kind: str, spec: dict, timezone: str, first_due: datetime, now: datetime, limit: int = 10_000
) -> tuple[datetime, int]:
    """The newest occurrence at or before `now`, starting from `first_due`, and
    how many occurrences before it were passed over. `first_due` must be due."""
    latest, passed = first_due, 0
    if kind == "interval":
        step = timedelta(minutes=spec["every_minutes"])
        skipped = (now - first_due) // step
        return first_due + skipped * step, int(skipped)
    while passed < limit:
        upcoming = next_after(kind, spec, timezone, latest)
        if upcoming is None or upcoming > now:
            break
        latest, passed = upcoming, passed + 1
    return latest, passed


def _day_list(days: list[int]) -> str:
    if days == [0, 1, 2, 3, 4, 5, 6]:
        return "Her gün"
    if days == [1, 2, 3, 4, 5]:
        return "Pzt–Cum"
    if days == [0, 6]:
        return "Hafta sonları"
    return ", ".join(DAY_NAMES[d] for d in days)


def _cron_summary(expression: str) -> str | None:
    minute, hour, day, month, weekday = expression.split()
    if expression == "* * * * *":
        return "Her dakika"
    step = re.fullmatch(r"\*/(\d+)", minute)
    if step and hour == day == month == weekday == "*":
        return f"Her {int(step.group(1))} dakikada bir"
    if minute.isdigit() and hour == day == month == weekday == "*":
        return f"Her saat başı :{int(minute):02d} geçe"
    if not (minute.isdigit() and hour.isdigit()):
        return None
    at = f"{int(hour):02d}:{int(minute):02d}"
    if day == month == "*":
        if weekday == "*":
            return f"Her gün, saat {at}"
        if weekday in ("1-5", "MON-FRI", "mon-fri"):
            return f"Pzt–Cum, saat {at}"
        if re.fullmatch(r"[0-6](,[0-6])*", weekday):
            return f"{_day_list(sorted({int(d) for d in weekday.split(',')}))}, saat {at}"
        return None
    if day.isdigit() and month == "*" and weekday == "*":
        return f"Her ayın {int(day)}. günü, saat {at}"
    return None


def summary(kind: str, spec: dict, timezone: str) -> str:
    """One line a person can read, e.g. "Mon–Fri at 09:00 (Europe/Berlin)"."""
    if kind == "manual":
        return "Yalnız elle ya da webhook ile çalıştırıldığında"
    if kind == "interval":
        every = spec["every_minutes"]
        if every % 1440 == 0:
            text = "Her gün" if every == 1440 else f"Her {every // 1440} günde bir"
        elif every % 60 == 0:
            text = "Her saat" if every == 60 else f"Her {every // 60} saatte bir"
        else:
            text = f"Her {every} dakikada bir"
        return text
    if kind == "once":
        at = datetime.fromisoformat(spec["at"]).astimezone(zone(timezone))
        return f"Bir kez: {at.strftime('%d.%m.%Y %H:%M')} ({timezone})"
    if kind == "weekdays":
        return f"{_day_list(spec['days'])}, saat {spec['time']} ({timezone})"
    described = _cron_summary(spec["expression"])
    return f"{described} ({timezone})" if described else f"Cron {spec['expression']} ({timezone})"
