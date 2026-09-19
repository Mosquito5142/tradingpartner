"""การ์ดสรุปก่อนข่าว — รวมทุกอย่างที่ควรรู้ก่อนข่าวใหญ่ตัวถัดไปไว้ที่เดียว

คืนค่าเป็น dict ธรรมดาที่ serialize เป็น JSON ได้ ไม่ยุ่งกับ HTML
เพื่อให้เว็บหรือบอต Telegram ในอนาคตเอาไปใช้ซ้ำได้โดยไม่ต้องเขียนใหม่

*** สรุปข้อมูล ไม่ใช่สัญญาณซื้อขาย ***
"""

from __future__ import annotations

from datetime import datetime

from . import levels as levels_mod
from . import reactions, translate
from .fetch import TH_TZ

# ขอบได้เปรียบของกฎทิศทางอยู่ราว 5-15 นาที หลัง 30 นาทีเท่ากับเดาสุ่ม (วัดจากข้อมูลจริง)
EDGE_WINDOW_MIN = 15


def _pick_next(events: list[dict], annotations: list[dict], now_ts: int) -> tuple[dict, dict] | None:
    """ข่าวใหญ่ตัวถัดไปที่กระทบทองแรงที่สุด — ตรรกะเดียวกับกล่อง .next เดิม"""
    upcoming = [(e, a) for e, a in zip(events, annotations) if e["ts"] >= now_ts]
    if not upcoming:
        return None

    for test in (
        lambda e, a: a.get("volatile"),
        lambda e, a: e["country"] == "US" and e["importance"] == 1,
        lambda e, a: e["importance"] == 1,
        lambda e, a: True,
    ):
        shortlist = [pair for pair in upcoming if test(*pair)]
        if shortlist:
            return min(shortlist, key=lambda p: (p[0]["ts"], p[1]["rank"]))
    return None


def _surrounding_levels(all_levels: list[dict], price: float) -> dict:
    above = [lv for lv in all_levels if lv["price"] > price]
    below = [lv for lv in all_levels if lv["price"] < price]
    return {
        "resistance": min(above, key=lambda lv: lv["price"]) if above else None,
        "support": max(below, key=lambda lv: lv["price"]) if below else None,
    }


def build(
    events: list[dict],
    annotations: list[dict],
    price: float | None = None,
    all_levels: list[dict] | None = None,
    now: datetime | None = None,
) -> dict | None:
    """ประกอบการ์ดสรุปสำหรับข่าวใหญ่ตัวถัดไป — คืน None ถ้าไม่มีข่าวข้างหน้า"""
    now = now or datetime.now(TH_TZ)
    picked = _pick_next(events, annotations, int(now.timestamp()))
    if not picked:
        return None

    event, annotation = picked
    when = datetime.fromtimestamp(event["ts"], TH_TZ)
    key = reactions.group_key(event)
    history = reactions.stats(key)

    card = {
        "ts": event["ts"],
        "when": when.strftime("%d/%m/%Y %H:%M"),
        "seconds_away": max(0, event["ts"] - int(now.timestamp())),
        "title": translate.thai_title(event) or annotation.get("th") or event["title"],
        "title_en": event["title"],
        "country": event["country"],
        "importance": event["importance"],
        "volatile": annotation.get("volatile", False),
        "kind": annotation.get("kind"),
        "forecast": event.get("forecast"),
        "previous": event.get("previous"),
        "theory": {
            "dir_if_higher": annotation.get("dir_if_higher"),
            "why": annotation.get("why"),
        },
        "edge_window_min": EDGE_WINDOW_MIN,
    }

    # --- สถิติของจริงจากคลัง ---
    if annotation.get("kind") == "number":
        at15 = next((c for c in history["curve"] if c["minutes"] == EDGE_WINDOW_MIN), None)
        card["history"] = {
            "key": key,
            "n": history["n"],
            "enough": history["enough"],
            # ตัวอย่างน้อยกว่า 3 ครั้งไม่โชว์ % เพราะบอกอะไรไม่ได้
            "accuracy15": at15["accuracy"] if (at15 and history["enough"]) else None,
            "median_move15": at15["median_move"] if at15 else None,
            "median_range60": history["median_range60"],
            "recent": history["recent"],
        }
    else:
        # ข่าวแถลง (FOMC/Powell/ECB) ไม่มีตัวเลขให้เทียบ วัดทิศทางแบบนี้ไม่ได้
        card["history"] = {"key": key, "n": 0, "enough": False, "tone_event": True}

    if price is not None and all_levels:
        card["levels"] = _surrounding_levels(all_levels, price)
        card["price"] = price

    return card


def build_from_price(events, annotations, price_data: dict | None, now=None) -> dict | None:
    """ทางลัด: คำนวณแนวรับแนวต้านจากข้อมูลราคาให้เลย"""
    if not price_data or not price_data.get("bars"):
        return build(events, annotations, now=now)
    current = price_data["price"]
    return build(
        events,
        annotations,
        price=current,
        all_levels=levels_mod.build(price_data["bars"], current),
        now=now,
    )
