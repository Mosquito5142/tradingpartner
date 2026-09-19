"""ปฏิทินข่าวเทรดทอง (XAUUSD) — กดครั้งเดียวได้ตารางข่าวล่วงหน้าเป็นเวลาไทย

วิธีใช้:
    python gold_news.py                # ดึงข้อมูลแล้วเปิดหน้าเว็บให้อัตโนมัติ
    python gold_news.py --days 30      # ดูล่วงหน้า 30 วัน
    python gold_news.py --text         # พิมพ์ตารางลงหน้าจอด้วย
    python gold_news.py --all          # รวมข่าวความแรงระดับเบาด้วย
    python gold_news.py --no-open      # ไม่ต้องเปิดเบราว์เซอร์
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

from goldnews import (bias, briefing, chart, fetch, hours, levels, price,
                      reactions, render, translate)

ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "config.json"
DEFAULT_OUT = ROOT / "out" / "calendar.html"

DEFAULT_CONFIG = {
    "days_ahead": 14,
    "days_back": 1,
    "countries": ["US", "EU", "CN"],
    "min_importance": 0,
    "open_browser": True,
    "show_plan": True,
    "broker_offset": 0.0,
    "account_balance": 1000,
    "account_type": "cent",
    "risk_percent": 2,
}


def load_config() -> dict:
    config = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        try:
            user = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            config.update({k: v for k, v in user.items() if not k.startswith("_")})
        except json.JSONDecodeError as exc:
            print(f"⚠️  อ่าน config.json ไม่ได้ ({exc}) — ใช้ค่าเริ่มต้นแทน", file=sys.stderr)
    return config


def keep(event: dict, min_importance: int, drop_noise: bool = True) -> bool:
    """ข่าวสำคัญต่อทองจะถูกแสดงเสมอ แม้ต้นทางจะจัดความแรงไว้ต่ำกว่าเกณฑ์"""
    if drop_noise and translate.is_noise(event):
        return False
    if event["importance"] >= min_importance:
        return True
    return bias.is_key_event(event)


def print_text(events: list[dict], annotations: list[dict]) -> None:
    arrow = {"up": "▲ ทองขึ้น", "down": "▼ ทองลง", "": "—"}
    impact = {1: "!!!", 0: "!! ", -1: "!  "}
    current_day = None

    for ev, ann in zip(events, annotations):
        dt = datetime.fromtimestamp(ev["ts"], fetch.TH_TZ)
        if dt.date() != current_day:
            current_day = dt.date()
            print(f"\n=== {render.thai_date(dt)} ===")

        name = translate.thai_title(ev) or ann.get("th") or ev["title"]
        line = f"  {dt:%H:%M} {impact.get(ev['importance'], '   ')} {render.FLAGS.get(ev['country'], '')} {name}"
        if ann.get("volatile"):
            line += "  [ผันผวนแรง]"
        print(line)

        numbers = " | ".join(
            f"{label} {ev[key]}"
            for key, label in (("forecast", "คาด"), ("previous", "ก่อนหน้า"), ("actual", "จริง"))
            if ev.get(key)
        )
        if numbers:
            print(f"        {numbers}")

        if ann.get("kind") == "number":
            higher = arrow[ann["dir_if_higher"]]
            lower = arrow["up" if ann["dir_if_higher"] == "down" else "down"]
            print(f"        สูงกว่าคาด → {higher}   /   ต่ำกว่าคาด → {lower}")
        elif ann.get("kind") == "tone":
            print("        โทนผ่อนคลาย → ▲ ทองขึ้น   /   โทนเข้มงวด → ▼ ทองลง")


def update_lab(days_back: int = 60, countries: list[str] | None = None) -> dict:
    """เก็บปฏิกิริยาข่าวลงคลัง — ดึงปฏิทินทีละช่วง 60 วันเพราะ API ตัดข้อมูลถ้าขอยาวเกิน"""
    countries = countries or ["US", "EU", "CN"]
    now = datetime.now(fetch.UTC)

    events: dict[str, dict] = {}
    for back in range(0, max(days_back, 1), 60):
        window_start = now - timedelta(days=back + 60)
        window_end = now - timedelta(days=back)
        try:
            for event in fetch.fetch_tradingview(window_start, window_end, countries):
                events[event["id"] or f'{event["ts"]}:{event["title"]}'] = event
        except (OSError, ValueError, RuntimeError) as exc:
            print(f"⚠️  ดึงปฏิทินช่วง {back}-{back+60} วันก่อนไม่สำเร็จ: {exc}", file=sys.stderr)

    if not events:
        return {"added": 0, "filled": 0, "total": 0}

    try:
        bars = price.fetch_gcf_5m()
    except (OSError, ValueError, KeyError, IndexError) as exc:
        print(f"⚠️  ดึงราคา 5 นาทีไม่สำเร็จ ข้ามการเก็บสถิติ: {exc}", file=sys.stderr)
        return {"added": 0, "filled": 0, "total": 0}

    return reactions.update_store(list(events.values()), bars)


def print_lab() -> None:
    """พิมพ์สรุปคลัง Reaction Lab"""
    info = reactions.summary()
    if not info["total"]:
        print("คลังยังว่าง — ลองรัน --backfill ก่อน")
        return

    oldest = datetime.fromtimestamp(info["oldest"], fetch.TH_TZ)
    newest = datetime.fromtimestamp(info["newest"], fetch.TH_TZ)
    print(f"\n=== Reaction Lab: {info['total']} รายการ "
          f"({oldest:%d/%m/%y} - {newest:%d/%m/%y}) ===")

    print("\nทฤษฎีใน bias.py แม่นแค่ไหน เมื่อวัดกับราคาจริง:")
    for row in info["curve"]:
        bar = "█" * round(row["accuracy"] / 3)
        print(f"  {row['minutes']:>3} นาที  {row['accuracy']:>3}%  n={row['n']:<4} "
              f"ขยับ ${row['median_move']:<6} {bar}")
    print("  (50% = เท่ากับเดาสุ่ม)")

    print("\nแยกตามกลุ่มข่าว — ดู % ถูก คู่กับระยะที่ขยับเสมอ:")
    for seg in info["breakdown"]:
        at15 = next((c for c in seg["curve"] if c["minutes"] == 15), None)
        if not at15:
            continue
        print(f"  {seg['label']:<16} n={seg['n']:<4} 15 นาที ถูก {at15['accuracy']:>3}%  "
              f"ขยับมัธยฐาน ${at15['median_move']}")
    print("  หมายเหตุ: แม่นสูงแต่ขยับน้อย (ต่ำกว่า ~$5) แทบไม่เหลืออะไรหลังหักสเปรด")

    print("\nข่าวที่เก็บตัวอย่างได้มากสุด:")
    for key, count in info["groups"][:8]:
        print(f"  {count:>3}x  {key}")


def build_plan(events: list[dict], annotations: list[dict], config: dict) -> dict | None:
    """ประกอบข้อมูลส่วน "แผนวันนี้": ราคา + กราฟ + ช่วงเวลาน่าจับตา + แนวรับแนวต้าน"""
    print("กำลังดึงราคาทอง 15 นาที ...")
    try:
        data = price.load(broker_offset=float(config.get("broker_offset", 0.0)))
    except RuntimeError as exc:
        print(f"⚠️  ข้ามส่วนกราฟ: {exc}", file=sys.stderr)
        return None

    now = datetime.now(fetch.TH_TZ)
    current = data["price"]

    level_rows = levels.build(data["bars"], current)
    profile = hours.volatility_profile(data["profile_bars"] or data["bars"])
    hour_rows = hours.today_hours(events, annotations, profile, now)

    today = now.date()
    todays_events = [
        {
            "ts": e["ts"],
            "label": datetime.fromtimestamp(e["ts"], fetch.TH_TZ).strftime("%H:%M"),
        }
        for e, a in zip(events, annotations)
        if datetime.fromtimestamp(e["ts"], fetch.TH_TZ).date() == today
        and (e["importance"] == 1 or a.get("volatile"))
    ]

    return {
        "config": config,
        "noise15": reactions.news_noise(15),
        "price": current,
        "spot": data.get("spot"),
        "basis": data.get("basis"),
        "broker_offset": data.get("broker_offset", 0.0),
        "levels": level_rows,
        "hours": hour_rows,
        "top_windows": hours.top_windows(hour_rows, now),
        "chart_svg": chart.render(data["bars"], level_rows, todays_events, current),
        "stale": data.get("stale", False),
        "errors": data.get("errors", []),
    }


def main() -> int:
    # บังคับ UTF-8 เพื่อไม่ให้ภาษาไทยเป็นตัวยึกยือบน Windows console
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    parser = argparse.ArgumentParser(description="ปฏิทินข่าวเทรดทอง XAUUSD (เวลาไทย)")
    parser.add_argument("--days", type=int, help="จำนวนวันที่ดูล่วงหน้า")
    parser.add_argument("--back", type=int, help="จำนวนวันย้อนหลังที่แสดงด้วย")
    parser.add_argument("--all", action="store_true", help="แสดงข่าวความแรงระดับเบาด้วย")
    parser.add_argument("--text", action="store_true", help="พิมพ์ตารางลงหน้าจอ")
    parser.add_argument("--no-open", action="store_true", help="ไม่ต้องเปิดเบราว์เซอร์")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="ที่เก็บไฟล์ HTML")
    parser.add_argument("--no-chart", action="store_true", help="ข้ามส่วนกราฟและแนวรับแนวต้าน")
    parser.add_argument("--lab", action="store_true", help="แสดงสถิติ Reaction Lab ในหน้าจอ")
    parser.add_argument("--backfill", action="store_true",
                        help="เก็บข้อมูลปฏิกิริยาข่าวย้อนหลังเท่าที่แหล่งข้อมูลมี แล้วออก")
    args = parser.parse_args()

    config = load_config()

    if args.backfill:
        print("กำลังเก็บข้อมูลปฏิกิริยาข่าวย้อนหลัง (อาจใช้เวลาสักครู่) ...")
        result = update_lab(60, config["countries"])
        print(f"✅ เพิ่ม {result['added']} · เติมของเดิม {result['filled']} · รวมในคลัง {result['total']}")
        print_lab()
        return 0

    days_ahead = args.days or config["days_ahead"]
    days_back = config["days_back"] if args.back is None else args.back
    min_importance = -1 if args.all else config["min_importance"]

    print(f"กำลังดึงข่าว {days_ahead} วันข้างหน้า ({', '.join(config['countries'])}) ...")
    try:
        result = fetch.load(days_back, days_ahead, config["countries"])
    except RuntimeError as exc:
        print(f"\n❌ {exc}", file=sys.stderr)
        return 1

    for note in result["errors"]:
        print(f"⚠️  {note}", file=sys.stderr)

    pairs = [
        (e, bias.annotate(e))
        for e in result["events"]
        if keep(e, min_importance, drop_noise=not args.all)
    ]
    if not pairs:
        print("ไม่พบข่าวตามเงื่อนไขที่ตั้งไว้ — ลองเพิ่ม --days หรือใช้ --all", file=sys.stderr)
        return 1

    # เวลาเดียวกัน -> ข่าวแรงกว่าและกระทบทองมากกว่า (rank ต่ำ) ขึ้นก่อน
    pairs.sort(key=lambda p: (p[0]["ts"], -p[0]["importance"], p[1]["rank"], p[0]["title"]))
    events = [e for e, _ in pairs]
    annotations = [a for _, a in pairs]

    if args.text:
        print_text(events, annotations)

    # เก็บปฏิกิริยาข่าวที่เพิ่งออกลงคลังทุกครั้งที่รัน — ยิ่งรันบ่อยยิ่งมีตัวอย่างมาก
    lab = update_lab(60, config["countries"])
    if lab["added"] or lab["filled"]:
        print(f"Reaction Lab: เพิ่ม {lab['added']} · เติม {lab['filled']} · รวม {lab['total']}")

    plan = None
    if config.get("show_plan", True) and not args.no_chart:
        plan = build_plan(events, annotations, config)

    card = briefing.build(
        events, annotations,
        price=plan["price"] if plan else None,
        all_levels=plan["levels"] if plan else None,
    )
    if card:
        (ROOT / "out").mkdir(parents=True, exist_ok=True)
        (ROOT / "out" / "briefing.json").write_text(
            json.dumps(card, ensure_ascii=False, indent=1), encoding="utf-8")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render.render(events, annotations, result, plan, card), encoding="utf-8")

    big = sum(1 for e in events if e["importance"] == 1)
    print(f"\n✅ พบ {len(events)} รายการ (ข่าวใหญ่ {big} รายการ) → {args.out}")

    if args.lab:
        print_lab()

    if not args.no_open and config.get("open_browser", True):
        os.startfile(args.out)  # noqa: S606 - เปิดไฟล์ HTML ในเบราว์เซอร์เริ่มต้นของ Windows

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
