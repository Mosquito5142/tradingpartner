/**
 * เวลาไทย (GMT+7)
 *
 * เซิร์ฟเวอร์ Vercel รันด้วย UTC เสมอ จึงคำนวณเวลาไทยเองด้วยการบวก offset คงที่
 * แล้วอ่านค่าด้วย getUTC* — ได้ผลเหมือนกันทุกเครื่องไม่ว่า timezone ของเครื่องจะเป็นอะไร
 * ไทยเป็น UTC+7 ตลอดปี ไม่มี DST จึงไม่ต้องพึ่งฐานข้อมูล timezone
 */

export const TH_OFFSET_SEC = 7 * 3600;
const TH_OFFSET_MS = TH_OFFSET_SEC * 1000;

export const THAI_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export interface ThaiParts {
  year: number;
  month: number; // 0-11
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = อาทิตย์
  dateKey: string; // "2026-09-19" ตามวันแบบไทย
}

/** แตกเวลา epoch (วินาที) ออกเป็นส่วนประกอบตามเวลาไทย */
export function thParts(tsSec: number): ThaiParts {
  const d = new Date(tsSec * 1000 + TH_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  return {
    year,
    month,
    day,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    dateKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** "19:30" */
export function thTime(tsSec: number): string {
  const p = thParts(tsSec);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "เสาร์ 19 กันยายน 2569" — พ.ศ. */
export function thFullDate(tsSec: number): string {
  const p = thParts(tsSec);
  return `${THAI_DAYS[p.weekday]} ${p.day} ${THAI_MONTHS[p.month]} ${p.year + 543}`;
}

/** "19/09/26" */
export function thShortDate(tsSec: number): string {
  const p = thParts(tsSec);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${String(p.year).slice(2)}`;
}

/** "19/09/2026 19:30" */
export function thDateTime(tsSec: number): string {
  const p = thParts(tsSec);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${p.year} ${thTime(tsSec)}`;
}

/** "วันนี้" / "พรุ่งนี้" / "อีก 3 วัน" */
export function relativeDay(tsSec: number, nowSec: number): string {
  const a = Date.parse(thParts(tsSec).dateKey + "T00:00:00Z");
  const b = Date.parse(thParts(nowSec).dateKey + "T00:00:00Z");
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return "วันนี้";
  if (diff === 1) return "พรุ่งนี้";
  if (diff === -1) return "เมื่อวาน";
  if (diff < 0) return `${-diff} วันที่แล้ว`;
  return `อีก ${diff} วัน`;
}

/** 'Aug' -> 'ข้อมูลเดือน ส.ค.' , 'Q2' -> 'ข้อมูลไตรมาส 2' */
export function thaiPeriod(period: string | undefined): string {
  const value = (period || "").trim();
  if (!value) return "";
  const monthIndex = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ].indexOf(value);
  if (monthIndex >= 0) return `ข้อมูลเดือน ${THAI_MONTHS_SHORT[monthIndex]}`;
  if (/^Q[1-4]$/.test(value)) return `ข้อมูลไตรมาส ${value[1]}`;
  return `ข้อมูล ${value}`;
}

/** ตลาดทองเปิดอยู่ไหม ณ เวลานั้น (ปิดเสาร์ ~04:00 น. ไทย เปิดจันทร์ ~05:00 น. ไทย) */
export function isMarketOpen(tsSec: number): boolean {
  const { weekday, hour } = thParts(tsSec);
  if (weekday === 6) return hour < 4; // เสาร์
  if (weekday === 0) return false; // อาทิตย์
  if (weekday === 1) return hour >= 5; // จันทร์
  return true;
}

export const nowSec = () => Math.floor(Date.now() / 1000);
