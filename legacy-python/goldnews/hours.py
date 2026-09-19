"""วันนี้น่าเล่นกี่โมง — รวม "ชั่วโมงที่ทองแกว่งจริงในอดีต" เข้ากับ "เวลาข่าวของวันนี้"

โปรไฟล์ความผันผวนมาจากการวัดช่วง High-Low ของแท่ง 15 นาทีย้อนหลัง 60 วัน แล้วหา
ค่ามัธยฐานแยกตามชั่วโมง (เวลาไทย) — ใช้มัธยฐานเพราะทนต่อวันที่มีข่าวใหญ่ผิดปกติ

*** บอกได้แค่ว่า "ชั่วโมงไหนทองเคยแกว่งแรง" ไม่ได้บอกว่าจะแกว่งทางไหน ***
"""

from __future__ import annotations

import statistics
from datetime import datetime

from . import translate
from .fetch import TH_TZ

# เซสชันตลาดตามเวลาไทย (ช่วงเดือนที่ยุโรป/สหรัฐฯ ใช้เวลาฤดูร้อน)
SESSIONS = [
    (5, 13, "เอเชีย"),
    (13, 20, "ลอนดอน"),
    (20, 23, "ลอนดอน + นิวยอร์ก ทับกัน"),
    (23, 28, "นิวยอร์ก"),  # 28 = 04:00 ของวันถัดไป (หลังจากนั้น CME ปิดพัก)
]


def session_name(hour: int) -> str:
    for start, end, name in SESSIONS:
        if start <= hour < end or (end > 24 and hour < end - 24):
            return name
    return "ตลาดพัก"


def volatility_profile(bars: list[dict]) -> dict[int, float]:
    """{ชั่วโมงไทย: ช่วง High-Low มัธยฐานต่อแท่ง 15 นาที}"""
    buckets: dict[int, list[float]] = {}
    for bar in bars:
        high, low = bar.get("h"), bar.get("l")
        if high is None or low is None:
            continue
        hour = datetime.fromtimestamp(bar["ts"], TH_TZ).hour
        buckets.setdefault(hour, []).append(high - low)

    # ชั่วโมงที่เก็บตัวอย่างได้น้อยเกินไป (ช่วงตลาดพัก) ไม่น่าเชื่อถือพอ
    return {h: statistics.median(v) for h, v in buckets.items() if len(v) >= 20}


def _event_weight(event: dict, annotation: dict) -> float:
    if annotation.get("volatile"):
        return 6.0
    if event["country"] == "US" and event["importance"] == 1:
        return 4.0
    if event["importance"] == 1:
        return 2.0
    if event["country"] == "US":
        return 1.0
    return 0.5


def today_hours(
    events: list[dict],
    annotations: list[dict],
    profile: dict[int, float],
    now: datetime,
) -> list[dict]:
    """ตาราง 24 ชั่วโมงของวันนี้ พร้อมคะแนนความน่าสนใจ

    แต่ละแถว: {hour, vol, session, events, news_weight, score, is_now, is_past}
    """
    today = now.date()
    by_hour: dict[int, list[tuple[dict, dict]]] = {}
    for event, annotation in zip(events, annotations):
        dt = datetime.fromtimestamp(event["ts"], TH_TZ)
        if dt.date() == today:
            by_hour.setdefault(dt.hour, []).append((event, annotation))

    peak_vol = max(profile.values()) if profile else 1.0
    rows = []
    for hour in range(24):
        vol = profile.get(hour, 0.0)
        pairs = by_hour.get(hour, [])
        news_weight = sum(_event_weight(e, a) for e, a in pairs)

        rows.append(
            {
                "hour": hour,
                "vol": round(vol, 2),
                "vol_pct": round(vol / peak_vol * 100) if peak_vol else 0,
                "session": session_name(hour),
                "events": [
                    {
                        "time": datetime.fromtimestamp(e["ts"], TH_TZ).strftime("%H:%M"),
                        "country": e["country"],
                        "importance": e["importance"],
                        "volatile": a.get("volatile", False),
                        "title": translate.thai_title(e) or a.get("th") or e["title"],
                    }
                    for e, a in sorted(pairs, key=lambda p: (p[0]["ts"], p[1]["rank"]))
                ],
                "news_weight": news_weight,
                # ความผันผวนพื้นฐาน (เต็ม 10) + น้ำหนักข่าว — ข่าวมีผลมากกว่าเพราะเป็นตัวจุดชนวน
                "score": round((vol / peak_vol * 10 if peak_vol else 0) + news_weight * 2, 1),
                "is_now": hour == now.hour,
                "is_past": hour < now.hour,
            }
        )
    return rows


def top_windows(rows: list[dict], now: datetime, limit: int = 3) -> list[dict]:
    """ช่วงเวลาที่เหลือของวันนี้ซึ่งน่าจับตาที่สุด"""
    remaining = [r for r in rows if not r["is_past"] and r["score"] > 0]
    return sorted(remaining, key=lambda r: -r["score"])[:limit]
