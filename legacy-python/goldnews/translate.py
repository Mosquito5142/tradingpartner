"""แปลชื่อข่าวเป็นภาษาไทย + กรองข่าวที่ไม่เกี่ยวกับทอง

แยกออกจาก bias.py เพราะคนละหน้าที่:
    translate.py = "ข่าวนี้ชื่อไทยว่าอะไร"
    bias.py      = "ข่าวนี้ส่งผลต่อทองยังไง"
"""

from __future__ import annotations

import re

# ข่าวที่ไม่เกี่ยวกับทิศทางทองเลย — ซ่อนไว้เว้นแต่สั่ง --all
_NOISE = re.compile(
    r"API Crude Oil|EIA .*Stock|MBA \d+-Year|MBA Mortgage|Redbook"
    r"|Jobless Claims 4-week|ADP Employment Change Weekly"
    r"|New Car Registrations|TIC Flows|Bill Auction|Bond Auction|Note Auction"
    r"|Business Inventories|Wholesale Inventories|Retail Inventories"
    r"|Monthly Budget Statement|Current Account|FDI \(YTD\)"
    r"|General Council Meeting|Baker Hughes",
    re.IGNORECASE,
)

# คำต่อท้ายที่บอก "รูปแบบการวัด" — ต้องแสดง ไม่งั้นข่าวชื่อซ้ำกันหมด
_SUFFIXES: list[tuple[str, str]] = [
    (r"\bMoM\b|\bm/m\b", "เทียบเดือนก่อน"),
    (r"\bYoY\b|\by/y\b", "เทียบปีก่อน"),
    (r"\bQoQ\b|\bq/q\b", "เทียบไตรมาสก่อน"),
    (r"\bFlash\b|\bPrel\b|\bAdv\b|\bPreliminary\b", "ตัวเลขเบื้องต้น"),
    (r"\bFinal\b|\bRevised\b", "ตัวเลขสุดท้าย"),
    (r"\bs\.a\b", "ปรับฤดูกาล"),
    (r"Ex Transp", "ไม่รวมขนส่ง"),
    (r"ex Defense", "ไม่รวมกลาโหม"),
    (r"Ex Gas/Autos", "ไม่รวมน้ำมันและรถยนต์"),
    (r"Ex Autos", "ไม่รวมรถยนต์"),
    (r"Ex Food, Energy and Trade", "ไม่รวมอาหาร พลังงาน การค้า"),
    (r"Control Group", "กลุ่มควบคุม"),
]

