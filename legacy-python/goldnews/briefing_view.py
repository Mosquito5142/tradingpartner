"""แปลงการ์ดสรุปก่อนข่าว (dict จาก briefing.py) เป็น HTML"""

from __future__ import annotations

import html

SURPRISE_TH = {"higher": "ออกสูงกว่าคาด", "lower": "ออกต่ำกว่าคาด", "inline": "ตรงตามคาด"}


def _esc(text) -> str:
    return html.escape(str(text or ""))


def _cc(country: str) -> str:
    code = (country or "??").upper()
    return f'<span class="cc {code.lower()}">{code}</span>'


def _theory_row(card: dict) -> str:
    if card.get("kind") == "tone":
        return (
            '<div class="brow"><span class="blab">ทิศทางตามทฤษฎี</span>'
            '<span class="bval">โทนผ่อนคลาย → <b class="up">▲ ทองขึ้น</b> · '
            'โทนเข้มงวด → <b class="down">▼ ทองลง</b></span></div>'
        )
    direction = card.get("theory", {}).get("dir_if_higher")
    if not direction:
        return ""
    hi = '<b class="up">▲ ทองขึ้น</b>' if direction == "up" else '<b class="down">▼ ทองลง</b>'
    lo = '<b class="down">▼ ทองลง</b>' if direction == "up" else '<b class="up">▲ ทองขึ้น</b>'
    return (
        '<div class="brow"><span class="blab">ทิศทางตามทฤษฎี</span>'
        f'<span class="bval">สูงกว่าคาด → {hi} · ต่ำกว่าคาด → {lo}</span></div>'
    )


def _history_row(card: dict) -> str:
    hist = card.get("history") or {}

    if hist.get("tone_event"):
        return (
            '<div class="brow"><span class="blab">สถิติของจริง</span>'
            '<span class="bval dim">ข่าวแถลงไม่มีตัวเลขให้เทียบ วัดความแม่นแบบนี้ไม่ได้ '
            '— ต้องฟังเนื้อหาเอง</span></div>'
        )

    n = hist.get("n", 0)
    if not hist.get("enough"):
        note = f"เก็บได้ {n} ครั้ง — ตัวอย่างยังน้อยเกินสรุป" if n else "ยังไม่เคยเก็บข่าวตัวนี้"
        extra = ""
        if hist.get("median_range60"):
            extra = f' · กรอบ 1 ชม.ที่เคยเห็น ${hist["median_range60"]}'
        return (
            '<div class="brow"><span class="blab">สถิติของจริง</span>'
            f'<span class="bval dim">{_esc(note)}{_esc(extra)}</span></div>'
        )

    bits = [f'ทฤษฎีถูก <b>{hist["accuracy15"]}%</b> ใน {card["edge_window_min"]} นาทีแรก (n={n})']
    if hist.get("median_move15"):
        bits.append(f'ขยับมัธยฐาน <b>${hist["median_move15"]}</b>')
    if hist.get("median_range60"):
        bits.append(f'กรอบ 1 ชม. <b>${hist["median_range60"]}</b>')
    return (
        '<div class="brow"><span class="blab">สถิติของจริง</span>'
        f'<span class="bval">{" · ".join(bits)}</span></div>'
    )


def _recent_row(card: dict) -> str:
    recent = (card.get("history") or {}).get("recent") or []
    if not recent:
        return ""
    items = []
    for r in recent:
        move = r.get("m15")
        if move is None:
            continue
        cls = "up" if move > 0 else ("down" if move < 0 else "flat")
        items.append(
            f'<span class="rchip"><i>{_esc(r["date"])}</i> '
            f'{_esc(SURPRISE_TH.get(r.get("surprise"), ""))} → '
            f'<b class="{cls}">{move:+.2f}</b></span>'
        )
    if not items:
        return ""
    return (
        '<div class="brow"><span class="blab">ครั้งล่าสุด (15 นาทีแรก)</span>'
        f'<span class="bval">{"".join(items)}</span></div>'
    )


