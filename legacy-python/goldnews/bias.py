"""กฎ "ทิศทางทอง" — ความสัมพันธ์มหภาคแบบพื้นฐานระหว่างข่าวเศรษฐกิจกับราคาทอง

หลักคิดหลัก (ทองไม่มีดอกเบี้ย จึงอ่อนไหวกับดอกเบี้ยแท้จริงและค่าเงินดอลลาร์):
    เศรษฐกิจสหรัฐฯ แข็ง / เงินเฟ้อสูง  -> เฟดคงดอกเบี้ยสูงนาน -> ดอลลาร์+บอนด์ยิลด์ขึ้น -> ทองมักลง
    เศรษฐกิจสหรัฐฯ อ่อน / เงินเฟ้อต่ำ  -> ตลาดคาดเฟดลดดอกเบี้ย -> ดอลลาร์อ่อน          -> ทองมักขึ้น

*** นี่คือความสัมพันธ์ทางทฤษฎีระยะสั้น ไม่ใช่การทำนายราคา ***
ของจริงยังขึ้นกับ positioning ของตลาด ขนาดของ surprise และปัจจัยภูมิรัฐศาสตร์ด้วย
"""

from __future__ import annotations

import re

# ทิศทาง: "down" = ทองมักลง, "up" = ทองมักขึ้น (เมื่อตัวเลขออก "สูงกว่า" คาดการณ์)
_HAWKISH = "down"   # ตัวเลขดี/ร้อนแรง -> ลบต่อทอง
_DOVISH = "up"      # ตัวเลขแย่/อ่อนแอ -> บวกต่อทอง

_WHY_HOT = "ตัวเลขแข็งแกร่งเกินคาด → เฟดไม่รีบลดดอกเบี้ย → ดอลลาร์และบอนด์ยิลด์ขึ้น → กดดันทอง"
_WHY_INFL = "เงินเฟ้อสูงเกินคาด → ตลาดคาดเฟดคงดอกเบี้ยสูงนานขึ้น → ดอลลาร์แข็ง → ทองมักย่อลงทันที"
_WHY_WEAKGOOD = "ตัวเลขยิ่งสูง = เศรษฐกิจยิ่งแย่ → ตลาดคาดเฟดลดดอกเบี้ยเร็วขึ้น → ดอลลาร์อ่อน → หนุนทอง"
_WHY_TONE_FED = ("ไม่ต้องดูตัวเลข ให้ฟังโทนคำพูด: สาย “ผ่อนคลาย/จ่อลดดอกเบี้ย” (Dovish) → ทองขึ้น, "
                 "สาย “คุมเงินเฟ้อ/ยังไม่ลด” (Hawkish) → ทองลง")
_WHY_EU = "ยุโรปแข็งแรง → ยูโรแข็ง → ดัชนีดอลลาร์ (DXY) อ่อนลง → หนุนทองทางอ้อมเล็กน้อย"
_WHY_CN = "จีนคือผู้บริโภคทองรายใหญ่สุดของโลก เศรษฐกิจจีนดี → ดีมานด์ทองจริงและการซื้อของธนาคารกลางเพิ่ม → บวกต่อทองอ่อน ๆ"

