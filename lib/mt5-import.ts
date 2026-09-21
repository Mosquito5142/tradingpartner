/**
 * อ่านไฟล์ statement จาก MetaTrader 4/5
 *
 * MT ส่งออกได้หลายแบบและแต่ละโบรกเกอร์ก็ไม่เหมือนกันเป๊ะ ๆ ตัว parser นี้จึงออกแบบให้
 * "ทนแล้วรายงานตรง ๆ" มากกว่าจะพยายามเดาให้ได้ทุกกรณี:
 *   - หาคอลัมน์จากหัวตาราง ไม่ยึดตำแหน่งตายตัว (ภาษาไทยและอังกฤษ)
 *   - แถวไหนอ่านไม่ออกก็ข้าม แล้วนับไว้รายงานให้ผู้ใช้เห็น
 *
 * รองรับ: HTML report (MT4 "Statement" / MT5 "Report"), CSV/TSV ที่มีหัวตาราง
 */

export interface ParsedTrade {
  ticket: string;
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  openTs: number;
  closeTs: number | null;
  openPrice: number;
  closePrice: number | null;
  sl: number | null;
  tp: number | null;
  profit: number;
  commission: number;
  swap: number;
  comment: string;
}

export interface ParseResult {
  trades: ParsedTrade[];
  /**
   * สกุลเงินของบัญชี ดึงจากหัวรายงาน — ว่างถ้าหาไม่เจอ
   * สำคัญเพราะบัญชี cent (USC) ต่างจาก USD อยู่ 100 เท่า ถ้าเดาผิดตัวเลขบาทจะเพี้ยนหนัก
   */
  currency: string;
  /** แถวที่อ่านไม่ออก — บอกผู้ใช้ตรง ๆ ดีกว่าเงียบ */
  skipped: number;
  /** หัวตารางที่เจอ ใช้ debug เวลารูปแบบไฟล์ไม่ตรง */
  headers: string[];
  format: "html" | "csv" | "unknown";
  warnings: string[];
}

/** ชื่อคอลัมน์ที่เป็นไปได้ของแต่ละฟิลด์ (ตัวพิมพ์เล็กหมด) */
const COLUMN_ALIASES: Record<string, string[]> = {
  ticket: ["ticket", "deal", "order", "position", "หมายเลข", "ตั๋ว"],
  openTime: ["open time", "time", "เวลาเปิด", "เวลา"],
  closeTime: ["close time", "เวลาปิด"],
  type: ["type", "ประเภท", "ชนิด"],
  lots: ["size", "volume", "lots", "ปริมาณ", "ขนาด"],
  symbol: ["symbol", "item", "สัญลักษณ์", "คู่เงิน"],
  openPrice: ["price", "open price", "ราคาเปิด", "ราคา"],
  closePrice: ["close price", "ราคาปิด"],
  sl: ["s / l", "s/l", "sl", "stop loss"],
  tp: ["t / p", "t/p", "tp", "take profit"],
  commission: ["commission", "ค่าคอมมิชชั่น", "ค่าคอม"],
  swap: ["swap", "สวอป"],
  profit: ["profit", "กำไร", "กำไร/ขาดทุน"],
  comment: ["comment", "หมายเหตุ"],
};

/**
 * หาสกุลเงินของบัญชีจากหัวรายงาน
 *
 * MT5 เขียนเป็น "183875989 (USC, Exness-MT5Real25, real, Hedge)"
 * MT4 มักเขียนแยกเป็น "Currency: USD"
 * หาไม่เจอก็คืนค่าว่าง แล้วให้ปลายทางตัดสินใจเอง ดีกว่าเดามั่ว
 */
export function detectCurrency(text: string): string {
  const flat = text.replace(/&nbsp;/gi, " ").replace(/<[^>]+>/g, " ");
  const account = /\b\d{4,}\s*\(\s*([A-Z]{3})\s*,/.exec(flat);
  if (account) return account[1].toUpperCase();
  const labelled = /(?:currency|สกุลเงิน)\s*[:：]?\s*([A-Z]{3})\b/i.exec(flat);
  if (labelled) return labelled[1].toUpperCase();
  return "";
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1 234.56" / "1,234.56" / "-88.60" -> number | null */
function toNumber(raw: string): number | null {
  const cleaned = (raw || "").replace(/\s/g, "").replace(/,/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * MT ใช้รูปแบบ "2026.09.19 14:30:00" (เวลาเซิร์ฟเวอร์โบรกเกอร์)
 * ตีความเป็นเวลาไทยเพราะโบรกเกอร์ที่คนไทยใช้ส่วนใหญ่ตั้งเซิร์ฟเวอร์ที่ GMT+2/+3
 * แต่ผู้ใช้เห็นเวลาในแอปเป็นเวลาไทย — ปรับได้ด้วย serverOffsetHours
 */
function parseMtTime(raw: string, serverOffsetHours: number): number | null {
  const m = /(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw || "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  return Math.floor((asUtc - serverOffsetHours * 3600_000) / 1000);
}

function matchColumn(header: string): string | null {
  const h = header.toLowerCase().trim();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => h === a)) return field;
  }
  // ตรงแบบหลวม ๆ เป็นทางเลือกสุดท้าย — เสี่ยงจับผิด จึงทำหลังตรงเป๊ะทั้งหมด
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => h.includes(a))) return field;
  }
  return null;
}

