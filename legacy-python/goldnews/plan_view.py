"""ส่วน "แผนวันนี้" ของหน้าเว็บ — ราคา, กราฟ 15 นาที, ช่วงเวลาน่าจับตา, แนวรับแนวต้าน"""

from __future__ import annotations

import html

KIND_TH = {
    "swing": "โซนกลับตัว",
    "pivot": "Pivot รายวัน",
    "prev_high": "กรอบเมื่อวาน",
    "prev_low": "กรอบเมื่อวาน",
    "asia": "กรอบเอเชีย",
    "round": "เลขกลม",
}


def _esc(text) -> str:
    return html.escape(str(text or ""))


def _heat_class(score: float) -> str:
    if score >= 10:
        return "h4"
    if score >= 7:
        return "h3"
    if score >= 4.5:
        return "h2"
    if score > 0:
        return "h1"
    return "h0"


def _hour_strip(rows: list[dict]) -> str:
    cells = []
    for row in rows:
        classes = [_heat_class(row["score"])]
        if row["is_now"]:
            classes.append("now")
        if row["is_past"]:
            classes.append("past")

        news = ""
        if row["events"]:
            hot = any(e["volatile"] for e in row["events"])
            news = f'<span class="nd{" hot" if hot else ""}"></span>'

        tip = f"{row['hour']:02d}:00 · {row['session']} · แกว่งเฉลี่ย ${row['vol']:.2f}/แท่ง"
        if row["events"]:
            tip += " · " + ", ".join(f"{e['time']} {e['title']}" for e in row["events"][:4])

        cells.append(
            f'<div class="hcell {" ".join(classes)}" title="{_esc(tip)}">'
            f'<span class="hnum">{row["hour"]:02d}</span>{news}</div>'
        )
    return f'<div class="hstrip">{"".join(cells)}</div>'


def _windows(windows: list[dict]) -> str:
    if not windows:
        return '<p class="dim">วันนี้ไม่มีช่วงเวลาที่เด่นเหลืออยู่แล้ว</p>'

    cards = []
    for w in windows:
        if w["events"]:
            detail = "".join(
                f'<div class="wev"><b>{e["time"]}</b> '
                f'<span class="cc {e["country"].lower()}">{e["country"]}</span> '
                f'{_esc(e["title"])}{" ⚡" if e["volatile"] else ""}</div>'
                for e in w["events"][:4]
            )
        else:
            detail = f'<div class="wev dim">ไม่มีข่าว — แรงจากสภาพคล่องช่วง{_esc(w["session"])}ล้วน ๆ</div>'

        cards.append(
            f'<div class="wcard {_heat_class(w["score"])}">'
            f'<div class="whead">{w["hour"]:02d}:00 – {w["hour"]:02d}:59 น.'
            f'<span class="wscore">{w["score"]}</span></div>'
            f'<div class="wsub">{_esc(w["session"])} · เคยแกว่งเฉลี่ย ${w["vol"]:.2f} ต่อแท่ง 15 นาที</div>'
            f"{detail}</div>"
        )
    return f'<div class="wgrid">{"".join(cards)}</div>'


def _levels_table(levels: list[dict], price: float) -> str:
    if not levels:
        return '<p class="dim">คำนวณแนวรับแนวต้านไม่ได้ (ข้อมูลราคาไม่พอ)</p>'

    rows = []
    placed = False
    for lv in levels:
        if not placed and lv["price"] < price:
            rows.append(
                f'<tr class="pricerow"><td colspan="4">ราคาปัจจุบัน <b>{price:,.2f}</b></td></tr>'
            )
            placed = True

        side = "res" if lv["side"] == "resistance" else "sup"
        side_th = "แนวต้าน" if lv["side"] == "resistance" else "แนวรับ"
        extra = f' <span class="dim">+ {_esc(lv["also"])}</span>' if lv.get("also") else ""
        bars = "▮" * min(5, max(1, round(lv["strength"] / 3)))

        # ป้ายประเภทจะซ้ำกับชื่อระดับในกรณี swing จึงแสดงเฉพาะตอนที่บอกอะไรเพิ่ม
        kind = KIND_TH.get(lv["kind"], "")
        kind_line = f'<div class="dim">{_esc(kind)}</div>' if kind and lv["kind"] != "swing" else ""

        rows.append(
            f'<tr class="{side}">'
            f'<td class="lp"><b>{lv["price"]:,.2f}</b></td>'
            f'<td class="ld">{lv["distance"]:+.2f}</td>'
            f'<td class="lk"><span class="sidetag {side}">{side_th}</span> {_esc(lv["label"])}{extra}'
            f'{kind_line}</td>'
            f'<td class="ls" title="น้ำหนัก {lv["strength"]}">{bars}</td>'
            f"</tr>"
        )

    if not placed:
        rows.append(f'<tr class="pricerow"><td colspan="4">ราคาปัจจุบัน <b>{price:,.2f}</b></td></tr>')

    return (
        '<table class="lvls"><thead><tr><th>ระดับ</th><th>ห่าง</th>'
        '<th>ที่มา</th><th>น้ำหนัก</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table>'
    )


