import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const notoThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ปฏิทินข่าวเทรดทอง XAUUSD",
  description:
    "ปฏิทินข่าวเศรษฐกิจเวลาไทย พร้อมกราฟ 15 นาที แนวรับแนวต้าน และสถิติปฏิกิริยาข่าวที่วัดจากราคาจริง",
};

export const viewport: Viewport = {
  themeColor: "#0e1116",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${notoThai.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <header className="border-b border-line bg-gradient-to-b from-[#1a1f29] to-[#12151b]">
          <div className="mx-auto w-full max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              📅 ปฏิทินข่าวเทรด<span className="text-gold">ทอง</span> XAUUSD
            </Link>
            <nav className="flex gap-1 text-[13px]">
              <Link href="/" className="rounded-md px-3 py-1.5 text-muted hover:bg-raise hover:text-text">
                หน้าหลัก
              </Link>
              <Link href="/lab" className="rounded-md px-3 py-1.5 text-muted hover:bg-raise hover:text-text">
                Reaction Lab
              </Link>
              <Link href="/journal" className="rounded-md px-3 py-1.5 text-muted hover:bg-raise hover:text-text">
                สมุดเทรด
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">{children}</main>

        <footer className="border-t border-line mt-8">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 text-[12.3px] leading-relaxed text-faint">
            <p className="mb-1.5">
              <b className="text-[#c0a060]">ข้อจำกัดที่ต้องรู้:</b> เครื่องมือนี้รวบรวมกำหนดการข่าว
              และวัดสถิติจากราคาย้อนหลัง <b>ไม่ใช่การทำนายราคาและไม่ใช่คำแนะนำการลงทุน</b>{" "}
              ราคาจริงยังขึ้นกับว่าตลาด price-in ไปแล้วแค่ไหน ขนาดของ surprise การแก้ตัวเลขย้อนหลัง
              และปัจจัยภูมิรัฐศาสตร์ — ช่วงข่าวแรงสเปรดจะกว้างและเกิด slippage ได้ โปรดบริหารความเสี่ยงเอง
            </p>
            <p>
              <b className="text-[#c0a060]">ที่มา:</b> TradingView Economic Calendar (สำรอง: ForexFactory) ·
              ราคา: gold-api, Binance PAXG, Yahoo GC=F — เวลาประกาศอาจถูกเลื่อนโดยหน่วยงานต้นทาง
              ควรเช็กซ้ำก่อนเข้าเทรด
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