# (ประเทศ|None, regex, ชื่อไทย) — เรียงจากเฉพาะเจาะจงไปกว้าง เจอตัวแรกที่ตรงถือว่าชนะ
_TITLES: list[tuple[str | None, str, str]] = [
    # ---------- สหรัฐฯ: เฟด ----------
    ("US", r"^Fed Interest Rate Decision|^Federal Funds Rate|^FOMC Statement", "มติดอกเบี้ยเฟด (FOMC)"),
    ("US", r"^FOMC Economic Projections", "ประมาณการเศรษฐกิจเฟด (Dot Plot)"),
    ("US", r"^FOMC Minutes", "รายงานการประชุมเฟด (Minutes)"),
    ("US", r"^Fed Press Conference|^FOMC Press Conference", "แถลงข่าวประธานเฟด"),
    ("US", r"^Fed Chair Powell|^Powell", "ประธานเฟด พาวเวลล์ แถลง"),
    ("US", r"^FOMC Member", "กรรมการเฟดแถลง"),

    # ---------- สหรัฐฯ: เงินเฟ้อ ----------
    ("US", r"^Core PCE Price", "ดัชนีราคา PCE พื้นฐาน (เฟดดูตัวนี้ที่สุด)"),
    ("US", r"^Core PCE Prices", "ดัชนีราคา PCE พื้นฐาน"),
    ("US", r"^PCE Price|^PCE Prices", "ดัชนีราคา PCE"),
    ("US", r"^Core Inflation Rate|^Core CPI", "อัตราเงินเฟ้อพื้นฐาน (Core CPI)"),
    ("US", r"^Inflation Rate|^CPI [my]/[my]", "อัตราเงินเฟ้อ (CPI)"),
    ("US", r"^CPI\b", "ดัชนีราคาผู้บริโภค (ระดับดัชนี)"),
    ("US", r"^Core PPI", "ดัชนีราคาผู้ผลิตพื้นฐาน (Core PPI)"),
    ("US", r"^PPI\b", "ดัชนีราคาผู้ผลิต (PPI)"),
    ("US", r"^Import Prices", "ราคาสินค้านำเข้า"),
    ("US", r"^Export Prices", "ราคาสินค้าส่งออก"),

    # ---------- สหรัฐฯ: แรงงาน ----------
    ("US", r"^Non ?Farm Payrolls$|^Non.?Farm Employment Change", "การจ้างงานนอกภาคเกษตร (NFP)"),
    ("US", r"^Nonfarm Payrolls Private", "การจ้างงานนอกภาคเกษตร ภาคเอกชน"),
    ("US", r"^U-6 Unemployment Rate", "อัตราการว่างงานแบบกว้าง (U-6)"),
    ("US", r"^Unemployment Rate", "อัตราการว่างงาน"),
    ("US", r"^Participation Rate", "อัตราการเข้าร่วมกำลังแรงงาน"),
    ("US", r"^Average Hourly Earnings", "ค่าจ้างเฉลี่ยต่อชั่วโมง"),
    ("US", r"^Initial Jobless Claims|^Unemployment Claims", "ยอดขอรับสวัสดิการว่างงานครั้งแรก"),
    ("US", r"^Continuing Jobless Claims", "ยอดขอรับสวัสดิการว่างงานต่อเนื่อง"),
    ("US", r"^JOLTs Job Openings", "ตำแหน่งงานว่าง (JOLTS)"),
    ("US", r"^JOLTs Job Quits", "อัตราการลาออกจากงาน (JOLTS)"),
    ("US", r"^ADP", "การจ้างงานภาคเอกชน (ADP)"),
    ("US", r"^Challenger Job Cuts", "ยอดประกาศปลดพนักงาน (Challenger)"),

    # ---------- สหรัฐฯ: เศรษฐกิจ ----------
    ("US", r"^GDP Growth Rate|^(Advance|Prelim|Final) GDP", "อัตราการเติบโตเศรษฐกิจ (GDP)"),
    ("US", r"^GDP Price Index", "ดัชนีราคา GDP"),
    ("US", r"^GDP Sales", "ยอดขายสุดท้ายตาม GDP"),
    ("US", r"^Core Retail Sales", "ยอดค้าปลีก ไม่รวมรถยนต์"),
    ("US", r"^Retail Sales", "ยอดค้าปลีก"),
    ("US", r"^ISM Manufacturing PMI", "ดัชนี ISM ภาคการผลิต"),
    ("US", r"^ISM Manufacturing Employment", "ISM ภาคการผลิต: การจ้างงาน"),
    ("US", r"^ISM Manufacturing New Orders", "ISM ภาคการผลิต: คำสั่งซื้อใหม่"),
    ("US", r"^ISM Manufacturing Prices", "ISM ภาคการผลิต: ราคาที่จ่าย"),
    ("US", r"^ISM Services PMI", "ดัชนี ISM ภาคบริการ"),
    ("US", r"^ISM Services Business Activity", "ISM ภาคบริการ: กิจกรรมธุรกิจ"),
    ("US", r"^ISM Services Employment", "ISM ภาคบริการ: การจ้างงาน"),
    ("US", r"^ISM Services New Orders", "ISM ภาคบริการ: คำสั่งซื้อใหม่"),
    ("US", r"^ISM Services Prices", "ISM ภาคบริการ: ราคาที่จ่าย"),
    ("US", r"^Durable Goods Orders", "ยอดสั่งซื้อสินค้าคงทน"),
    ("US", r"^Factory Orders", "คำสั่งซื้อภาคโรงงาน"),
    ("US", r"^Industrial Production", "การผลิตภาคอุตสาหกรรม"),
    ("US", r"^Capacity Utilization", "อัตราการใช้กำลังการผลิต"),
    ("US", r"^Michigan Consumer Sentiment|UoM Consumer Sentiment", "ความเชื่อมั่นผู้บริโภค (ม.มิชิแกน)"),
    ("US", r"^Michigan Inflation Expectations", "คาดการณ์เงินเฟ้อ (ม.มิชิแกน)"),
    ("US", r"^CB Consumer Confidence|^Consumer Confidence", "ความเชื่อมั่นผู้บริโภค (Conference Board)"),
    ("US", r"^Personal Income", "รายได้ส่วนบุคคล"),
    ("US", r"^Personal Spending", "การใช้จ่ายส่วนบุคคล"),
    ("US", r"^Building Permits", "ใบอนุญาตก่อสร้าง"),
    ("US", r"^Housing Starts", "การเริ่มสร้างบ้านใหม่"),
    ("US", r"^New Home Sales", "ยอดขายบ้านใหม่"),
    ("US", r"^Existing Home Sales", "ยอดขายบ้านมือสอง"),
    ("US", r"^Pending Home Sales", "ยอดทำสัญญาซื้อบ้าน"),
    ("US", r"^NAHB Housing Market Index", "ดัชนีตลาดที่อยู่อาศัย (NAHB)"),
    ("US", r"^S&P/Case-Shiller", "ดัชนีราคาบ้าน Case-Shiller"),
    ("US", r"^NY Empire State|^Empire State", "ดัชนีภาคการผลิตรัฐนิวยอร์ก"),
    ("US", r"^Philadelphia Fed|^Philly Fed", "ดัชนีภาคการผลิตเฟดฟิลาเดลเฟีย"),
    ("US", r"^Dallas Fed", "ดัชนีภาคการผลิตเฟดดัลลัส"),
    ("US", r"^Richmond Fed", "ดัชนีภาคการผลิตเฟดริชมอนด์"),
    ("US", r"^Kansas Fed", "ดัชนีภาคการผลิตเฟดแคนซัส"),
    ("US", r"^Chicago PMI", "ดัชนี PMI ชิคาโก"),
    ("US", r"^Chicago Fed National Activity", "ดัชนีกิจกรรมเศรษฐกิจ (เฟดชิคาโก)"),
    ("US", r"^Goods Trade Balance", "ดุลการค้าสินค้า"),
    ("US", r"^Balance of Trade", "ดุลการค้า"),
    ("US", r"^Exports$", "มูลค่าส่งออก"),
    ("US", r"^Imports$", "มูลค่านำเข้า"),

    # ---------- ยุโรป ----------
    ("EU", r"^ECB President Lagarde Speech", "ประธาน ECB (ลาการ์ด) แถลง"),
    ("EU", r"^ECB Monetary Policy Meeting Accounts", "รายงานการประชุมนโยบายการเงิน ECB"),
    ("EU", r"^ECB Interest Rate Decision|^Interest Rate Decision|^Main Refinancing Rate|^Monetary Policy Statement", "มติดอกเบี้ย ECB"),
    ("EU", r"^ECB Press Conference", "แถลงข่าว ECB"),
    ("EU", r"^Core Inflation Rate", "เงินเฟ้อพื้นฐานยูโรโซน"),
    ("EU", r"^Inflation Rate", "อัตราเงินเฟ้อยูโรโซน"),
    ("EU", r"^CPI\b", "ดัชนีราคาผู้บริโภคยูโรโซน"),
    ("EU", r"^ZEW Economic Sentiment", "ดัชนีความเชื่อมั่นเศรษฐกิจ (ZEW)"),
    ("EU", r"^Economic Sentiment", "ดัชนีความเชื่อมั่นทางเศรษฐกิจ"),
    ("EU", r"^Consumer Confidence", "ความเชื่อมั่นผู้บริโภคยูโรโซน"),
    ("EU", r"^Unemployment Rate", "อัตราการว่างงานยูโรโซน"),
    ("EU", r"^Retail Sales", "ยอดค้าปลีกยูโรโซน"),
    ("EU", r"^Industrial Production", "การผลิตภาคอุตสาหกรรมยูโรโซน"),
    ("EU", r"^Balance of Trade", "ดุลการค้ายูโรโซน"),
    ("EU", r"^GDP Growth Rate", "อัตราการเติบโตเศรษฐกิจยูโรโซน"),
    ("EU", r"^S&P Global Manufacturing PMI", "PMI ภาคการผลิตยูโรโซน (S&P Global)"),
    ("EU", r"^S&P Global Services PMI", "PMI ภาคบริการยูโรโซน (S&P Global)"),
    ("EU", r"^S&P Global Composite PMI", "PMI รวมยูโรโซน (S&P Global)"),

    # ---------- จีน ----------
    ("CN", r"^NBS Manufacturing PMI", "PMI ภาคการผลิตจีน (ทางการ NBS)"),
    ("CN", r"^NBS Non ?Manufacturing PMI", "PMI นอกภาคการผลิตจีน (ทางการ NBS)"),
    ("CN", r"^RatingDog Manufacturing PMI|^Caixin Manufacturing", "PMI ภาคการผลิตจีน (ภาคเอกชน)"),
    ("CN", r"^RatingDog Services PMI|^Caixin Services", "PMI ภาคบริการจีน (ภาคเอกชน)"),
    ("CN", r"^Loan Prime Rate 1Y", "ดอกเบี้ยเงินกู้อ้างอิง LPR 1 ปี"),
    ("CN", r"^Loan Prime Rate 5Y", "ดอกเบี้ยเงินกู้อ้างอิง LPR 5 ปี"),
    ("CN", r"^New Yuan Loans", "ยอดปล่อยกู้ใหม่สกุลหยวน"),
    ("CN", r"^Retail Sales", "ยอดค้าปลีกจีน"),
    ("CN", r"^Industrial Production", "การผลิตภาคอุตสาหกรรมจีน"),
    ("CN", r"^Fixed Asset Investment", "การลงทุนในสินทรัพย์ถาวร"),
    ("CN", r"^House Price Index", "ดัชนีราคาบ้านจีน"),
    ("CN", r"^Inflation Rate", "อัตราเงินเฟ้อจีน"),
    ("CN", r"^PPI\b", "ดัชนีราคาผู้ผลิตจีน"),
    ("CN", r"^Balance of Trade", "ดุลการค้าจีน"),
    ("CN", r"^Exports", "มูลค่าส่งออกจีน"),
    ("CN", r"^Imports", "มูลค่านำเข้าจีน"),
    ("CN", r"^GDP Growth Rate", "อัตราการเติบโตเศรษฐกิจจีน (GDP)"),
    ("CN", r"^Unemployment Rate", "อัตราการว่างงานจีน"),

    # ---------- ทั่วไป ----------
    (None, r"Holiday", "วันหยุดตลาด"),
]

