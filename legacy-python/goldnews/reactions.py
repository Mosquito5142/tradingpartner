"""Reaction Lab — วัดว่าทอง "ตอบสนองจริง" ต่อข่าวแต่ละตัวยังไง แล้วเก็บสะสมไว้ถาวร

ทำไมต้องมี:
    bias.py บอกทิศทางจากทฤษฎีมหภาค แต่ไม่เคยถูกตรวจสอบกับราคาจริง
    เมื่อวัดจริงพบว่าทฤษฎีแม่น ~71% ใน 10-15 นาทีแรก แล้วตกเหลือ ~50% ที่ 30 นาที
    (เท่ากับเดาสุ่ม) — กฎใช้ได้ แต่มีอายุสั้น

ทำไมต้องเก็บเอง:
    Yahoo ให้แท่ง 5 นาทีย้อนหลังแค่ 60 วัน = ข่าวใหญ่ราว 35 ครั้ง พอแยกรายข่าวแล้ว
    เหลือกลุ่มละ 2-3 ตัวอย่าง สรุปอะไรไม่ได้ ต้องสะสมเองทุกครั้งที่รัน
    ข้อมูลที่เก็บแล้วจะไม่ถูกลบ แม้ Yahoo จะลบของตัวเองไปแล้ว

*** เป็นการวัดสถิติ ไม่ใช่สัญญาณซื้อขาย ***
"""

from __future__ import annotations

import json
import statistics
from datetime import datetime
from pathlib import Path

from . import bias, translate
from .fetch import TH_TZ, UTC

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "data" / "reactions.json"

# นาทีหลังข่าวที่เราวัด — 5/10/15 คือช่วงที่สัญญาณยังมีชีวิต, 30/60 ไว้ดูการสลายตัว
HORIZONS = [5, 10, 15, 30, 60]

# ตัวอย่างน้อยกว่านี้ไม่โชว์เปอร์เซ็นต์ เพราะ 1-2 ครั้งบอกอะไรไม่ได้
MIN_SAMPLE = 3


def group_key(event: dict) -> str:
    """ชื่อกลุ่มของข่าว — ตัดคำต่อท้ายอย่าง 'ตัวเลขเบื้องต้น' ออก แต่คง MoM/YoY ไว้

    'อัตราเงินเฟ้อ (CPI) · เทียบเดือนก่อน · ตัวเลขเบื้องต้น' -> 'อัตราเงินเฟ้อ (CPI) · เทียบเดือนก่อน'
    """
    name = translate.thai_title(event) or event.get("title", "")
    parts = [p.strip() for p in name.split("·")]
    keep = [parts[0]] + [p for p in parts[1:] if p.startswith("เทียบ")]
    return " · ".join(keep) if keep[0] else event.get("title", "")


def measure(event: dict, bars: list[dict]) -> dict | None:
    """วัดการเคลื่อนไหวหลังข่าว เทียบกับ close ของแท่งก่อนข่าว

    bars ต้องเรียงตามเวลาแล้ว คืน None ถ้าไม่มีข้อมูลราคาครอบช่วงนั้น
    """
    ts = event["ts"]
    before = [b for b in bars if b["ts"] < ts]
    if not before:
        return None

    # ห่างเกิน 2 ชม. ถือว่าไม่ใช่ราคาอ้างอิงของข่าวนี้ (ตลาดปิดคั่น/ข้อมูลขาด)
    reference = before[-1]
    if ts - reference["ts"] > 2 * 3600:
        return None

    result: dict = {}
    for horizon in HORIZONS:
        window = [b for b in bars if ts <= b["ts"] < ts + horizon * 60]
        result[f"m{horizon}"] = round(window[-1]["c"] - reference["c"], 2) if window else None

    hour = [b for b in bars if ts <= b["ts"] < ts + 3600]
    result["rng60"] = round(max(b["h"] for b in hour) - min(b["l"] for b in hour), 2) if hour else None

    return result if any(result[f"m{h}"] is not None for h in HORIZONS) else None


def _load() -> dict:
    if not STORE.exists():
        return {"version": 1, "updated": 0, "events": {}}
    try:
        data = json.loads(STORE.read_text(encoding="utf-8"))
        data.setdefault("events", {})
        return data
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "updated": 0, "events": {}}


def _save(data: dict) -> None:
    data["updated"] = int(datetime.now(UTC).timestamp())
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def update_store(events: list[dict], bars: list[dict]) -> dict:
    """วัดข่าวที่ยังไม่เคยเก็บ แล้ว merge ลงคลัง — คืนสรุปว่าเพิ่ม/เติมไปกี่รายการ

    ของเดิมในคลังจะไม่ถูกลบ แม้ Yahoo จะไม่มีข้อมูลช่วงนั้นแล้ว
    แต่ถ้ารายการเดิมยังขาด horizon ไหน และรอบนี้วัดได้ จะเติมให้
    """
    store = _load()
    known = store["events"]
    added = filled = 0

    for event in events:
        annotation = bias.annotate(event)
        # เก็บเฉพาะข่าวตัวเลขที่มี surprise ชัด — ข่าวแถลง (tone) วัดทิศทางแบบนี้ไม่ได้
        if annotation["kind"] != "number" or annotation["surprise"] not in ("higher", "lower"):
            continue
        if translate.is_noise(event) or event["importance"] < 0:
            continue

        key = event.get("id") or f'{event["ts"]}:{event.get("title", "")}'
        measured = measure(event, bars)
        if measured is None:
            continue

        if key not in known:
            known[key] = {
                "ts": event["ts"],
                "key": group_key(event),
                "title": event.get("title", ""),
                "country": event.get("country", ""),
                "importance": event["importance"],
                "surprise": annotation["surprise"],
                "pred": annotation["outcome"],
                **measured,
            }
            added += 1
        else:
            existing = known[key]
            changed = False
            for field, value in measured.items():
                if existing.get(field) is None and value is not None:
                    existing[field] = value
                    changed = True
            filled += changed

    _save(store)
    return {"added": added, "filled": filled, "total": len(known)}