def _risk_widget(cfg: dict, noise15: float | None) -> str:
    """เครื่องคำนวณขนาดล็อต — คำนวณฝั่ง client เพราะต้องโต้ตอบได้

    สูตรตรวจสอบกับบัญชีจริงแล้ว (ขาย 0.40 ล็อต ระยะ 10.862 -> 434.48 USC):
        กำไร/ขาดทุน (หน่วยบัญชี) = ระยะราคา($) x ล็อต x 100
    บัญชี Cent ยอดเงินเป็น USC และ P&L ก็เป็น USC -> คณิต %เสี่ยงเหมือนบัญชีปกติ
    ต่างแค่มูลค่าเงินจริง = USC / 100
    """
    balance = cfg.get("account_balance", 1000)
    acc_type = cfg.get("account_type", "cent")
    risk = cfg.get("risk_percent", 2)
    noise = noise15 or 8.9

    return f"""
<div class="risk">
  <h3>คำนวณขนาดล็อต</h3>
  <p class="dim sub">กรอกยอดเงินกับความเสี่ยงที่รับได้ แล้วดูว่าได้ขนาดล็อตเท่าไร
     — เป็นเครื่องคิดเลข ไม่ใช่คำแนะนำว่าควรเสี่ยงเท่าไร</p>

  <div class="rgrid">
    <label>ประเภทบัญชี
      <select id="rk-type">
        <option value="cent">Cent (USC)</option>
        <option value="std">Standard (USD)</option>
      </select>
    </label>
    <label>ยอดเงินในบัญชี
      <input id="rk-bal" type="number" step="0.01" value="{balance}">
    </label>
    <label>ความเสี่ยงต่อไม้ (%)
      <input id="rk-risk" type="number" step="0.1" value="{risk}">
    </label>
    <label>ระยะ SL (ดอลลาร์ทอง)
      <input id="rk-sl" type="number" step="0.01" value="10">
    </label>
  </div>

  <div class="rout">
    <div class="rbig"><span>ขนาดล็อตที่ได้</span><b id="rk-lot">—</b></div>
    <div class="rline">เงินที่เสี่ยง <b id="rk-money">—</b></div>
  </div>

  <div class="rgrid2">
    <label>หรือคิดย้อนกลับ — ถ้าใช้ล็อตนี้
      <input id="rk-lot-in" type="number" step="0.01" value="0.40">
    </label>
    <div class="rline">= เสี่ยง <b id="rk-back">—</b></div>
  </div>

  <p class="rnote" id="rk-note"></p>
  <p class="dim sub">ช่วงข่าว ทองขยับมัธยฐาน <b>${noise:.2f}</b> ใน 15 นาที (วัดจากข้อมูลจริง)
     ใช้เทียบว่า SL ที่ตั้งไว้กว้างพอเกินโซนแกว่งปกติหรือยัง</p>
</div>"""


