import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 원가·비용 설정을 내 컴퓨터 파일에 저장한다 (브라우저를 바꾸거나 지워도 남게).
 * data/settings.json — 사업자 아이디별로 보관하며, 이 파일도 git·배포에 포함되지 않는다.
 */
const file = () => path.join(process.cwd(), "data", "settings.json");

function readAll(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET() {
  return NextResponse.json({ settings: readAll() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: string; settings?: unknown } | null;
  if (!body?.id || typeof body.settings !== "object" || body.settings === null) {
    return NextResponse.json({ error: "저장할 내용이 없어요." }, { status: 400 });
  }
  const all = readAll();
  all[body.id] = body.settings;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(all, null, 1), "utf8");
  } catch (e) {
    return NextResponse.json({ error: `저장하지 못했어요: ${(e as Error).message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
