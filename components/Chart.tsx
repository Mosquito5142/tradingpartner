/**
 * กราฟแท่งเทียน 15 นาที เป็น SVG ล้วน
 * เรนเดอร์ฝั่งเซิร์ฟเวอร์ ไม่ต้องโหลดไลบรารีกราฟ — เบาและเร็ว
 */

import { thTime } from "@/lib/time";
import type { Bar, Level } from "@/lib/types";

const W = 1120;
const H = 430;
const PAD_L = 10;
const PAD_R = 96; // เว้นที่ให้ป้ายราคา
const PAD_T = 12;
const PAD_B = 28;

export interface NewsMark {
  ts: number;
  label: string;
  past: boolean;
}

export default function Chart({
  bars: allBars,
  levels,
  news = [],
  price,
  count = 96,
}: {
  bars: Bar[];
  levels: Level[];
  news?: NewsMark[];
  price: number;
  count?: number;
}) {
  const bars = allBars.slice(-count);
  if (bars.length < 5) {
    return <p className="text-[13px] text-faint">ข้อมูลราคาไม่พอวาดกราฟ</p>;
  }

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const lows = bars.map((b) => b.l);
  const highs = bars.map((b) => b.h);
  const minLow = Math.min(...lows);
  const maxHigh = Math.max(...highs);
  // เผื่อขอบให้เห็นแนวรับแนวต้านที่อยู่นอกกรอบราคานิดหน่อย
  const near = levels.filter((l) => l.price >= minLow - 12 && l.price <= maxHigh + 12).map((l) => l.price);
  const lo = Math.min(minLow, ...near) - 2;
  const hi = Math.max(maxHigh, ...near) + 2;
  const span = Math.max(hi - lo, 1e-6);

  const yOf = (p: number) => PAD_T + ((hi - p) / span) * plotH;
  const xOf = (i: number) => PAD_L + ((i + 0.5) / bars.length) * plotW;
  const bodyW = Math.max(1.6, (plotW / bars.length) * 0.62);

  const gridStep = span <= 90 ? 10 : span <= 180 ? 20 : 50;
  const gridLines: number[] = [];
  for (let v = Math.floor(lo / gridStep) * gridStep; v <= hi; v += gridStep) {
    if (v >= lo) gridLines.push(v);
  }

  const hourMarks: { x: number; label: string }[] = [];
  let lastHour = -1;
  bars.forEach((bar, i) => {
    const time = thTime(bar.ts);
    const hour = Number(time.slice(0, 2));
    if (hour !== lastHour && hour % 3 === 0) {
      lastHour = hour;
      hourMarks.push({ x: xOf(i), label: time });
    }
  });

  // เส้นวาดทุกเส้น แต่ป้ายราคาข้ามตัวที่ชิดกันเกินไป ไม่งั้นตัวเลขทับกันอ่านไม่ออก
  const labelYs: number[] = [];
  const visibleLevels = levels
    .filter((l) => l.price > lo && l.price < hi)
    .sort((a, b) => b.price - a.price)
    .map((level) => {
      const y = yOf(level.price);
      const showLabel = labelYs.every((prev) => Math.abs(y - prev) >= 11);
      if (showLabel) labelYs.push(y);
      return { level, y, showLabel };
    });

  const firstTs = bars[0].ts;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-[#11151c] p-2.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="กราฟแท่งเทียน 15 นาที"
        className="block h-auto w-full min-w-[680px]"
      >
        {gridLines.map((v) => (
          <g key={`g${v}`}>
            <line x1={PAD_L} y1={yOf(v)} x2={PAD_L + plotW} y2={yOf(v)} stroke="#1d2430" />
            <text x={PAD_L + plotW + 6} y={yOf(v) + 3.5} fill="#6d7686" fontSize="10.5">
              {v.toLocaleString()}
            </text>
          </g>
        ))}

        {hourMarks.map((m, i) => (
          <g key={`h${i}`}>
            <line x1={m.x} y1={PAD_T} x2={m.x} y2={PAD_T + plotH} stroke="#181e28" />
            <text x={m.x} y={H - 9} fill="#6d7686" fontSize="10.5" textAnchor="middle">
              {m.label}
            </text>
          </g>
        ))}

        {visibleLevels.map(({ level, y, showLabel }, i) => {
          const color = level.side === "resistance" ? "#e5484d" : "#3fb87a";
          const text = level.side === "resistance" ? "#ff8b8f" : "#6fdca2";
          return (
            <g key={`l${i}`}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y}
                stroke={color} strokeDasharray="5 4" opacity={0.75}
              />
              {showLabel && (
                <text x={PAD_L + plotW + 6} y={y - 4} fill={text} fontSize="10">
                  {level.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </text>
              )}
            </g>
          );
        })}

        {bars.map((bar, i) => {
          const x = xOf(i);
          const up = bar.c >= bar.o;
          const color = up ? "#3fb87a" : "#e5484d";
          const yTop = yOf(Math.max(bar.o, bar.c));
          const yBottom = yOf(Math.min(bar.o, bar.c));
          return (
            <g key={`b${bar.ts}`}>
              <line x1={x} y1={yOf(bar.h)} x2={x} y2={yOf(bar.l)} stroke={color} />
              <rect
                x={x - bodyW / 2} y={yTop}
                width={bodyW} height={Math.max(1, yBottom - yTop)}
                fill={color}
              />
            </g>
          );
        })}

        {price > lo && price < hi && (
          <g>
            <line
              x1={PAD_L} y1={yOf(price)} x2={PAD_L + plotW} y2={yOf(price)}
              stroke="#f0b429" strokeDasharray="2 2"
            />
            <rect x={PAD_L + plotW + 2} y={yOf(price) - 8} width={62} height={16} rx={3} fill="#f0b429" />
            <text x={PAD_L + plotW + 6} y={yOf(price) + 4} fill="#161b23" fontSize="10.5" fontWeight="700">
              {price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </text>
          </g>
        )}

        {news.map((mark, i) => {
          const x = xOf((mark.ts - firstTs) / 900);
          if (x < PAD_L || x > PAD_L + plotW) return null;
          const color = mark.past ? "#3a4354" : "#8fb6ef";
          return (
            <g key={`n${i}`}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + plotH} stroke={color} strokeDasharray="3 3" />
              <text x={x + 3} y={PAD_T + 12} fill={color} fontSize="9.5">
                {mark.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