# แต่ละกฎ: (ประเทศ, regex, ชื่อไทย, ชนิด, ทิศทางเมื่อออกสูงกว่าคาด, ความแรง, คำอธิบาย, ผันผวนแรง, ข่าวสำคัญ)
# เรียงจาก "เฉพาะเจาะจงที่สุด" ไป "กว้างที่สุด" — เจอตัวแรกที่ match ถือว่าชนะ
_RULES: list[tuple] = [
    # --------- นโยบายการเงินเฟด (ดูโทน ไม่ใช่ตัวเลข) ---------
    ("US", r"Fed Interest Rate Decision|FOMC Statement|Fed Rate Decision|Federal Funds Rate",
     "มติดอกเบี้ยเฟด (FOMC)", "tone", "", "strong", _WHY_TONE_FED, True, True),
    ("US", r"FOMC Economic Projections|Dot Plot",
     "คาดการณ์เศรษฐกิจ/Dot Plot ของเฟด", "tone", "", "strong", _WHY_TONE_FED, True, True),
    ("US", r"Fed Press Conference|FOMC Press Conference",
     "แถลงข่าวประธานเฟด", "tone", "", "strong", _WHY_TONE_FED, True, True),
    ("US", r"FOMC Minutes|Fed Minutes",
     "รายงานการประชุมเฟด (Minutes)", "tone", "", "strong", _WHY_TONE_FED, True, True),
    ("US", r"Powell|Fed Chair",
     "ประธานเฟด (พาวเวลล์) แถลง", "tone", "", "strong", _WHY_TONE_FED, True, True),
    ("US", r"Fed .*(Speech|Testimony|Speaks)|FOMC Member",
     "กรรมการเฟดแถลง", "tone", "", "mild", _WHY_TONE_FED, False, False),

    # --------- เงินเฟ้อสหรัฐฯ ---------
    ("US", r"Core PCE",
     "ดัชนีราคา PCE พื้นฐาน (มาตรวัดเงินเฟ้อที่เฟดใช้จริง)", "number", _HAWKISH, "strong", _WHY_INFL, True, True),
    ("US", r"PCE Price",
     "ดัชนีราคา PCE", "number", _HAWKISH, "strong", _WHY_INFL, False, True),
    ("US", r"Core Inflation Rate|Core CPI|Core Consumer Price",
     "เงินเฟ้อพื้นฐาน (Core CPI)", "number", _HAWKISH, "strong", _WHY_INFL, True, True),
    ("US", r"Inflation Rate|CPI|Consumer Price Index",
     "อัตราเงินเฟ้อ (CPI)", "number", _HAWKISH, "strong", _WHY_INFL, True, True),
    ("US", r"Core PPI|Core Producer Price",
     "ดัชนีราคาผู้ผลิตพื้นฐาน (Core PPI)", "number", _HAWKISH, "strong", _WHY_INFL, False, True),
    ("US", r"PPI|Producer Price",
     "ดัชนีราคาผู้ผลิต (PPI) — เงินเฟ้อต้นทาง", "number", _HAWKISH, "strong", _WHY_INFL, False, True),
    ("US", r"Inflation Expectations",
     "คาดการณ์เงินเฟ้อ", "number", _HAWKISH, "mild", _WHY_INFL, False, False),
    ("US", r"Import Prices|Export Prices",
     "ราคาสินค้านำเข้า/ส่งออก", "number", _HAWKISH, "mild", _WHY_INFL, False, False),

    # --------- ตลาดแรงงานสหรัฐฯ (ตัวเลขกลับด้าน — ยิ่งสูงยิ่งแย่) ---------
    ("US", r"Jobless Claims|Unemployment Claims",
     "ยอดผู้ขอรับสวัสดิการว่างงาน", "number", _DOVISH, "strong", _WHY_WEAKGOOD, False, True),
    ("US", r"Unemployment Rate",
     "อัตราการว่างงาน", "number", _DOVISH, "strong", _WHY_WEAKGOOD, True, True),
    ("US", r"Challenger Job Cuts",
     "ยอดประกาศปลดพนักงาน (Challenger)", "number", _DOVISH, "mild", _WHY_WEAKGOOD, False, False),

    # --------- ตลาดแรงงานสหรัฐฯ (ยิ่งสูงยิ่งดี -> กดทอง) ---------
    ("US", r"ADP",
     "การจ้างงานภาคเอกชน ADP", "number", _HAWKISH, "strong", _WHY_HOT, False, True),
    ("US", r"Non.?Farm Payroll|Non.?Farm Employment Change",
     "การจ้างงานนอกภาคเกษตร (NFP)", "number", _HAWKISH, "strong", _WHY_HOT, True, True),
    ("US", r"Average Hourly Earnings",
     "ค่าจ้างเฉลี่ยต่อชั่วโมง", "number", _HAWKISH, "strong",
     "ค่าจ้างขึ้นแรง = เงินเฟ้อฝั่งบริการยังร้อน → เฟดเข้มงวดต่อ → กดดันทอง", False, True),
    ("US", r"JOLTs|Job Openings",
     "ตำแหน่งงานว่าง (JOLTS)", "number", _HAWKISH, "strong", _WHY_HOT, False, True),
    ("US", r"Employment Change|Payrolls",
     "การเปลี่ยนแปลงการจ้างงาน", "number", _HAWKISH, "mild", _WHY_HOT, False, False),

    # --------- กิจกรรมเศรษฐกิจสหรัฐฯ ---------
    ("US", r"ISM Manufacturing",
     "ดัชนี ISM ภาคการผลิต", "number", _HAWKISH, "strong", _WHY_HOT, False, True),
    ("US", r"ISM Services|ISM Non.?Manufacturing",
     "ดัชนี ISM ภาคบริการ", "number", _HAWKISH, "strong", _WHY_HOT, False, True),
    ("US", r"GDP",
     "อัตราการเติบโตเศรษฐกิจ (GDP)", "number", _HAWKISH, "strong", _WHY_HOT, False, True),
    ("US", r"Retail Sales",
     "ยอดค้าปลีก", "number", _HAWKISH, "strong", _WHY_HOT, False, True),
    ("US", r"Durable Goods",
     "ยอดสั่งซื้อสินค้าคงทน", "number", _HAWKISH, "mild", _WHY_HOT, False, True),
    ("US", r"Michigan Consumer Sentiment|UoM Consumer Sentiment|Consumer Sentiment",
     "ความเชื่อมั่นผู้บริโภค (ม.มิชิแกน)", "number", _HAWKISH, "mild", _WHY_HOT, False, True),
    ("US", r"Consumer Confidence",
     "ดัชนีความเชื่อมั่นผู้บริโภค", "number", _HAWKISH, "mild", _WHY_HOT, False, False),
    ("US", r"Manufacturing PMI",
     "ดัชนี PMI ภาคการผลิต", "number", _HAWKISH, "mild", _WHY_HOT, False, False),
    ("US", r"Services PMI|Composite PMI",
     "ดัชนี PMI ภาคบริการ/รวม", "number", _HAWKISH, "mild", _WHY_HOT, False, False),
    ("US", r"Industrial Production|Factory Orders|Capacity Utilization",
     "การผลิตภาคอุตสาหกรรม", "number", _HAWKISH, "mild", _WHY_HOT, False, False),
    ("US", r"Personal Spending|Personal Income",
     "รายได้/การใช้จ่ายส่วนบุคคล", "number", _HAWKISH, "mild", _WHY_HOT, False, False),
    ("US", r"Housing Starts|Building Permits|New Home Sales|Existing Home Sales|Pending Home Sales",
     "ข้อมูลภาคอสังหาฯ", "number", _HAWKISH, "mild", _WHY_HOT, False, False),
    ("US", r"Empire State|Philadelphia Fed|Philly Fed|Chicago PMI|Richmond|Dallas Fed|Kansas Fed|NY Fed",
     "ดัชนีภาคการผลิตระดับภูมิภาค", "number", _HAWKISH, "mild", _WHY_HOT, False, False),
    ("US", r"Balance of Trade|Trade Balance",
     "ดุลการค้า", "number", _HAWKISH, "mild",
     "ขาดดุลน้อยลง/เกินดุลมากขึ้น → ดอลลาร์แข็ง → กดดันทองเล็กน้อย", False, False),

    # --------- ยุโรป (ผลทางอ้อมผ่านค่าเงิน) ---------
    ("EU", r"Interest Rate Decision|ECB Press|ECB Rate|Main Refinancing Rate|Monetary Policy Statement",
     "มติดอกเบี้ย ECB", "tone", "", "mild",
     "ECB เข้มงวด → ยูโรแข็ง → ดัชนีดอลลาร์อ่อน → หนุนทองทางอ้อม (ถ้า ECB ผ่อนคลาย ผลกลับกัน)", False, True),
    ("EU", r"Inflation Rate|CPI|Consumer Price",
     "เงินเฟ้อยูโรโซน", "number", _DOVISH, "mild", _WHY_EU, False, True),
    ("EU", r"GDP|PMI|Retail Sales|ZEW|Ifo|Sentix|Industrial Production|Unemployment Rate",
     "ข้อมูลเศรษฐกิจยูโรโซน", "number", _DOVISH, "mild", _WHY_EU, False, False),
    ("EU", r"Speech|Lagarde",
     "กรรมการ ECB แถลง", "tone", "", "mild",
     "ฟังโทน: ECB เข้มงวด → ยูโรแข็ง → ดอลลาร์อ่อน → บวกต่อทองเล็กน้อย", False, False),

    # --------- จีน (ผลผ่านดีมานด์ทองคำจริง) ---------
    ("CN", r"Loan Prime Rate|PBoC|Interest Rate",
     "ดอกเบี้ยนโยบายจีน (LPR/PBoC)", "tone", "", "mild",
     "จีนลดดอกเบี้ย/อัดฉีดกระตุ้นเศรษฐกิจ → ดีมานด์ทองในประเทศเพิ่ม → บวกต่อทอง", False, True),
    ("CN", r"GDP|Retail Sales|Industrial Production|Exports|Imports|Balance of Trade|PMI",
     "ข้อมูลเศรษฐกิจจีน", "number", _DOVISH, "mild", _WHY_CN, False, False),
    ("CN", r"Inflation Rate|CPI|PPI",
     "เงินเฟ้อจีน", "number", _DOVISH, "mild", _WHY_CN, False, False),

    # --------- ข่าวทั่วไปที่ไม่ระบุประเทศ ---------
    (None, r"Holiday",
     "วันหยุดตลาด", "", "", "mild",
     "ตลาดหยุด สภาพคล่องบาง — สเปรดกว้างและราคาเหวี่ยงง่ายผิดปกติ ควรเลี่ยงเทรด", False, False),
]

