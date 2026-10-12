import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 내 노트북의 data/store-data.json 을 읽어 준다.
 * 이 파일은 git 과 배포에 포함되지 않으므로, 실제 매출은 노트북에서 앱을 켰을 때만 보인다.
 */
export async function GET() {
  const file = path.join(process.cwd(), "data", "store-data.json");
  if (!fs.existsSync(file)) {
    return NextResponse.json({ available: false, reason: "수집한 실제 자료가 없습니다." }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return NextResponse.json({ available: true, data: json }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ available: false, reason: `자료를 읽지 못했습니다: ${(e as Error).message}` }, { status: 500 });
  }
}