function rowsFromHtml(text: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(text)) !== null) {
    const cells: string[] = [];
    const tdRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1])) !== null) {
      // MT5 แทรกช่องซ่อน <td class="hidden" colspan="8"> ไว้กลางแถวข้อมูล
      // แต่ไม่มีในแถวหัวตาราง ถ้าไม่ตัดทิ้ง index ของทุกคอลัมน์หลังจากนั้นจะเลื่อนไป 1 ช่อง
      if (/class\s*=\s*["'][^"']*\bhidden\b/i.test(td[1])) continue;
      cells.push(stripTags(td[2]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** แถวนี้หน้าตาเหมือนหัวตารางอีกอันไหม — ใช้หยุดอ่านก่อนข้ามไปตารางถัดไปของไฟล์ */
function looksLikeHeader(cells: string[]): boolean {
  if (cells.length < 4) return false;
  const matched = cells.filter((c) => c && matchColumn(c)).length;
  return matched >= 4;
}

function rowsFromDelimited(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  // เดา delimiter จากบรรทัดแรก
  const counts = { "\t": 0, ";": 0, ",": 0 };
  for (const d of Object.keys(counts) as (keyof typeof counts)[]) {
    counts[d] = lines[0].split(d).length;
  }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",") as string;
  return lines.map((l) => l.split(delim).map((c) => c.replace(/^"|"$/g, "").trim()));
}

/**
 * แถวไหนคือหัวตาราง — แถวที่จับคู่ชื่อคอลัมน์ได้มากที่สุด
 *
 * จุดสำคัญ: MT4/MT5 **ใช้หัวคอลัมน์ซ้ำ** — มี "Price" สองอัน (เปิด/ปิด) และ MT5 มี "Time" สองอัน
 * จึงต้องเก็บ index ทั้งหมดของแต่ละฟิลด์ไว้ แล้วค่อยตีความว่าอันที่สองคือของฝั่งปิด
 * (ทดสอบแล้วว่าถ้าเก็บแค่ index แรก จะอ่านราคาปิด/เวลาปิดไม่ได้เลยทั้งสองรูปแบบ)
 */
function findHeaderRow(rows: string[][]): { index: number; map: Record<string, number> } | null {
  // ใช้ for ธรรมดาแทน forEach — TypeScript ตามการกำหนดค่าตัวแปรข้างนอกจากใน callback ไม่ได้
  // แล้วจะ narrow เป็น never ทำให้อ่าน best.index ไม่ผ่าน
  let best: { index: number; map: Record<string, number>; score: number } | null = null;

  for (let index = 0; index < rows.length; index++) {
    const cells = rows[index];
    const all: Record<string, number[]> = {};
    cells.forEach((c, i) => {
      const field = matchColumn(c);
      if (field) (all[field] ??= []).push(i);
    });

    const map: Record<string, number> = {};
    for (const [field, idxs] of Object.entries(all)) map[field] = idxs[0];

    // หัวคอลัมน์ซ้ำ: ตัวที่สองของ time/price คือฝั่งปิด (ถ้ายังไม่มีคอลัมน์ปิดที่ระบุชัด)
    if (map.closeTime === undefined && (all.openTime?.length ?? 0) > 1) {
      map.closeTime = all.openTime[1];
    }
    if (map.closePrice === undefined && (all.openPrice?.length ?? 0) > 1) {
      map.closePrice = all.openPrice[1];
    }

    // ต้องมีอย่างน้อย เวลา/ประเภท/กำไร ถึงจะเชื่อว่าเป็นหัวตารางจริง
    const usable = map.openTime !== undefined && map.profit !== undefined && map.type !== undefined;
    const score = Object.keys(map).length;
    if (usable && (!best || score > best.score)) best = { index, map, score };
  }

  return best ? { index: best.index, map: best.map } : null;
}

export function parseStatement(text: string, serverOffsetHours = 7): ParseResult {
  const warnings: string[] = [];
  const currency = detectCurrency(text);
  const isHtml = /<\s*table/i.test(text) || /<\s*tr[\s>]/i.test(text);
  const rows = isHtml ? rowsFromHtml(text) : rowsFromDelimited(text);
  const format: ParseResult["format"] = isHtml ? "html" : rows.length ? "csv" : "unknown";

  if (!rows.length) {
    return { trades: [], currency, skipped: 0, headers: [], format: "unknown",
      warnings: ["อ่านไฟล์ไม่ออก — ไม่เจอตารางหรือบรรทัดข้อมูลเลย"] };
  }

  const header = findHeaderRow(rows);
  if (!header) {
    return { trades: [], currency, skipped: rows.length, headers: rows[0] ?? [], format,
      warnings: ["ไม่เจอหัวตารางที่มีคอลัมน์ เวลา/ประเภท/กำไร ครบ — ไฟล์อาจเป็นรูปแบบที่ยังไม่รองรับ"] };
  }

  const { index: headerIdx, map } = header;
  const headers = rows[headerIdx];
  const get = (cells: string[], field: string): string =>
    map[field] === undefined ? "" : (cells[map[field]] ?? "");

  const trades: ParsedTrade[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length < 4) continue;
    // รายงาน MT5 มีหลายตารางในไฟล์เดียว (Positions / Orders / Deals) ถ้าปล่อยให้อ่านต่อ
    // จะเอา index คอลัมน์ของตารางแรกไปใช้กับตารางถัดไป — หยุดตรงหัวตารางอันใหม่
    if (looksLikeHeader(cells)) break;

    const rawType = get(cells, "type").toLowerCase();
    // เอาเฉพาะไม้ซื้อขายจริง — ข้ามฝาก/ถอน/ดอกเบี้ย/บรรทัดสรุป
    const side: "buy" | "sell" | null =
      /\bbuy\b|ซื้อ/.test(rawType) ? "buy" : /\bsell\b|ขาย/.test(rawType) ? "sell" : null;
    if (!side) continue;

    const openTs = parseMtTime(get(cells, "openTime"), serverOffsetHours);
    const profit = toNumber(get(cells, "profit"));
    const lots = toNumber(get(cells, "lots"));
    const openPrice = toNumber(get(cells, "openPrice"));

    if (openTs === null || profit === null || lots === null || openPrice === null) {
      skipped++;
      continue;
    }

    const ticketRaw = get(cells, "ticket").trim();
    let ticket = ticketRaw || `${openTs}:${get(cells, "symbol")}:${lots}`;
    // กัน ticket ซ้ำในไฟล์เดียว — ต่อท้ายด้วยเวลาเปิด ไม่ใช่เลขแถว
    // เพราะเลขแถวจะเปลี่ยนเมื่อ export รอบหน้ามีไม้เพิ่ม ทำให้ไม้เดิมถูกบันทึกซ้ำ
    if (seen.has(ticket)) ticket = `${ticket}@${openTs}`;
    seen.add(ticket);

    trades.push({
      ticket,
      symbol: get(cells, "symbol") || "XAUUSD",
      side,
      lots,
      openTs,
      closeTs: parseMtTime(get(cells, "closeTime"), serverOffsetHours),
      openPrice,
      closePrice: toNumber(get(cells, "closePrice")),
      sl: toNumber(get(cells, "sl")),
      tp: toNumber(get(cells, "tp")),
      profit,
      commission: toNumber(get(cells, "commission")) ?? 0,
      swap: toNumber(get(cells, "swap")) ?? 0,
      comment: get(cells, "comment"),
    });
  }

  if (!trades.length) {
    warnings.push("เจอหัวตารางแล้วแต่ไม่มีแถวที่เป็นไม้ซื้อ/ขายเลย");
  }
  if (skipped) {
    warnings.push(`ข้าม ${skipped} แถวที่อ่านตัวเลข/เวลาไม่ออก`);
  }
  if (map.closeTime === undefined) {
    warnings.push("ไม่เจอคอลัมน์เวลาปิด — จะคำนวณระยะเวลาถือไม่ได้");
  }
  if (map.sl === undefined) {
    warnings.push("ไม่เจอคอลัมน์ SL — จะคำนวณ %เสี่ยงและ R ไม่ได้");
  }
  if (!currency && trades.length) {
    warnings.push("ไม่เจอสกุลเงินของบัญชีในไฟล์ — จะแปลงเป็นเงินบาทให้ไม่ได้");
  }

  return { trades, currency, skipped, headers, format, warnings };
}