_COMPILED = [
    (country, re.compile(pattern, re.IGNORECASE)) + tuple(rest)
    for country, pattern, *rest in _RULES
]

_MONTH_TH = {
    "Jan": "ม.ค.", "Feb": "ก.พ.", "Mar": "มี.ค.", "Apr": "เม.ย.", "May": "พ.ค.", "Jun": "มิ.ย.",
    "Jul": "ก.ค.", "Aug": "ส.ค.", "Sep": "ก.ย.", "Oct": "ต.ค.", "Nov": "พ.ย.", "Dec": "ธ.ค.",
}


def thai_period(period: str) -> str:
    """'Aug' -> 'ข้อมูลเดือน ส.ค.' , 'Q2' -> 'ข้อมูลไตรมาส 2'"""
    period = (period or "").strip()
    if not period:
        return ""
    if period in _MONTH_TH:
        return f"ข้อมูลเดือน {_MONTH_TH[period]}"
    if re.fullmatch(r"Q[1-4]", period):
        return f"ข้อมูลไตรมาส {period[1]}"
    return f"ข้อมูล {period}"


def _match(event: dict):
    text = f"{event.get('title', '')} {event.get('indicator', '')}"
    country = event.get("country", "")
    for index, (rule_country, pattern, *rest) in enumerate(_COMPILED):
        if rule_country is not None and rule_country != country:
            continue
        if pattern.search(text):
            return index, rest
    return None


