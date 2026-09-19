"""ดึงข้อมูลปฏิทินเศรษฐกิจ

แหล่งหลัก  : TradingView economic calendar (ฟรี ไม่ต้องใช้ API key ดึงล่วงหน้าได้หลายเดือน)
แหล่งสำรอง : ForexFactory / FairEconomy JSON (ได้เฉพาะสัปดาห์ปัจจุบัน)
สำรองสุดท้าย: ไฟล์ cache/events.json ที่ดึงสำเร็จครั้งล่าสุด
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# เวลาไทยเป็น UTC+7 คงที่ ไม่มี DST จึงไม่ต้องพึ่ง zoneinfo/tzdata
# (Windows ไม่มีฐานข้อมูล IANA timezone ในตัว)
TH_TZ = timezone(timedelta(hours=7))
UTC = timezone.utc

TV_URL = "https://economic-calendar.tradingview.com/events"
FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GoldNewsCalendar/1.0"

ROOT = Path(__file__).resolve().parent.parent
CACHE_FILE = ROOT / "cache" / "events.json"

# ForexFactory ใช้รหัสสกุลเงิน แต่ TradingView ใช้รหัสประเทศ -> แปลงให้ตรงกัน
_CCY_TO_COUNTRY = {
    "USD": "US", "EUR": "EU", "GBP": "GB", "JPY": "JP", "CHF": "CH",
    "CAD": "CA", "AUD": "AU", "NZD": "NZ", "CNY": "CN",
}

_IMPACT_TO_IMPORTANCE = {"high": 1, "medium": 0, "low": -1, "holiday": -1}


def _http_get(url: str, headers: dict | None = None, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": _UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _fmt_value(value, unit: str, scale: str) -> str:
    """แปลงตัวเลขดิบให้เป็นข้อความอ่านง่าย เช่น 162 + K -> '162K', -88.6 + $ + B -> '-$88.6B'"""
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        return value.strip()

    num = f"{value:g}"
    unit = (unit or "").strip()
    scale = (scale or "").strip()

    if unit == "%":
        return f"{num}{scale}%"
    if unit == "$":
        sign = "-" if value < 0 else ""
        return f"{sign}${num.lstrip('-')}{scale}"
    if unit:
        return f"{num}{scale} {unit}"
    return f"{num}{scale}"


def _to_iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def fetch_tradingview(from_dt: datetime, to_dt: datetime, countries: list[str]) -> list[dict]:
    """ดึงจาก TradingView แล้วแปลงเป็น schema กลางของเรา"""
    query = urllib.parse.urlencode({
        "from": _to_iso_z(from_dt),
        "to": _to_iso_z(to_dt),
        "countries": ",".join(countries),
    })
    raw = _http_get(f"{TV_URL}?{query}", headers={"Origin": "https://www.tradingview.com"})
    payload = json.loads(raw)
    if payload.get("status") != "ok":
        raise RuntimeError(f"TradingView ตอบกลับผิดปกติ: {payload.get('status')}")

    events = []
    for item in payload.get("result", []):
        dt_utc = datetime.strptime(item["date"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)
        unit, scale = item.get("unit") or "", item.get("scale") or ""
        events.append({
            "id": str(item.get("id", "")),
            "title": item.get("title", ""),
            "indicator": item.get("indicator", "") or item.get("title", ""),
            "country": item.get("country", ""),
            "importance": int(item.get("importance", -1)),
            "category": item.get("category", ""),
            "period": item.get("period", "") or "",
            "source": item.get("source", "") or "",
            "actual": _fmt_value(item.get("actual"), unit, scale),
            "forecast": _fmt_value(item.get("forecast"), unit, scale),
            "previous": _fmt_value(item.get("previous"), unit, scale),
            "actual_raw": item.get("actualRaw"),
            "forecast_raw": item.get("forecastRaw"),
            "previous_raw": item.get("previousRaw"),
            "ts": int(dt_utc.timestamp()),
        })
    return events


def fetch_forexfactory() -> list[dict]:
    """แหล่งสำรอง - ได้เฉพาะสัปดาห์ปัจจุบัน ชื่อข่าวคนละแบบกับ TradingView"""
    payload = json.loads(_http_get(FF_URL))

    events = []
    for item in payload:
        dt = datetime.fromisoformat(item["date"])
        ccy = (item.get("country") or "").upper()
        events.append({
            "id": "",
            "title": item.get("title", ""),
            "indicator": item.get("title", ""),
            "country": _CCY_TO_COUNTRY.get(ccy, ccy),
            "importance": _IMPACT_TO_IMPORTANCE.get((item.get("impact") or "").lower(), -1),
            "category": "",
            "period": "",
            "source": "ForexFactory",
            "actual": "",
            "forecast": (item.get("forecast") or "").strip(),
            "previous": (item.get("previous") or "").strip(),
            "actual_raw": None,
            "forecast_raw": None,
            "previous_raw": None,
            "ts": int(dt.astimezone(UTC).timestamp()),
        })
    return events


def _read_cache() -> dict | None:
    if not CACHE_FILE.exists():
        return None
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write_cache(events: list[dict], source: str) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps(
            {"fetched_at": int(datetime.now(UTC).timestamp()), "source": source, "events": events},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def load(days_back: int, days_ahead: int, countries: list[str]) -> dict:
    """คืน {events, source, fetched_at, stale, errors}

    ลองตามลำดับ: TradingView -> ForexFactory -> cache
    """
    now = datetime.now(UTC)
    from_dt = now - timedelta(days=days_back)
    to_dt = now + timedelta(days=days_ahead)
    errors: list[str] = []

    for name, fn in (
        ("TradingView", lambda: fetch_tradingview(from_dt, to_dt, countries)),
        ("ForexFactory", fetch_forexfactory),
    ):
        try:
            events = fn()
            if events:
                _write_cache(events, name)
                return {
                    "events": events,
                    "source": name,
                    "fetched_at": int(now.timestamp()),
                    "stale": False,
                    "errors": errors,
                }
            errors.append(f"{name}: ไม่มีข้อมูลส่งกลับมา")
        except (urllib.error.URLError, OSError, ValueError, RuntimeError) as exc:
            errors.append(f"{name}: {exc}")

    cached = _read_cache()
    if cached:
        errors.append("ใช้ข้อมูลสำรองจากไฟล์ cache")
        return {
            "events": cached.get("events", []),
            "source": cached.get("source", "cache") + " (cache)",
            "fetched_at": cached.get("fetched_at", 0),
            "stale": True,
            "errors": errors,
        }

    raise RuntimeError("ดึงข้อมูลไม่สำเร็จ และไม่มีไฟล์ cache:\n  - " + "\n  - ".join(errors))
