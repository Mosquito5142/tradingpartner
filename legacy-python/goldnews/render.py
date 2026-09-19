"""สร้างหน้าเว็บ HTML ไฟล์เดียว (self-contained ไม่ต้องต่อเน็ตตอนเปิด)"""

from __future__ import annotations

import html
from datetime import datetime, timedelta

from . import briefing_view, chart, plan_view, translate
from .bias import thai_period
from .fetch import TH_TZ

THAI_DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]
THAI_MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
]

# Windows ไม่มีฟอนต์ emoji ธงชาติ (จะกลายเป็นตัวอักษร "US") จึงใช้ป้ายรหัสประเทศแทน
FLAGS = {
    "US": "US", "EU": "EU", "CN": "CN", "GB": "GB", "JP": "JP",
    "DE": "DE", "CH": "CH", "CA": "CA", "AU": "AU", "NZ": "NZ",
}


def _cc(country: str) -> str:
    """ป้ายรหัสประเทศ เช่น <span class="cc us">US</span>"""
    code = FLAGS.get(country, country or "??")
    return f'<span class="cc {code.lower()}">{code}</span>' 

COUNTRY_TH = {
    "US": "สหรัฐฯ", "EU": "ยูโรโซน", "CN": "จีน", "GB": "อังกฤษ", "JP": "ญี่ปุ่น",
    "DE": "เยอรมนี", "CH": "สวิส", "CA": "แคนาดา", "AU": "ออสเตรเลีย", "NZ": "นิวซีแลนด์",
}

IMPACT_TH = {1: ("แรง", "hi"), 0: ("กลาง", "mid"), -1: ("เบา", "lo")}


def thai_date(dt: datetime) -> str:
    return f"{THAI_DAYS[dt.weekday()]} {dt.day} {THAI_MONTHS[dt.month - 1]} {dt.year + 543}"


def _relative_day(day: datetime, today: datetime) -> str:
    diff = (day.date() - today.date()).days
    if diff == 0:
        return "วันนี้"
    if diff == 1:
        return "พรุ่งนี้"
    if diff == -1:
        return "เมื่อวาน"
    if diff < 0:
        return f"{-diff} วันที่แล้ว"
    return f"อีก {diff} วัน"


def _esc(text) -> str:
    return html.escape(str(text or ""))


def _bias_cell(ann: dict) -> str:
    kind = ann.get("kind")
    if kind == "number":
        up_first = ann["dir_if_higher"] == "up"
        hi_cls, hi_txt = ("up", "▲ ทองขึ้น") if up_first else ("down", "▼ ทองลง")
        lo_cls, lo_txt = ("down", "▼ ทองลง") if up_first else ("up", "▲ ทองขึ้น")
        return (
            f'<div class="bias">'
            f'<div class="bline"><span class="cond">สูงกว่าคาด</span>'
            f'<span class="b {hi_cls}">{hi_txt}</span></div>'
            f'<div class="bline"><span class="cond">ต่ำกว่าคาด</span>'
            f'<span class="b {lo_cls}">{lo_txt}</span></div>'
            f"</div>"
        )
    if kind == "tone":
        return (
            '<div class="bias">'
            '<div class="bline"><span class="cond">โทนผ่อนคลาย</span>'
            '<span class="b up">▲ ทองขึ้น</span></div>'
            '<div class="bline"><span class="cond">โทนเข้มงวด</span>'
            '<span class="b down">▼ ทองลง</span></div>'
            "</div>"
        )
    return '<div class="bias"><span class="b none">—</span></div>'


def _outcome_badge(ann: dict) -> str:
    outcome = ann.get("outcome")
    if not outcome:
        return ""
    label = {
        "up": ("ผลจริงหนุนทอง ▲", "up"),
        "down": ("ผลจริงกดดันทอง ▼", "down"),
        "neutral": ("ออกตรงตามคาด ทองมักนิ่ง", "flat"),
    }[outcome]
    surprise = {"higher": "สูงกว่าคาด", "lower": "ต่ำกว่าคาด", "inline": "ตรงตามคาด"}
    prefix = surprise.get(ann.get("surprise", ""), "")
    return f'<span class="outcome {label[1]}">{prefix} → {label[0]}</span>'