def _surprise(event: dict) -> str:
    """เทียบผลจริงกับคาดการณ์ -> 'higher' | 'lower' | 'inline' | ''"""
    actual, forecast = event.get("actual_raw"), event.get("forecast_raw")
    if not isinstance(actual, (int, float)) or not isinstance(forecast, (int, float)):
        return ""
    if isinstance(actual, bool) or isinstance(forecast, bool):
        return ""
    tolerance = abs(forecast) * 0.0005
    if abs(actual - forecast) <= tolerance:
        return "inline"
    return "higher" if actual > forecast else "lower"


# rank = ลำดับของกฎที่ตรง (ยิ่งน้อยยิ่งสำคัญต่อทอง) ใช้จัดลำดับข่าวที่ประกาศเวลาเดียวกัน
_UNRANKED = 999

_EMPTY = {
    "th": "", "kind": "", "dir_if_higher": "", "strength": "",
    "why": "", "volatile": False, "key": False, "surprise": "", "outcome": "",
    "rank": _UNRANKED,
}


def annotate(event: dict) -> dict:
    """เติมข้อมูล 'ทิศทางทอง' ให้กับ event หนึ่งรายการ"""
    matched = _match(event)
    if matched is None:
        return dict(_EMPTY)

    rank, (th, kind, dir_if_higher, strength, why, volatile, key) = matched
    surprise = _surprise(event)

    outcome = ""
    if kind == "number" and surprise:
        if surprise == "inline":
            outcome = "neutral"
        elif surprise == "higher":
            outcome = dir_if_higher
        else:
            outcome = "up" if dir_if_higher == "down" else "down"

    return {
        "th": th,
        "kind": kind,
        "dir_if_higher": dir_if_higher,
        "strength": strength,
        "why": why,
        "volatile": volatile,
        "key": key,
        "surprise": surprise,
        "outcome": outcome,
        "rank": rank,
    }


def is_key_event(event: dict) -> bool:
    """ข่าวสำคัญที่ต้องแสดงเสมอ แม้ระบบจะจัดความแรงไว้ระดับกลาง"""
    return annotate(event).get("key", False)