def _levels_row(card: dict) -> str:
    lv = card.get("levels")
    if not lv:
        return ""
    parts = []
    if lv.get("resistance"):
        r = lv["resistance"]
        parts.append(f'<b class="down">{r["price"]:,.2f}</b> <i>(+{r["distance"]:.2f})</i> แนวต้าน')
    if lv.get("support"):
        s = lv["support"]
        parts.append(f'<b class="up">{s["price"]:,.2f}</b> <i>({s["distance"]:.2f})</i> แนวรับ')
    if not parts:
        return ""
    return (
        '<div class="brow"><span class="blab">แนวใกล้ตัว</span>'
        f'<span class="bval">{" · ".join(parts)}</span></div>'
    )


def render(card: dict | None) -> str:
    """HTML ของกล่องสรุปก่อนข่าว — คง class .next กับ data-ts ไว้ให้ JS นับถอยหลังทำงานเหมือนเดิม"""
    if not card:
        return '<div class="next"><div class="nlabel">ไม่มีข่าวในช่วงเวลาที่เลือก</div></div>'

    tags = ""
    if card.get("volatile"):
        tags += '<span class="tag vol">⚡ ผันผวนแรง</span>'
    if card.get("importance") == 1:
        tags += '<span class="tag key">ข่าวใหญ่</span>'

    numbers = []
    if card.get("forecast"):
        numbers.append(f'คาดการณ์ <b>{_esc(card["forecast"])}</b>')
    if card.get("previous"):
        numbers.append(f'ครั้งก่อน <b>{_esc(card["previous"])}</b>')
    numbers_row = (
        f'<div class="brow"><span class="blab">ตัวเลข</span>'
        f'<span class="bval">{" · ".join(numbers)}</span></div>'
        if numbers else ""
    )

    return f"""
    <div class="next brief" data-ts="{card['ts']}">
      <div class="nlabel">ข่าวใหญ่ตัวถัดไป</div>
      <div class="ntitle">{_cc(card['country'])} {_esc(card['title'])}{tags}</div>
      <div class="nwhen">{_esc(card['when'])} น. · <span class="en">{_esc(card['title_en'])}</span></div>
      <div class="ncount" id="countdown">—</div>

      <div class="bgrid">
        {numbers_row}
        {_theory_row(card)}
        {_history_row(card)}
        {_recent_row(card)}
        {_levels_row(card)}
      </div>

      <div class="bwarn">ขอบได้เปรียบของกฎทิศทางอยู่ราว 5–{card['edge_window_min']} นาทีแรกเท่านั้น
        — วัดจากข้อมูลจริงพบว่าหลัง 30 นาทีความแม่นตกเหลือ ~50% เท่ากับเดาสุ่ม</div>
    </div>"""


CSS = """
.next.brief{padding-bottom:12px}
.next .ntitle .tag{vertical-align:2px}
.next .nwhen .en{color:#6d7686}
.bgrid{margin-top:10px;border-top:1px solid #262d3a;padding-top:8px;
 display:flex;flex-direction:column;gap:4px}
.brow{display:grid;grid-template-columns:150px 1fr;gap:10px;font-size:12.8px;align-items:baseline}
.blab{color:#6d7686;font-size:11.5px}
.bval{color:#c7cdd8}
.bval b{color:#e6e8eb;font-variant-numeric:tabular-nums}
.bval b.up{color:#5fd68e}
.bval b.down{color:#ff7a7f}
.bval b.flat{color:#8b94a3}
.bval i{color:#6d7686;font-style:normal}
.bval.dim{color:#7b8494}
.rchip{display:inline-block;background:#1a1f29;border:1px solid #262d3a;border-radius:5px;
 padding:1px 8px;margin-right:6px;font-size:12px}
.rchip i{margin-right:5px}
.bwarn{margin-top:9px;font-size:11.8px;color:#c0a060;background:#221d12;
 border:1px solid #3a3020;border-radius:6px;padding:6px 10px;line-height:1.55}
@media(max-width:700px){
  .brow{grid-template-columns:1fr;gap:1px}
  .blab{font-size:11px}
}
"""