def _hit(record: dict, horizon: int) -> bool | None:
    """ทฤษฎีทายถูกไหมที่ horizon นี้ (None = วัดไม่ได้ / ราคาไม่ขยับเลย)"""
    move = record.get(f"m{horizon}")
    if move is None or move == 0 or record.get("pred") not in ("up", "down"):
        return None
    return (move > 0) == (record["pred"] == "up")


def decay_curve(records: list[dict] | None = None) -> list[dict]:
    """เส้นโค้งการสลายตัวของสัญญาณ รวมทุกข่าว"""
    rows = records if records is not None else list(_load()["events"].values())
    out = []
    for horizon in HORIZONS:
        hits = [_hit(r, horizon) for r in rows]
        hits = [h for h in hits if h is not None]
        moves = [abs(r[f"m{horizon}"]) for r in rows if r.get(f"m{horizon}")]
        if not hits:
            continue
        out.append(
            {
                "minutes": horizon,
                "n": len(hits),
                "accuracy": round(sum(hits) / len(hits) * 100),
                "median_move": round(statistics.median(moves), 2) if moves else None,
            }
        )
    return out


def stats(key: str, surprise: str | None = None) -> dict:
    """สถิติของข่าวกลุ่มหนึ่ง — surprise=None คือรวมทั้งสูงกว่าและต่ำกว่าคาด"""
    rows = [r for r in _load()["events"].values() if r.get("key") == key]
    if surprise:
        rows = [r for r in rows if r.get("surprise") == surprise]

    ranges = [r["rng60"] for r in rows if r.get("rng60")]
    return {
        "key": key,
        "surprise": surprise,
        "n": len(rows),
        "enough": len(rows) >= MIN_SAMPLE,
        "curve": decay_curve(rows),
        "median_range60": round(statistics.median(ranges), 2) if ranges else None,
        "recent": [
            {
                "date": datetime.fromtimestamp(r["ts"], TH_TZ).strftime("%d/%m/%y"),
                "surprise": r.get("surprise"),
                "m15": r.get("m15"),
                "m60": r.get("m60"),
            }
            for r in sorted(rows, key=lambda r: -r["ts"])[:3]
        ],
    }


def news_noise(minutes: int = 15) -> float | None:
    """ระยะที่ทองขยับปกติ 'ช่วงข่าวใหญ่สหรัฐฯ' — ใช้เทียบว่า SL กว้างพอไหม

    ใช้เฉพาะกลุ่มข่าวใหญ่สหรัฐฯ ไม่ใช่ค่าเฉลี่ยรวม เพราะนั่นคือช่วงที่คนเข้าเทรดข่าวจริง
    ค่ารวมทุกข่าวจะต่ำกว่าความจริงเพราะถูกข่าวเล็กที่แทบไม่ขยับดึงลง
    """
    rows = [r for r in _load()["events"].values()
            if r.get("country") == "US" and r.get("importance") == 1]
    moves = [abs(r[f"m{minutes}"]) for r in rows if r.get(f"m{minutes}")]
    if len(moves) < MIN_SAMPLE:
        moves = [abs(r[f"m{minutes}"]) for r in _load()["events"].values() if r.get(f"m{minutes}")]
    return round(statistics.median(moves), 2) if moves else None


def breakdown() -> list[dict]:
    """แยกเส้นโค้งตามกลุ่มข่าว — เห็นชัดว่าขอบได้เปรียบกระจุกอยู่ที่ข่าวใหญ่สหรัฐฯ

    สำคัญ: ต้องดู "ขยับมัธยฐาน" คู่กับ "% ถูก" เสมอ
    ข่าว EU/CN แม่นสูงแต่ราคาขยับแค่ $3-4 ซึ่งเกือบเท่าสเปรด ความแม่นจึงกินไม่ได้จริง
    """
    rows = list(_load()["events"].values())
    segments = [
        ("ข่าวใหญ่สหรัฐฯ", lambda r: r["country"] == "US" and r["importance"] == 1),
        ("ข่าวกลางสหรัฐฯ", lambda r: r["country"] == "US" and r["importance"] == 0),
        ("ยุโรป / จีน", lambda r: r["country"] != "US"),
    ]
    out = []
    for label, test in segments:
        subset = [r for r in rows if test(r)]
        if subset:
            out.append({"label": label, "n": len(subset), "curve": decay_curve(subset)})
    return out


def summary() -> dict:
    """ภาพรวมคลังข้อมูลทั้งหมด"""
    store = _load()
    rows = list(store["events"].values())
    by_key: dict[str, int] = {}
    for r in rows:
        by_key[r.get("key", "?")] = by_key.get(r.get("key", "?"), 0) + 1
    span = [r["ts"] for r in rows]
    return {
        "total": len(rows),
        "updated": store.get("updated", 0),
        "oldest": min(span) if span else None,
        "newest": max(span) if span else None,
        "curve": decay_curve(rows),
        "breakdown": breakdown(),
        "groups": sorted(by_key.items(), key=lambda kv: -kv[1]),
    }