RISK_JS = """
(function(){
  var $ = function(id){ return document.getElementById(id); };
  if(!$('rk-lot')) return;
  var ids = ['rk-type','rk-bal','rk-risk','rk-sl','rk-lot-in'];

  try{
    var saved = JSON.parse(localStorage.getItem('goldRisk') || '{}');
    ids.forEach(function(id){ if(saved[id] !== undefined && $(id)) $(id).value = saved[id]; });
  }catch(e){}

  function calc(){
    var isCent = $('rk-type').value === 'cent';
    var unit   = isCent ? 'USC' : 'USD';
    var bal    = parseFloat($('rk-bal').value) || 0;
    var riskPc = parseFloat($('rk-risk').value) || 0;
    var sl     = parseFloat($('rk-sl').value) || 0;
    var lotIn  = parseFloat($('rk-lot-in').value) || 0;

    // P&L (หน่วยบัญชี) = ระยะ($) x ล็อต x 100
    var riskAmt = bal * riskPc / 100;
    var lot = sl > 0 ? riskAmt / (sl * 100) : 0;
    $('rk-lot').textContent = sl > 0 ? lot.toFixed(3) : '—';

    var real = isCent ? ' (= $' + (riskAmt/100).toFixed(2) + ' จริง)' : '';
    $('rk-money').textContent = riskAmt.toFixed(2) + ' ' + unit + real;

    var backAmt = sl * lotIn * 100;
    var backPc  = bal > 0 ? backAmt / bal * 100 : 0;
    var backReal = isCent ? ' (= $' + (backAmt/100).toFixed(2) + ' จริง)' : '';
    $('rk-back').textContent = backAmt.toFixed(2) + ' ' + unit + backReal +
                               ' = ' + backPc.toFixed(1) + '% ของพอร์ต';

    var note = $('rk-note'), msgs = [], cls = '';
    if(sl > 0 && sl < NOISE15){
      msgs.push('SL $' + sl.toFixed(2) + ' แคบกว่าระยะแกว่งปกติช่วงข่าว ($' +
                NOISE15.toFixed(2) + ' ใน 15 นาที) — มีโอกาสโดนชนก่อนราคาไปทางที่คิด');
      cls = 'warn';
    }
    if(backPc >= 10){
      msgs.push('ล็อต ' + lotIn + ' กับ SL $' + sl.toFixed(2) +
                ' คิดเป็น ' + backPc.toFixed(1) + '% ของพอร์ตในไม้เดียว');
      cls = 'warn';
    }
    note.textContent = msgs.join(' · ');
    note.className = 'rnote ' + cls;

    try{
      var out = {};
      ids.forEach(function(id){ out[id] = $(id).value; });
      localStorage.setItem('goldRisk', JSON.stringify(out));
    }catch(e){}
  }

  ids.forEach(function(id){
    var el = $(id);
    if(el){ el.addEventListener('input', calc); el.addEventListener('change', calc); }
  });
  calc();
})();
"""


RISK_CSS = """
.risk{margin-top:18px;border-top:1px solid #232a36;padding-top:14px}
.rgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.rgrid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end;margin-top:10px}
.risk label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:#8b94a3}
.risk input,.risk select{background:#0e1116;border:1px solid #2e3644;color:#e6e8eb;
 border-radius:6px;padding:6px 8px;font-size:13.5px;font-family:inherit;
 font-variant-numeric:tabular-nums;width:100%}
.risk input:focus,.risk select:focus{outline:none;border-color:#3d6fb5}
.rout{display:flex;align-items:baseline;gap:20px;flex-wrap:wrap;margin-top:12px;
 background:#161b23;border:1px solid #262d3a;border-radius:8px;padding:10px 14px}
.rbig{display:flex;align-items:baseline;gap:10px}
.rbig span{color:#8b94a3;font-size:12px}
.rbig b{color:#f0b429;font-size:24px;font-variant-numeric:tabular-nums}
.rline{font-size:13px;color:#b9c0cc}
.rline b{color:#e6e8eb;font-variant-numeric:tabular-nums}
.rnote{font-size:12px;margin-top:8px;line-height:1.6;min-height:1px}
.rnote.warn{color:#ffb38a;background:#2a1a12;border:1px solid #54331f;
 border-radius:6px;padding:6px 10px}
@media(max-width:900px){
  .rgrid{grid-template-columns:1fr 1fr}
  .rgrid2{grid-template-columns:1fr}
}
"""


def render(plan: dict) -> str:
    """สร้าง HTML ส่วน "แผนวันนี้" ทั้งก้อน"""
    if not plan:
        return ""

    warn = ""
    if plan.get("stale"):
        warn = ('<div class="banner">⚠️ ดึงราคาล่าสุดไม่สำเร็จ — กราฟและแนวรับแนวต้าน'
                'คำนวณจากราคาที่บันทึกไว้ครั้งก่อน</div>')
    elif plan.get("errors"):
        warn = ('<div class="banner soft">บางแหล่งราคาดึงไม่ได้: '
                + _esc("; ".join(plan["errors"])) + "</div>")

    offset = plan.get("broker_offset", 0.0)
    offset_note = (
        f' · ปรับให้ตรงกราฟโบรกเกอร์แล้ว ({offset:+.2f})' if offset else
        ' · ยังไม่ได้ตั้ง broker_offset ใน config.json'
    )

    return f"""
<section class="plan">
  <h2 class="planhead">แผนวันนี้
    <span class="planprice">{plan['price']:,.2f}</span>
    <span class="dim">spot {plan.get('spot') or '—'}{offset_note}</span>
  </h2>
  {warn}

  <div class="chartbox">{plan['chart_svg']}</div>
  <p class="chartnote">แท่งเทียน 15 นาที 24 ชั่วโมงล่าสุด · เส้นประแดง = แนวต้าน · เขียว = แนวรับ ·
     เส้นฟ้าแนวตั้ง = เวลาข่าว · ราคาอ้างอิง PAXG ปรับฐานด้วย spot จริง อาจต่างจากโบรกเกอร์ ±1–2 เหรียญ</p>

  <div class="plangrid">
    <div>
      <h3>วันนี้น่าเล่นกี่โมง</h3>
      <p class="dim sub">ความเข้มของช่องคือ "ชั่วโมงนั้นทองเคยแกว่งแรงแค่ไหนใน 60 วันที่ผ่านมา"
         รวมกับน้ำหนักข่าวของวันนี้ · จุดฟ้า = มีข่าว</p>
      {_hour_strip(plan['hours'])}
      {_windows(plan['top_windows'])}
    </div>
    <div>
      <h3>แนวรับ / แนวต้าน จากกราฟ 15 นาที</h3>
      <p class="dim sub">รวมจุดกลับตัวย้อนหลัง 10 วัน, Pivot รายวัน, กรอบเมื่อวาน/เอเชีย และเลขกลม</p>
      {_levels_table(plan['levels'], plan['price'])}
    </div>
  </div>

  {_risk_widget(plan.get('config', {}), plan.get('noise15'))}
</section>
"""


