"""ดึงราคาทอง 15 นาที และปรับให้เป็นสเกลราคาที่โบรกเกอร์แสดง

ทำไมต้องปรับฐาน:
    ทองล่วงหน้า COMEX (GC=F) แพงกว่า spot ราว $35 — ถ้าเอามาคำนวณแนวรับแนวต้านตรง ๆ
    เส้นจะเพี้ยนทั้งกระดานเมื่อวาดลงกราฟ XAUUSD ของโบรกเกอร์

จึงใช้:
    PAXG (โทเคนทองคำ 1 ออนซ์ ซื้อขาย 24 ชม.) เป็นแท่งเทียน 15 นาที  ห่าง spot ~$5
    + ปรับฐานด้วยราคา spot จริง  -> เหลือคลาดเคลื่อน ~$1-2
    + broker_offset จาก config  -> ตรงกับกราฟที่ผู้ใช้ดูจริง
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from .fetch import CACHE_FILE, TH_TZ, UTC, _UA, _http_get

SPOT_URL = "https://api.gold-api.com/price/XAU"
PAXG_URL = "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=15m&limit={limit}"
GCF_URL = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval={interval}&range={range}"

PRICE_CACHE = CACHE_FILE.parent / "price.json"

# ตลาดทองปิดช่วงสุดสัปดาห์ แต่ PAXG ซื้อขายตลอด — แท่งเสาร์อาทิตย์สภาพคล่องบางมาก ต้องตัดทิ้ง
# (ปิดเสาร์ ~04:00 น. ไทย เปิดจันทร์ ~05:00 น. ไทย)
def _is_market_open(dt: datetime) -> bool:
    weekday = dt.weekday()  # 0=จันทร์ 5=เสาร์ 6=อาทิตย์
    if weekday == 5:
        return dt.hour < 4
    if weekday == 6:
        return False
    if weekday == 0:
        return dt.hour >= 5
    return True


def fetch_spot() -> float:
    """ราคา spot ทองคำล่าสุด (ดอลลาร์ต่อออนซ์)"""
    return float(json.loads(_http_get(SPOT_URL))["price"])


def fetch_paxg_15m(limit: int = 1000) -> list[dict]:
    """แท่งเทียน 15 นาทีของ PAXG — ยังไม่ปรับฐาน"""
    rows = json.loads(_http_get(PAXG_URL.format(limit=limit)))
    return [
        {
            "ts": int(row[0]) // 1000,
            "o": float(row[1]),
            "h": float(row[2]),
            "l": float(row[3]),
            "c": float(row[4]),
        }
        for row in rows
    ]


def fetch_gcf(interval: str = "15m", range_: str = "60d") -> list[dict]:
    """แท่งเทียนทองล่วงหน้า COMEX (GC=F) เรียงตามเวลา

    ใช้ GC=F เพราะเป็นตลาดทองจริงที่มีเวลาเปิดปิดจริงและข่าววิ่งเข้าโดยตรง
    ราคาห่าง spot ราว $35 แต่ไม่มีผล เพราะงานที่ใช้วัดแค่ "ส่วนต่าง" กับ "ช่วงกว้าง"
    ไม่ได้ใช้ระดับราคา

    ขอบเขตที่ Yahoo ให้ (ทดสอบแล้ว): 1m=7วัน · 5m=60วัน · 15m=60วัน · 1h=2ปี
    """
    payload = json.loads(_http_get(GCF_URL.format(interval=interval, range=range_)))
    result = payload["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]

    bars = []
    for i, ts in enumerate(result["timestamp"]):
        high, low, close = quote["high"][i], quote["low"][i], quote["close"][i]
        if high is None or low is None or close is None:
            continue
        bars.append({"ts": int(ts), "o": quote["open"][i], "h": high, "l": low, "c": close})
    bars.sort(key=lambda b: b["ts"])
    return bars


def fetch_gcf_15m(range_: str = "60d") -> list[dict]:
    """แท่ง 15 นาที — ใช้ทำโปรไฟล์ความผันผวนรายชั่วโมง"""
    return fetch_gcf("15m", range_)


def fetch_gcf_5m(range_: str = "60d") -> list[dict]:
    """แท่ง 5 นาที — ละเอียดพอวัดปฏิกิริยาข่าวที่ +5/+10/+15 นาที (Reaction Lab)"""
    return fetch_gcf("5m", range_)


def fetch_gcf_1h(range_: str = "2y") -> list[dict]:
    """แท่งรายชั่วโมง 2 ปี — ใช้ backfill ขอบเขต 60 นาทีย้อนหลังไกล"""
    return fetch_gcf("1h", range_)


def _read_cache() -> dict | None:
    if not PRICE_CACHE.exists():
        return None
    try:
        return json.loads(PRICE_CACHE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def load(broker_offset: float = 0.0) -> dict:
    """คืน {price, bars, profile_bars, basis, spot, stale, errors}

    bars         = แท่ง 15 นาที ปรับเป็นสเกลราคาโบรกเกอร์แล้ว (ใช้หาแนวรับแนวต้าน)
    profile_bars = แท่ง 15 นาที 60 วันของ GC=F (ใช้ทำโปรไฟล์ความผันผวนรายชั่วโมง)
    price        = ราคาปัจจุบันในสเกลโบรกเกอร์
    """
    errors: list[str] = []
    spot = None
    try:
        spot = fetch_spot()
    except (urllib.error.URLError, OSError, ValueError, KeyError) as exc:
        errors.append(f"ราคา spot: {exc}")

    raw_bars: list[dict] = []
    try:
        raw_bars = fetch_paxg_15m()
    except (urllib.error.URLError, OSError, ValueError, KeyError) as exc:
        errors.append(f"PAXG 15 นาที: {exc}")

    profile_bars: list[dict] = []
    try:
        profile_bars = fetch_gcf_15m()
    except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError) as exc:
        errors.append(f"GC=F 60 วัน: {exc}")

    if not raw_bars:
        cached = _read_cache()
        if not cached:
            raise RuntimeError("ดึงราคาไม่สำเร็จ และไม่มีไฟล์ cache:\n  - " + "\n  - ".join(errors))
        errors.append("ใช้ราคาสำรองจากไฟล์ cache")
        cached["stale"] = True
        cached["errors"] = errors
        return cached

    # ปรับ PAXG -> spot -> สเกลโบรกเกอร์
    basis = (spot - raw_bars[-1]["c"]) if spot else 0.0
    shift = basis + broker_offset

    bars = [
        {
            "ts": b["ts"],
            "o": b["o"] + shift,
            "h": b["h"] + shift,
            "l": b["l"] + shift,
            "c": b["c"] + shift,
        }
        for b in raw_bars
        if _is_market_open(datetime.fromtimestamp(b["ts"], TH_TZ))
    ]

    data = {
        "price": round(bars[-1]["c"], 2),
        "spot": round(spot, 2) if spot else None,
        "basis": round(basis, 2),
        "broker_offset": broker_offset,
        "bars": bars,
        "profile_bars": profile_bars,
        "fetched_at": int(datetime.now(UTC).timestamp()),
        "stale": False,
        "errors": errors,
    }

    PRICE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    PRICE_CACHE.write_text(json.dumps(data), encoding="utf-8")
    return data
