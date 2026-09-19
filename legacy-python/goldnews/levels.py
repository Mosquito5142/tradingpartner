"""คำนวณแนวรับ/แนวต้านจากแท่งเทียน 15 นาที

วิธีที่ใช้ (ทุกวิธีเป็นเทคนิคมาตรฐานที่เทรดเดอร์ใช้กันทั่วไป ไม่ใช่สูตรลับ):
    1. Swing high/low แบบ fractal  — จุดกลับตัวที่ราคาเคยเด้ง/ชน แล้วจับกลุ่มเป็น "โซน"
    2. Pivot Point รายวัน           — PP/R1/R2/S1/S2 จาก High-Low-Close ของเมื่อวาน
    3. High/Low เมื่อวาน + กรอบเอเชีย — ระดับที่ตลาดจับตาเป็นประจำ
    4. เลขกลม ($25)                 — ทองมักมีแรงซื้อขายหนาแน่นที่เลขกลม

*** เป็นเครื่องมือช่วยอ่านกราฟ ไม่ใช่สัญญาณซื้อขาย ***
"""

from __future__ import annotations

from datetime import datetime

from .fetch import TH_TZ

# ความกว้างสูงสุดของหนึ่งโซน (สัดส่วนของราคา) — 0.08% ของ $4,300 ประมาณ $3.4
ZONE_WIDTH_PCT = 0.0008

# กี่แท่งซ้าย/ขวาถึงจะนับเป็นจุดกลับตัว (3 แท่ง = 45 นาที)
SWING_LOOKBACK = 3

ROUND_STEP = 25.0       # ระยะห่างของเลขกลมที่สนใจ
ASIA_START_HOUR = 6     # กรอบเอเชีย เวลาไทย 06:00 - 14:00
ASIA_END_HOUR = 14


def _swing_points(bars: list[dict], k: int = SWING_LOOKBACK) -> list[tuple[float, str, int]]:
    """หาจุดกลับตัว: แท่งที่ high สูงสุด (หรือ low ต่ำสุด) เทียบกับ k แท่งซ้ายขวา"""
    points = []
    for i in range(k, len(bars) - k):
        window = bars[i - k : i + k + 1]
        if bars[i]["h"] >= max(b["h"] for b in window):
            points.append((bars[i]["h"], "high", bars[i]["ts"]))
        if bars[i]["l"] <= min(b["l"] for b in window):
            points.append((bars[i]["l"], "low", bars[i]["ts"]))
    return points


def _cluster(points: list[tuple[float, str, int]], width: float) -> list[dict]:
    """จับกลุ่มจุดที่ราคาใกล้กันเป็นโซนเดียว

    สำคัญ: เทียบกับ "ราคาเริ่มโซน" ไม่ใช่จุดก่อนหน้า — ไม่งั้นจุดจะต่อกันเป็นลูกโซ่
    จนกลายเป็นโซนเดียวกว้างเป็นร้อยเหรียญ
    """
    if not points:
        return []

    zones = []
    current = [points[0]]
    for point in points[1:]:
        if point[0] - current[0][0] <= width:
            current.append(point)
        else:
            zones.append(current)
            current = [point]
    zones.append(current)

    return [
        {
            "price": sum(p[0] for p in z) / len(z),
            "low": min(p[0] for p in z),
            "high": max(p[0] for p in z),
            "touches": len(z),
            "last_ts": max(p[2] for p in z),
        }
        for z in zones
    ]


def _day_bars(bars: list[dict], day) -> list[dict]:
    return [b for b in bars if datetime.fromtimestamp(b["ts"], TH_TZ).date() == day]