CSS = RISK_CSS + """
.plan{background:#12161d;border:1px solid #232a36;border-radius:12px;padding:16px 18px;margin:18px 0 24px}
.planhead{font-size:17px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.planprice{font-size:26px;font-weight:700;color:#f0b429;font-variant-numeric:tabular-nums}
.planhead .dim{font-size:12px;font-weight:400}
.plan h3{font-size:14.5px;color:#c7cdd8;margin:16px 0 2px}
.plan .sub{font-size:12px;margin-bottom:10px;max-width:60ch}
.banner.soft{background:#1c2230;border-color:#2e3644;color:#9aa3b2}
.chartnote{color:#6d7686;font-size:11.5px;margin-top:6px;line-height:1.6}
.plangrid{display:grid;grid-template-columns:1fr 1fr;gap:24px}

.hstrip{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-bottom:14px}
.hcell{position:relative;height:44px;border-radius:3px;display:flex;align-items:flex-end;
 justify-content:center;padding-bottom:3px;background:#1a1f29}
.hcell .hnum{font-size:9.5px;color:#8b94a3;font-variant-numeric:tabular-nums}
.hcell.h1{background:#1d2a2a}.hcell.h2{background:#1f3b39}
.hcell.h3{background:#2a5145}.hcell.h4{background:#3d7a56}
.hcell.h3 .hnum,.hcell.h4 .hnum{color:#dff3e6}
.hcell.past{opacity:.42}
.hcell.now{outline:2px solid #f0b429;outline-offset:-1px}
.hcell .nd{position:absolute;top:5px;width:5px;height:5px;border-radius:50%;background:#8fb6ef}
.hcell .nd.hot{background:#f0b429;box-shadow:0 0 5px #f0b429}

.wgrid{display:flex;flex-direction:column;gap:8px}
.wcard{background:#161b23;border:1px solid #262d3a;border-left:3px solid #3a4354;border-radius:8px;padding:9px 12px}
.wcard.h4{border-left-color:#3d7a56}.wcard.h3{border-left-color:#2a5145}
.whead{font-size:14px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.wscore{font-size:11px;color:#f0b429;font-weight:700}
.wsub{color:#6d7686;font-size:11.5px;margin-bottom:4px}
.wev{font-size:12.5px;color:#b9c0cc;padding:1px 0}
.wev b{font-variant-numeric:tabular-nums;color:#e6e8eb}

.lvls{width:100%;border-collapse:collapse;font-size:12.8px}
.lvls th{text-align:left;color:#6d7686;font-weight:500;font-size:11.5px;
 border-bottom:1px solid #262d3a;padding:4px 6px}
.lvls td{padding:5px 6px;border-bottom:1px solid #1a1f29;vertical-align:top}
.lvls .lp b{font-variant-numeric:tabular-nums;font-size:13.5px}
.lvls .ld{font-variant-numeric:tabular-nums;color:#8b94a3;white-space:nowrap}
.lvls tr.res .lp b{color:#ff8b8f}
.lvls tr.sup .lp b{color:#6fdca2}
.lvls .ls{color:#f0b429;letter-spacing:-1px;white-space:nowrap}
.lvls .lk .dim{font-size:11px}
.sidetag{font-size:10px;padding:1px 6px;border-radius:4px;margin-right:4px}
.sidetag.res{background:#2c1518;color:#ff7a7f}
.sidetag.sup{background:#10291c;color:#5fd68e}
.lvls .pricerow td{background:#1d2330;color:#f0b429;font-size:12.5px;text-align:center;
 border-top:1px solid #3a3020;border-bottom:1px solid #3a3020}
.lvls .pricerow b{font-variant-numeric:tabular-nums;font-size:14px}

@media(max-width:900px){
  .plangrid{grid-template-columns:1fr;gap:8px}
  .hcell{height:36px}
}
"""
