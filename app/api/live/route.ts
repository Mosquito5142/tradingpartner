import { loadLive } from "@/lib/live";

/** ต้องสดเสมอ — ทั้งหน้าอยู่ได้เพราะตัวเลข actual โผล่มาตรงเวลา */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await loadLive());
  } catch (err) {
    console.error("[api/live]", err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
