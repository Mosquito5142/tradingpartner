"""กราฟแท่งเทียน 15 นาทีแบบ SVG ล้วน

เขียนเป็น SVG ฝังในหน้าเว็บโดยตรง ไม่โหลดไลบรารีจากอินเทอร์เน็ต
ไฟล์ HTML จึงยังเปิดดูได้แม้ไม่มีเน็ต
"""

from __future__ import annotations

import html
from datetime import datetime

from .fetch import TH_TZ

WIDTH = 1120
HEIGHT = 430
PAD_L = 10
PAD_R = 96      # เว้นที่ให้ป้ายราคาและชื่อแนวรับแนวต้าน
PAD_T = 12
PAD_B = 28


def _esc(text) -> str:
    return html.escape(str(text or ""))


def render(bars: list[dict], levels: list[dict], events: list[dict], price: float, count: int = 96) -> str:
    """bars = แท่ง 15 นาทีเรียงตามเวลา, levels = ผลจาก levels.build(), events = ข่าววันนี้"""
    bars = bars[-count:]
    if len(bars) < 5:
        return '<div class="chartbox"><p class="dim">ข้อมูลราคาไม่พอวาดกราฟ</p></div>'

    plot_w = WIDTH - PAD_L - PAD_R
    plot_h = HEIGHT - PAD_T - PAD_B

    lows = [b["l"] for b in bars]
    highs = [b["h"] for b in bars]
    # เผื่อขอบให้เห็นแนวรับแนวต้านที่อยู่นอกกรอบราคานิดหน่อย
    near = [lv["price"] for lv in levels if min(lows) - 12 <= lv["price"] <= max(highs) + 12]
    lo = min(lows + near) - 2
    hi = max(highs + near) + 2
    span = max(hi - lo, 1e-6)

    def y_of(p: float) -> float:
        return PAD_T + (hi - p) / span * plot_h

    def x_of(i: float) -> float:
        return PAD_L + (i + 0.5) / len(bars) * plot_w

    slot = plot_w / len(bars)
    body_w = max(1.6, slot * 0.62)

    parts: list[str] = []

    # ----- เส้นกริดราคา -----
    step = 10 if span <= 90 else (20 if span <= 180 else 50)
    grid = (int(lo) // step) * step
    while grid <= hi:
        if grid >= lo:
            y = y_of(grid)
            parts.append(f'<line class="grid" x1="{PAD_L}" y1="{y:.1f}" x2="{PAD_L + plot_w}" y2="{y:.1f}"/>')
            parts.append(f'<text class="axis" x="{PAD_L + plot_w + 6}" y="{y + 3.5:.1f}">{grid:,.0f}</text>')
        grid += step

    # ----- เส้นแบ่งชั่วโมง + ป้ายเวลา -----
    last_hour = None
    for i, bar in enumerate(bars):
        dt = datetime.fromtimestamp(bar["ts"], TH_TZ)
        if dt.hour != last_hour and dt.hour % 3 == 0:
            last_hour = dt.hour
            x = x_of(i)
            parts.append(f'<line class="vgrid" x1="{x:.1f}" y1="{PAD_T}" x2="{x:.1f}" y2="{PAD_T + plot_h}"/>')
            parts.append(f'<text class="axis mid" x="{x:.1f}" y="{HEIGHT - 9}">{dt:%H:%M}</text>')

    # ----- แนวรับแนวต้าน -----
    # เส้นวาดทุกเส้น แต่ป้ายราคาข้ามตัวที่ชิดกันเกินไป ไม่งั้นตัวเลขทับกันอ่านไม่ออก
    label_ys: list[float] = []
    for level in sorted((lv for lv in levels if lo < lv["price"] < hi), key=lambda lv: -lv["price"]):
        p = level["price"]
        y = y_of(p)
        cls = "res" if level["side"] == "resistance" else "sup"
        parts.append(f'<line class="lvl {cls}" x1="{PAD_L}" y1="{y:.1f}" x2="{PAD_L + plot_w}" y2="{y:.1f}"/>')
        if all(abs(y - prev) >= 11 for prev in label_ys):
            label_ys.append(y)
            parts.append(
                f'<text class="lvltag {cls}" x="{PAD_L + plot_w + 6}" y="{y - 4:.1f}">{p:,.2f}</text>'
            )

    # ----- แท่งเทียน -----
    for i, bar in enumerate(bars):
        x = x_of(i)
        up = bar["c"] >= bar["o"]
        cls = "up" if up else "dn"
        top, bottom = max(bar["o"], bar["c"]), min(bar["o"], bar["c"])
        y_top, y_bottom = y_of(top), y_of(bottom)
        parts.append(
            f'<line class="wick {cls}" x1="{x:.1f}" y1="{y_of(bar["h"]):.1f}" '
            f'x2="{x:.1f}" y2="{y_of(bar["l"]):.1f}"/>'
        )
        parts.append(
            f'<rect class="body {cls}" x="{x - body_w / 2:.1f}" y="{y_top:.1f}" '
            f'width="{body_w:.1f}" height="{max(1.0, y_bottom - y_top):.1f}"/>'
        )

    # ----- เส้นราคาปัจจุบัน -----
    if lo < price < hi:
        y = y_of(price)
        parts.append(f'<line class="now" x1="{PAD_L}" y1="{y:.1f}" x2="{PAD_L + plot_w}" y2="{y:.1f}"/>')
        parts.append(f'<rect class="nowtag" x="{PAD_L + plot_w + 2}" y="{y - 8:.1f}" width="62" height="16" rx="3"/>')
        parts.append(f'<text class="nowtxt" x="{PAD_L + plot_w + 6}" y="{y + 4:.1f}">{price:,.2f}</text>')

    # ----- หมุดเวลาข่าว -----
    first_ts, last_ts = bars[0]["ts"], bars[-1]["ts"] + 900
    now_ts = int(datetime.now(TH_TZ).timestamp())
    for event in events:
        ts = event["ts"]
        if not (first_ts <= ts <= last_ts):
            continue
        x = x_of((ts - first_ts) / 900)
        cls = "past" if ts < now_ts else "soon"
        parts.append(f'<line class="news {cls}" x1="{x:.1f}" y1="{PAD_T}" x2="{x:.1f}" y2="{PAD_T + plot_h}"/>')
        parts.append(
            f'<text class="newstag {cls}" x="{x + 3:.1f}" y="{PAD_T + 12}">'
            f'{_esc(event["label"])}</text>'
        )

    return (
        f'<svg class="chart" viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="xMidYMid meet" '
        f'role="img" aria-label="กราฟแท่งเทียน 15 นาที">{"".join(parts)}</svg>'
    )


CSS = """
.chartbox{background:#11151c;border:1px solid #232a36;border-radius:10px;padding:10px 12px;margin-top:12px;
 overflow-x:auto}
.chart{width:100%;min-width:680px;height:auto;display:block}
.chart .grid{stroke:#1d2430;stroke-width:1}
.chart .vgrid{stroke:#181e28;stroke-width:1}
.chart .axis{fill:#6d7686;font-size:10.5px;font-family:inherit}
.chart .axis.mid{text-anchor:middle}
.chart .wick{stroke-width:1}
.chart .wick.up,.chart .body.up{stroke:#3fb87a;fill:#3fb87a}
.chart .wick.dn,.chart .body.dn{stroke:#e5484d;fill:#e5484d}
.chart .lvl{stroke-width:1;stroke-dasharray:5 4;opacity:.75}
.chart .lvl.res{stroke:#e5484d}
.chart .lvl.sup{stroke:#3fb87a}
.chart .lvltag{font-size:10px;font-family:inherit}
.chart .lvltag.res{fill:#ff8b8f}
.chart .lvltag.sup{fill:#6fdca2}
.chart .now{stroke:#f0b429;stroke-width:1;stroke-dasharray:2 2}
.chart .nowtag{fill:#f0b429}
.chart .nowtxt{fill:#161b23;font-size:10.5px;font-weight:700;font-family:inherit}
.chart .news{stroke-width:1;stroke-dasharray:3 3}
.chart .news.soon{stroke:#8fb6ef}
.chart .news.past{stroke:#3a4354}
.chart .newstag{font-size:9.5px;font-family:inherit}
.chart .newstag.soon{fill:#8fb6ef}
.chart .newstag.past{fill:#4a5567}
"""
