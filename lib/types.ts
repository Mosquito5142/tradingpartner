/** ชนิดข้อมูลกลางที่ใช้ร่วมกันทั้งแอป */

/** ข่าวเศรษฐกิจหนึ่งรายการ (normalize แล้วจากทุกแหล่ง) */
export interface CalendarEvent {
  id: string;
  title: string;
  indicator: string;
  country: string;
  /** 1 = แรง, 0 = ปานกลาง, -1 = เบา */
  importance: number;
  category: string;
  period: string;
  source: string;
  actual: string;
  forecast: string;
  previous: string;
  actualRaw: number | null;
  forecastRaw: number | null;
  previousRaw: number | null;
  /** epoch วินาที (UTC) */
  ts: number;
}

export interface CalendarResult {
  events: CalendarEvent[];
  source: string;
  fetchedAt: number;
  stale: boolean;
  errors: string[];
}

/** แท่งเทียน */
export interface Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type Direction = "up" | "down" | "";
export type Surprise = "higher" | "lower" | "inline" | "";
export type BiasKind = "number" | "tone" | "";

/** ผลวิเคราะห์ทิศทางทองของข่าวหนึ่งรายการ */
export interface Bias {
  th: string;
  kind: BiasKind;
  dirIfHigher: Direction;
  strength: "strong" | "mild" | "";
  why: string;
  volatile: boolean;
  key: boolean;
  surprise: Surprise;
  outcome: Direction | "neutral" | "";
  /** ลำดับกฎที่ match — ยิ่งน้อยยิ่งสำคัญต่อทอง ใช้เรียงข่าวที่ออกพร้อมกัน */
  rank: number;
}

export interface AnnotatedEvent {
  event: CalendarEvent;
  bias: Bias;
  /** ชื่อไทยที่พร้อมแสดง */
  title: string;
}

export type LevelKind = "swing" | "pivot" | "prev_high" | "prev_low" | "asia" | "round";

export interface Level {
  price: number;
  kind: LevelKind;
  label: string;
  touches: number;
  strength: number;
  side: "support" | "resistance";
  distance: number;
  also?: string;
}

export interface HourRow {
  hour: number;
  vol: number;
  volPct: number;
  session: string;
  events: { time: string; country: string; importance: number; volatile: boolean; title: string }[];
  newsWeight: number;
  score: number;
  isNow: boolean;
  isPast: boolean;
}

/** สถิติปฏิกิริยาข่าวที่วัดได้จริง */
export interface ReactionRecord {
  id: string;
  ts: number;
  key: string;
  title: string;
  country: string;
  importance: number;
  surprise: Surprise;
  pred: Direction | "neutral" | "";
  m5: number | null;
  m10: number | null;
  m15: number | null;
  m30: number | null;
  m60: number | null;
  rng60: number | null;
  /** ตัวเลขดิบ ณ ตอนเก็บ — เก็บไว้เพื่อคำนวณขนาด surprise ย้อนหลังได้โดยไม่ต้องพึ่งปฏิทิน */
  actualRaw: number | null;
  forecastRaw: number | null;
  /** พลาดเป้ากี่ % ของค่าคาดการณ์ (ค่าสัมบูรณ์) — null เมื่อคาดการณ์ใกล้ศูนย์จนหารไม่ได้ */
  surprisePct: number | null;
}

export interface DecayPoint {
  minutes: number;
  n: number;
  accuracy: number;
  medianMove: number | null;
}

export interface ReactionStats {
  key: string;
  n: number;
  enough: boolean;
  curve: DecayPoint[];
  medianRange60: number | null;
  recent: { date: string; surprise: Surprise; m15: number | null; m60: number | null }[];
}
