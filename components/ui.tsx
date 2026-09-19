/** ชิ้นส่วน UI เล็ก ๆ ที่ใช้ซ้ำหลายที่ */

import { COUNTRY_TH } from "@/lib/translate";

/** ป้ายรหัสประเทศ (ใช้ตัวอักษรแทนธง เพราะ Windows ไม่มีฟอนต์ emoji ธงชาติ) */
export function Flag({ country }: { country: string }) {
  const code = (country || "??").toUpperCase();
  return (
    <span className={`cc cc-${code.toLowerCase()}`} title={COUNTRY_TH[code] || code}>
      {code}
    </span>
  );
}

export function Tag({ kind, children }: { kind: "vol" | "key"; children: React.ReactNode }) {
  const style =
    kind === "vol"
      ? "bg-[#4a2116] text-[#ffb38a] border-[#7c3a22]"
      : "bg-[#3a1a1d] text-[#ff9ea1] border-[#6e2f33]";
  return (
    <span className={`ml-1.5 whitespace-nowrap rounded-full border px-2 py-px align-[1px] text-[10.5px] ${style}`}>
      {children}
    </span>
  );
}

/** จุดสีบอกความแรงของข่าว */
export function ImpactDot({ importance }: { importance: number }) {
  const [label, style] =
    importance === 1
      ? ["แรง", "bg-downx shadow-[0_0_7px_#e5484d88]"]
      : importance === 0
        ? ["ปานกลาง", "bg-gold"]
        : ["เบา", "bg-[#4a5567]"];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${style}`} title={`ความแรง: ${label}`} />;
}

/** ป้ายทิศทางทอง ▲/▼ */
export function DirBadge({ dir, children }: { dir: "up" | "down" | "none"; children: React.ReactNode }) {
  const style =
    dir === "up"
      ? "bg-[#10291c] text-up border-[#1f4a32]"
      : dir === "down"
        ? "bg-[#2c1518] text-down border-[#55262b]"
        : "border-dashed border-line2 text-[#3f4756]";
  return (
    <span className={`whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[12px] font-semibold ${style}`}>
      {children}
    </span>
  );
}

export function Panel({
  title,
  sub,
  children,
  className = "",
}: {
  title?: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 sm:p-5 ${className}`}>
      {title && <h2 className="text-[15.5px] font-semibold text-[#c7cdd8]">{title}</h2>}
      {sub && <p className="mt-0.5 mb-3 max-w-[62ch] text-[12px] text-faint">{sub}</p>}
      {children}
    </section>
  );
}

export function Banner({ tone = "warn", children }: { tone?: "warn" | "soft"; children: React.ReactNode }) {
  const style =
    tone === "warn"
      ? "bg-[#4a2116] border-[#7c3a22] text-[#ffc9b4]"
      : "bg-[#1c2230] border-line2 text-muted";
  return <div className={`rounded-lg border px-3.5 py-2.5 text-[13.5px] ${style}`}>{children}</div>;
}