def _event_row(ev: dict, ann: dict, now_ts: int) -> str:
    dt = datetime.fromtimestamp(ev["ts"], TH_TZ)
    impact_txt, impact_cls = IMPACT_TH.get(ev["importance"], ("เบา", "lo"))
    past = "past" if ev["ts"] < now_ts else ""

    tags = ""
    if ann.get("volatile"):
        tags += '<span class="tag vol">⚡ ผันผวนแรง</span>'
    if ev["importance"] == 1:
        tags += '<span class="tag key">ข่าวใหญ่</span>'

    period = thai_period(ev.get("period", ""))

    th_title = translate.thai_title(ev) or ann.get("th")
    title_html = (
        f'<b>{_esc(th_title)}</b> <span class="en">{_esc(ev["title"])}</span>'
        if th_title else f'<b class="en-only">{_esc(ev["title"])}</b>'
    )

    nums = []
    if ev.get("forecast"):
        nums.append(f'<span class="n"><i>คาดการณ์</i><b>{_esc(ev["forecast"])}</b></span>')
    if ev.get("previous"):
        nums.append(f'<span class="n"><i>ครั้งก่อน</i><b>{_esc(ev["previous"])}</b></span>')
    if ev.get("actual"):
        nums.append(f'<span class="n act"><i>ผลจริง</i><b>{_esc(ev["actual"])}</b></span>')
    if not nums:
        nums.append('<span class="n"><i>&nbsp;</i><b class="dim">ไม่มีตัวเลข</b></span>')

    why = ann.get("why", "")
    show_why = why and (ev["importance"] == 1 or ann.get("volatile"))
    meta_bits = [b for b in (COUNTRY_TH.get(ev["country"], ev["country"]), period) if b]

    return f"""
    <div class="ev {past}" data-imp="{ev['importance']}" data-c="{_esc(ev['country'])}" data-ts="{ev['ts']}" title="{_esc(why)}">
      <div class="time"><b>{dt.strftime('%H:%M')}</b><span class="dot {impact_cls}" title="ความแรง: {impact_txt}"></span></div>
      <div class="main">
        <div class="title">{_cc(ev['country'])} {title_html}{tags}</div>
        <div class="meta">{_esc(' · '.join(meta_bits))}</div>
        {f'<div class="why">{_esc(why)}</div>' if show_why else ''}
        {_outcome_badge(ann)}
      </div>
      <div class="nums">{''.join(nums)}</div>
      {_bias_cell(ann)}
    </div>"""


def _noise_const(plan: dict | None) -> str:
    """ค่าคงที่ฝั่ง JS: ระยะแกว่งปกติช่วงข่าว ใช้เตือนใน เครื่องคำนวณความเสี่ยง"""
    noise = (plan or {}).get("noise15") or 8.9
    return "var NOISE15=" + str(noise) + ";\n"


