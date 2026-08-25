"""Bounded HTTPS iCalendar fetch and parser."""

from __future__ import annotations

import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_MAX_BYTES = 2 * 1024 * 1024


def _safe_url(raw: str) -> str:
    raw = raw.strip()
    if raw.lower().startswith("webcal://"):
        raw = "https://" + raw[9:]
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("calendar URL must be HTTPS (webcal:// is accepted and upgraded)")
    try:
        addresses = {
            item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        }
    except OSError as exc:
        raise ValueError("calendar host could not be resolved") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("calendar URL must resolve only to public addresses")
    return raw


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        return None


def fetch_ics(raw_url: str) -> tuple[str, str]:
    url = _safe_url(raw_url)
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(4):
        req = urllib.request.Request(url, headers={"User-Agent": "protoAgent-Calendar/0.2", "Accept": "text/calendar"})
        try:
            with opener.open(req, timeout=15) as response:
                length = int(response.headers.get("Content-Length", "0") or 0)
                if length > _MAX_BYTES:
                    raise ValueError("calendar feed exceeds 2 MiB")
                body = response.read(_MAX_BYTES + 1)
                if len(body) > _MAX_BYTES:
                    raise ValueError("calendar feed exceeds 2 MiB")
                charset = response.headers.get_content_charset() or "utf-8"
                return body.decode(charset, errors="replace"), url
        except urllib.error.HTTPError as exc:
            if exc.code not in {301, 302, 303, 307, 308}:
                raise ValueError(f"calendar feed returned HTTP {exc.code}") from exc
            location = exc.headers.get("Location", "")
            if not location:
                raise ValueError("calendar redirect had no destination") from exc
            url = _safe_url(urllib.parse.urljoin(url, location))
    raise ValueError("calendar feed redirected too many times")


def _unfold(text: str) -> list[str]:
    rows: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and rows:
            rows[-1] += raw[1:]
        else:
            rows.append(raw)
    return rows


def _text(value: str) -> str:
    return (
        value.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .strip()
    )


def _property(line: str) -> tuple[str, dict[str, str], str]:
    left, sep, value = line.partition(":")
    if not sep:
        return "", {}, ""
    parts = left.split(";")
    params: dict[str, str] = {}
    for part in parts[1:]:
        key, eq, val = part.partition("=")
        if eq:
            params[key.upper()] = val.strip('"')
    return parts[0].upper(), params, value


def _ical_when(value: str, params: dict[str, str]) -> tuple[str, bool]:
    value = value.strip()
    if params.get("VALUE", "").upper() == "DATE" or (len(value) == 8 and "T" not in value):
        parsed = datetime.strptime(value[:8], "%Y%m%d").date()
        return parsed.isoformat(), True
    cleaned = value.rstrip("Z")
    fmt = "%Y%m%dT%H%M%S" if len(cleaned) >= 15 else "%Y%m%dT%H%M"
    parsed = datetime.strptime(cleaned[:15] if fmt.endswith("%S") else cleaned[:13], fmt)
    if value.endswith("Z"):
        parsed = parsed.replace(tzinfo=timezone.utc)
    elif params.get("TZID"):
        try:
            parsed = parsed.replace(tzinfo=ZoneInfo(params["TZID"]))
        except ZoneInfoNotFoundError:
            pass
    return parsed.isoformat().replace("+00:00", "Z"), False


def parse_ics(text: str) -> list[dict]:
    events: list[dict] = []
    current: dict[str, tuple[dict[str, str], str]] | None = None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT" and current is not None:
            try:
                start, all_day = _ical_when(current["DTSTART"][1], current["DTSTART"][0])
                if "DTEND" in current:
                    end, _ = _ical_when(current["DTEND"][1], current["DTEND"][0])
                elif all_day:
                    end = (date.fromisoformat(start) + timedelta(days=1)).isoformat()
                else:
                    parsed = datetime.fromisoformat(start.replace("Z", "+00:00")) + timedelta(hours=1)
                    end = parsed.isoformat().replace("+00:00", "Z")
                uid = _text(current.get("UID", ({}, f"{start}-{current.get('SUMMARY', ({}, 'Event'))[1]}"))[1])
                events.append(
                    {
                        "uid": uid,
                        "title": _text(current.get("SUMMARY", ({}, "Untitled event"))[1]) or "Untitled event",
                        "starts_at": start,
                        "ends_at": end,
                        "all_day": all_day,
                        "location": _text(current.get("LOCATION", ({}, ""))[1]),
                        "notes": _text(current.get("DESCRIPTION", ({}, ""))[1]),
                        "rrule": current.get("RRULE", ({}, ""))[1].strip().upper(),
                    }
                )
            except (KeyError, ValueError):
                pass
            current = None
            continue
        if current is not None:
            name, params, value = _property(line)
            if name in {"UID", "SUMMARY", "DTSTART", "DTEND", "LOCATION", "DESCRIPTION", "RRULE"}:
                current[name] = (params, value)
    return events