_COMPILED = [(country, re.compile(pattern, re.IGNORECASE), thai) for country, pattern, thai in _TITLES]
_COMPILED_SUFFIX = [(re.compile(pattern, re.IGNORECASE), thai) for pattern, thai in _SUFFIXES]

# ชื่อกรรมการธนาคารกลางเป็นชื่อเฉพาะ จับด้วย pattern แยก
_SPEECH_US = re.compile(r"^Fed (.+?) Speech$", re.IGNORECASE)
_SPEECH_EU = re.compile(r"^ECB (.+?) Speech$", re.IGNORECASE)


def is_noise(event: dict) -> bool:
    """ข่าวที่ไม่ช่วยตัดสินใจเรื่องทอง (สต็อกน้ำมัน ประมูลตั๋วเงิน ดอกเบี้ยจำนอง ฯลฯ)"""
    return bool(_NOISE.search(event.get("title", "")))


def thai_title(event: dict) -> str:
    """คืนชื่อไทยของข่าว หรือ '' ถ้ายังไม่มีคำแปล"""
    title = event.get("title", "")
    country = event.get("country", "")

    base = ""
    for rule_country, pattern, thai in _COMPILED:
        if rule_country is not None and rule_country != country:
            continue
        if pattern.search(title):
            base = thai
            break

    # ชื่อกรรมการธนาคารกลางเป็นชื่อเฉพาะ จับหลังจากตารางแปลไม่เจอแล้วเท่านั้น
    if not base and country == "US":
        match = _SPEECH_US.match(title)
        if match:
            base = f"กรรมการเฟด {match.group(1)} แถลง"
    if not base and country == "EU":
        match = _SPEECH_EU.match(title)
        if match:
            base = f"กรรมการ ECB {match.group(1)} แถลง"

    if not base:
        return ""

    notes = [thai for pattern, thai in _COMPILED_SUFFIX if pattern.search(title)]
    return f"{base} · {' · '.join(notes)}" if notes else base