def render(events: list[dict], annotations: list[dict], meta: dict,
           plan: dict | None = None, card: dict | None = None) -> str:
    """events/annotations เรียงตามเวลาแล้ว (index ตรงกัน)"""
    now = datetime.now(TH_TZ)
    now_ts = int(now.timestamp())

    fetched = (
        datetime.fromtimestamp(meta["fetched_at"], TH_TZ).strftime("%d/%m/%Y %H:%M")
        if meta.get("fetched_at") else "ไม่ทราบ"
    )

    upcoming = [(e, a) for e, a in zip(events, annotations) if e["ts"] >= now_ts]
    def _shortlist(test):
        return [pair for pair in upcoming if test(*pair)]

    candidates = (
        _shortlist(lambda e, a: a.get("volatile"))
        or _shortlist(lambda e, a: e["country"] == "US" and e["importance"] == 1)
        or _shortlist(lambda e, a: e["importance"] == 1)
        or upcoming
    )
    # ข่าวที่ประกาศพร้อมกันหลายตัว ให้หยิบตัวที่กระทบทองแรงที่สุดมาโชว์ (rank ต่ำสุด)
    next_big = min(candidates, key=lambda p: (p[0]["ts"], p[1]["rank"])) if candidates else None

    if card:
        next_html = briefing_view.render(card)
    elif next_big:
        nb_ev, nb_ann = next_big
        nb_dt = datetime.fromtimestamp(nb_ev["ts"], TH_TZ)
        next_html = f"""
        <div class="next" data-ts="{nb_ev['ts']}">
          <div class="nlabel">ข่าวใหญ่ตัวถัดไป</div>
          <div class="ntitle">{_cc(nb_ev['country'])} {_esc(translate.thai_title(nb_ev) or nb_ann.get('th') or nb_ev['title'])}</div>
          <div class="nwhen">{thai_date(nb_dt)} เวลา {nb_dt.strftime('%H:%M')} น.</div>
          <div class="ncount" id="countdown">—</div>
        </div>"""
    else:
        next_html = briefing_view.render(None)

    # จัดกลุ่มตามวัน (เวลาไทย)
    groups: list[tuple[datetime, list[str]]] = []
    current_key = None
    for ev, ann in zip(events, annotations):
        dt = datetime.fromtimestamp(ev["ts"], TH_TZ)
        key = dt.date()
        if key != current_key:
            current_key = key
            groups.append((dt, []))
        groups[-1][1].append(_event_row(ev, ann, now_ts))

    body = []
    now_marker_placed = False
    for day_dt, rows in groups:
        if not now_marker_placed and day_dt.date() > now.date():
            body.append('<div class="nowline"><span>ตอนนี้ ' + now.strftime("%H:%M") + ' น.</span></div>')
            now_marker_placed = True
        rel = _relative_day(day_dt, now)
        today_cls = " today" if day_dt.date() == now.date() else ""
        body.append(
            f'<section class="day{today_cls}">'
            f'<h2>{thai_date(day_dt)} <span class="rel">{rel}</span></h2>'
            f'{"".join(rows)}</section>'
        )
    if not now_marker_placed:
        body.append('<div class="nowline"><span>ตอนนี้ ' + now.strftime("%H:%M") + ' น.</span></div>')

    stale_banner = ""
    if meta.get("stale"):
        stale_banner = (
            '<div class="banner">⚠️ ดึงข้อมูลใหม่ไม่สำเร็จ — กำลังแสดงข้อมูลที่บันทึกไว้ครั้งล่าสุด '
            f'(อัปเดตเมื่อ {fetched}) กรุณาเช็กอินเทอร์เน็ตแล้วกดใหม่อีกครั้ง</div>'
        )

    countries = sorted({e["country"] for e in events})
    country_btns = "".join(
        f'<button class="chip on" data-filter="country" data-value="{c}">'
        f'{FLAGS.get(c, "🏳️")} {COUNTRY_TH.get(c, c)}</button>'
        for c in countries
    )

    substitutions = {
        "__CSS__": _CSS + plan_view.CSS + chart.CSS + briefing_view.CSS,
        # NOISE15 = ระยะแกว่งปกติช่วงข่าว ใช้ในเครื่องคำนวณความเสี่ยง
        "__JS__": _noise_const(plan) + _JS + plan_view.RISK_JS,
        "__STALE__": stale_banner,
        "__FETCHED__": fetched,
        "__SOURCE__": _esc(meta.get("source", "")),
        "__NEXT__": next_html,
        "__PLAN__": plan_view.render(plan) if plan else "",
        "__COUNTRY_BTNS__": country_btns,
        "__BODY__": "".join(body),
        "__TOTAL__": str(len(events)),
    }
    page = _TEMPLATE
    for placeholder, value in substitutions.items():
        page = page.replace(placeholder, value)
    return page


_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0e1116;color:#e6e8eb;
 font-family:"Leelawadee UI","Noto Sans Thai","Segoe UI",system-ui,sans-serif;
 font-size:15px;line-height:1.55;padding:0 0 60px}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px}