def _reference_levels(bars: list[dict]) -> list[dict]:
    """Pivot รายวัน + High/Low เมื่อวาน + กรอบเอเชียของวันนี้"""
    if not bars:
        return []

    today = datetime.fromtimestamp(bars[-1]["ts"], TH_TZ).date()
    earlier = [b for b in bars if datetime.fromtimestamp(b["ts"], TH_TZ).date() < today]
    levels: list[dict] = []

    if earlier:
        prev_day = datetime.fromtimestamp(earlier[-1]["ts"], TH_TZ).date()
        prev = _day_bars(bars, prev_day)
        high = max(b["h"] for b in prev)
        low = min(b["l"] for b in prev)
        close = prev[-1]["c"]
        pivot = (high + low + close) / 3
        span = high - low

        levels += [
            {"price": high, "kind": "prev_high", "label": "High เมื่อวาน"},
            {"price": low, "kind": "prev_low", "label": "Low เมื่อวาน"},
            {"price": pivot, "kind": "pivot", "label": "Pivot Point"},
            {"price": 2 * pivot - low, "kind": "pivot", "label": "แนวต้าน R1"},
            {"price": 2 * pivot - high, "kind": "pivot", "label": "แนวรับ S1"},
            {"price": pivot + span, "kind": "pivot", "label": "แนวต้าน R2"},
            {"price": pivot - span, "kind": "pivot", "label": "แนวรับ S2"},
        ]

    asia = [
        b
        for b in _day_bars(bars, today)
        if ASIA_START_HOUR <= datetime.fromtimestamp(b["ts"], TH_TZ).hour < ASIA_END_HOUR
    ]
    if len(asia) >= 4:
        levels += [
            {"price": max(b["h"] for b in asia), "kind": "asia", "label": "ยอดกรอบเอเชียวันนี้"},
            {"price": min(b["l"] for b in asia), "kind": "asia", "label": "ก้นกรอบเอเชียวันนี้"},
        ]
    return levels


def _round_levels(price: float, span: float) -> list[dict]:
    """เลขกลมทุก $25 ในระยะที่ราคาเอื้อมถึงได้ในวันเดียว"""
    start = int((price - span) // ROUND_STEP) * ROUND_STEP
    out = []
    value = start
    while value <= price + span:
        if abs(value - price) > 1:
            out.append({"price": float(value), "kind": "round", "label": f"เลขกลม {value:,.0f}"})
        value += ROUND_STEP
    return out


def build(bars: list[dict], price: float, max_each_side: int = 5) -> list[dict]:
    """คืนรายการแนวรับ/แนวต้านที่ใกล้ราคาปัจจุบันที่สุด เรียงจากสูงไปต่ำ

    แต่ละรายการ: {price, kind, label, side, distance, strength, touches}
    """
    if not bars:
        return []

    width = price * ZONE_WIDTH_PCT
    newest_ts = bars[-1]["ts"]
    two_days = 2 * 24 * 3600

    candidates: list[dict] = []

    # 1) โซนจากจุดกลับตัว — ต้องถูกแตะอย่างน้อย 2 ครั้งถึงจะนับเป็นโซนจริง
    for zone in _cluster(sorted(_swing_points(bars)), width):
        if zone["touches"] < 2:
            continue
        recent = zone["last_ts"] >= newest_ts - two_days
        candidates.append(
            {
                "price": zone["price"],
                "kind": "swing",
                "label": f"โซนกลับตัว (แตะ {zone['touches']} ครั้ง)",
                "touches": zone["touches"],
                # โซนที่เพิ่งถูกแตะภายใน 2 วันมีน้ำหนักกว่าโซนเก่า
                "strength": zone["touches"] * (2.0 if recent else 1.0),
            }
        )

    # 2) ระดับอ้างอิงมาตรฐาน
    for level in _reference_levels(bars):
        candidates.append({**level, "touches": 0, "strength": 3.0})

    # 3) เลขกลม — น้ำหนักน้อยสุด ใช้เติมช่องว่างเวลาที่ราคาหลุดกรอบ
    day_range = max(b["h"] for b in bars[-96:]) - min(b["l"] for b in bars[-96:])
    for level in _round_levels(price, max(day_range, 30)):
        candidates.append({**level, "touches": 0, "strength": 1.0})

    # รวมระดับที่ซ้อนกัน — เก็บตัวที่น้ำหนักสูงสุดไว้เป็นตัวแทน
    candidates.sort(key=lambda c: c["price"])
    merged: list[dict] = []
    for cand in candidates:
        if merged and cand["price"] - merged[-1]["price"] <= width:
            best = max(merged[-1], cand, key=lambda c: c["strength"])
            other = cand if best is merged[-1] else merged[-1]
            merged[-1] = {
                **best,
                "strength": best["strength"] + other["strength"] * 0.5,
                "also": other["label"],
            }
        else:
            merged.append(dict(cand))

    for level in merged:
        level["side"] = "resistance" if level["price"] > price else "support"
        level["distance"] = round(level["price"] - price, 2)
        level["price"] = round(level["price"], 2)
        level["strength"] = round(level["strength"], 1)

    above = sorted((m for m in merged if m["side"] == "resistance"), key=lambda m: m["price"])
    below = sorted((m for m in merged if m["side"] == "support"), key=lambda m: -m["price"])
    return sorted(above[:max_each_side] + below[:max_each_side], key=lambda m: -m["price"])