header{background:linear-gradient(160deg,#1a1f29,#12151b);border-bottom:1px solid #262c38;
 padding:22px 0 18px;margin-bottom:18px}
h1{font-size:23px;letter-spacing:.2px}
h1 .g{color:#f0b429}
.sub{color:#8b94a3;font-size:13px;margin-top:4px}
.banner{background:#4a2116;border:1px solid #7c3a22;color:#ffc9b4;padding:10px 14px;
 border-radius:8px;margin:12px 0;font-size:13.5px}

.next{background:#161b23;border:1px solid #2b3342;border-left:4px solid #f0b429;
 border-radius:10px;padding:14px 18px;margin-top:14px}
.nlabel{color:#8b94a3;font-size:12px;letter-spacing:.5px}
.ntitle{font-size:19px;font-weight:700;margin-top:2px}
.nwhen{color:#b9c0cc;font-size:13.5px}
.ncount{color:#f0b429;font-size:22px;font-weight:700;margin-top:6px;font-variant-numeric:tabular-nums}

.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:18px 0 8px}
.bar .lbl{color:#8b94a3;font-size:12.5px;margin-right:2px}
.chip{background:#1a1f29;border:1px solid #2e3644;color:#9aa3b2;border-radius:20px;
 padding:6px 13px;font-size:13px;cursor:pointer;font-family:inherit;transition:.12s}
.chip:hover{border-color:#4a5567}
.chip.on{background:#22314a;border-color:#3d6fb5;color:#dbe6f7}
.sep{width:1px;height:22px;background:#2e3644;margin:0 4px}

.nowline{display:flex;align-items:center;gap:10px;margin:22px 0 14px;color:#f0b429;font-size:12.5px}
.nowline:before,.nowline:after{content:"";flex:1;height:1px;background:#3a3020}
.nowline span{white-space:nowrap}

.day{margin-bottom:22px}
.day h2{font-size:15.5px;color:#c7cdd8;padding:7px 12px;background:#161b23;
 border-radius:7px;border-left:3px solid #3a4354;margin-bottom:8px;font-weight:600}
.day.today h2{border-left-color:#f0b429;color:#f5d78e}
.day h2 .rel{color:#7b8494;font-weight:400;font-size:13px;margin-left:6px}

.ev{display:grid;grid-template-columns:72px 1fr 190px 175px;gap:12px;align-items:start;
 padding:11px 12px;border-bottom:1px solid #1c212b}
.ev:hover{background:#141922}
.ev.past{opacity:.45}
.ev.hidden{display:none}
.time{display:flex;align-items:center;gap:7px;font-variant-numeric:tabular-nums}
.time b{font-size:15.5px}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
.dot.hi{background:#e5484d;box-shadow:0 0 7px #e5484d88}
.dot.mid{background:#f0b429}
.dot.lo{background:#4a5567}

.cc{display:inline-block;min-width:26px;text-align:center;font-size:10.5px;font-weight:700;
 letter-spacing:.4px;padding:1px 5px;border-radius:4px;background:#222a36;color:#9aa3b2;
 border:1px solid #313a49;vertical-align:2px}
.cc.us{background:#1d2b45;color:#8fb6ef;border-color:#2f4a74}
.cc.eu{background:#1f2545;color:#a3a8f0;border-color:#343a72}
.cc.cn{background:#3a1e1e;color:#f0a3a3;border-color:#6b3333}
.title{font-size:14.8px}
.title .en{color:#7b8494;font-size:12.5px;font-weight:400}
.title .en-only{font-weight:600;color:#c7cdd8}
.meta{color:#6d7686;font-size:12px}
.why{color:#98a2b3;font-size:12.6px;margin-top:3px;max-width:62ch}
.tag{font-size:10.5px;padding:1px 7px;border-radius:20px;margin-left:6px;
 white-space:nowrap;vertical-align:1px}
.tag.vol{background:#4a2116;color:#ffb38a;border:1px solid #7c3a22}
.tag.key{background:#3a1a1d;color:#ff9ea1;border:1px solid #6e2f33}

.nums{display:flex;flex-direction:column;gap:1px}
.n{display:flex;justify-content:space-between;gap:8px;font-size:12.5px}
.n i{color:#6d7686;font-style:normal}
.n b{font-variant-numeric:tabular-nums}
.n.act b{color:#f0b429}
.n .dim{color:#4a5567;font-weight:400}

.bias{display:flex;flex-direction:column;gap:3px}
.bline{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.cond{color:#6d7686;font-size:11.5px}
.b{font-size:12px;padding:2px 9px;border-radius:5px;font-weight:600;white-space:nowrap}
.b.up{background:#10291c;color:#5fd68e;border:1px solid #1f4a32}
.b.down{background:#2c1518;color:#ff7a7f;border:1px solid #55262b}
.b.none{background:transparent;color:#3f4756;border:1px dashed #2e3644}

.outcome{display:inline-block;margin-top:5px;font-size:12px;padding:2px 9px;border-radius:5px}
.outcome.up{background:#10291c;color:#5fd68e}
.outcome.down{background:#2c1518;color:#ff7a7f}
.outcome.flat{background:#1c212b;color:#8b94a3}

footer{margin-top:34px;padding-top:16px;border-top:1px solid #1c212b;
 color:#6d7686;font-size:12.3px;line-height:1.7}
footer b{color:#c0a060}

@media(max-width:900px){
  .ev{grid-template-columns:60px 1fr;gap:8px}
  .nums{flex-direction:row;flex-wrap:wrap;gap:14px;grid-column:2}
  .n{flex-direction:row;gap:5px}
  .bias{grid-column:2;align-items:flex-start}
  .bline{justify-content:flex-start}
  .why{max-width:100%}
}
"""

_JS = """
(function(){
  var state={imp:'key',country:{}};
  document.querySelectorAll('[data-filter="country"]').forEach(function(b){
    state.country[b.dataset.value]=true;
  });

  function apply(){
    document.querySelectorAll('.ev').forEach(function(ev){
      var imp=parseInt(ev.dataset.imp,10);
      var okImp = state.imp==='all' ? true : (state.imp==='hi' ? imp===1 : imp>=0);
      var okC = state.country[ev.dataset.c]!==false;
      ev.classList.toggle('hidden', !(okImp&&okC));
    });
    document.querySelectorAll('.day').forEach(function(d){
      var visible=d.querySelectorAll('.ev:not(.hidden)').length;
      d.style.display = visible ? '' : 'none';
    });
  }

  document.querySelectorAll('[data-filter="imp"]').forEach(function(b){
    b.addEventListener('click',function(){
      state.imp=b.dataset.value;
      document.querySelectorAll('[data-filter="imp"]').forEach(function(x){
        x.classList.toggle('on', x===b);
      });
      apply();
    });
  });
  document.querySelectorAll('[data-filter="country"]').forEach(function(b){
    b.addEventListener('click',function(){
      state.country[b.dataset.value]=!state.country[b.dataset.value];
      b.classList.toggle('on', state.country[b.dataset.value]);
      apply();
    });
  });

  var next=document.querySelector('.next[data-ts]');
  var out=document.getElementById('countdown');
  function tick(){
    if(!next||!out) return;
    var left=parseInt(next.dataset.ts,10)-Math.floor(Date.now()/1000);
    if(left<=0){ out.textContent='ประกาศแล้ว — กดรีเฟรชเพื่อดูผลจริง'; return; }
    var d=Math.floor(left/86400), h=Math.floor(left%86400/3600),
        m=Math.floor(left%3600/60), s=left%60, p=[];
    if(d) p.push(d+' วัน');
    if(d||h) p.push(h+' ชม.');
    p.push(m+' นาที'); p.push(s+' วิ');
    out.textContent='อีก '+p.join(' ');
  }
  tick(); setInterval(tick,1000);

  apply();
  var line=document.querySelector('.nowline');
  if(line) line.scrollIntoView({block:'center'});
})();
"""

_TEMPLATE = """<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ปฏิทินข่าวทอง XAUUSD</title>
<style>__CSS__</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>📅 ปฏิทินข่าวเทรด<span class="g">ทอง</span> XAUUSD</h1>
    <div class="sub">เวลาไทย (GMT+7) · อัปเดตล่าสุด __FETCHED__ น. · แหล่งข้อมูล: __SOURCE__ · ทั้งหมด __TOTAL__ รายการ</div>
    __STALE__
    __NEXT__
  </div>
</header>

<div class="wrap">
  __PLAN__

  <div class="bar">
    <span class="lbl">ความแรง</span>
    <button class="chip" data-filter="imp" data-value="hi">เฉพาะข่าวใหญ่</button>
    <button class="chip on" data-filter="imp" data-value="key">ข่าวใหญ่ + ปานกลาง</button>
    <button class="chip" data-filter="imp" data-value="all">ทั้งหมด</button>
    <span class="sep"></span>
    <span class="lbl">ประเทศ</span>
    __COUNTRY_BTNS__
  </div>

  __BODY__

  <footer>
    <b>อ่านยังไง:</b> คอลัมน์ขวาสุดคือความสัมพันธ์พื้นฐานว่า ถ้าตัวเลขออกสูง/ต่ำกว่าที่ตลาดคาด
    ทองมัก "มีแนวโน้ม" ไปทางไหน — หลักคือ เศรษฐกิจสหรัฐฯ ร้อน/เงินเฟ้อสูง → เฟดคงดอกเบี้ยสูงนาน →
    ดอลลาร์แข็ง → กดดันทอง และในทางกลับกัน<br>
    <b>ข้อจำกัดที่ต้องรู้:</b> นี่คือความสัมพันธ์เชิงทฤษฎีระยะสั้นเท่านั้น ไม่ใช่การทำนายราคาและไม่ใช่คำแนะนำการลงทุน
    ราคาจริงยังขึ้นกับว่าตลาด price-in ไปแล้วแค่ไหน ขนาดของ surprise การแก้ตัวเลขย้อนหลัง
    และปัจจัยภูมิรัฐศาสตร์ — ช่วงข่าวแรงสเปรดจะกว้างและเกิด slippage ได้ โปรดบริหารความเสี่ยงเอง<br>
    <b>ที่มา:</b> TradingView Economic Calendar (สำรอง: ForexFactory) — เวลาประกาศอาจถูกเลื่อนโดยหน่วยงานต้นทาง ควรเช็กซ้ำก่อนเข้าเทรด
  </footer>
</div>

<script>__JS__</script>
</body>
</html>
"""
