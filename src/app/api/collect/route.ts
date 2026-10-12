import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * '자료 가져오기' 버튼이 부르는 곳. 내 컴퓨터에서 수집 스크립트를 실행하고 진행 상황을 돌려준다.
 * 한 번에 하나만 실행한다 (중복 실행·중복 집계 방지).
 */
type Job = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  lines: string[];
  child: ChildProcess | null;
  range: { start: string; end: string };
};

const g = globalThis as unknown as { __collectJob?: Job };

function push(job: Job, text: string) {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t) job.lines.push(t);
  }
  if (job.lines.length > 400) job.lines.splice(0, job.lines.length - 400);
}

function view(job: Job | undefined) {
  if (!job) return { running: false, lines: [] as string[], startedAt: null, finishedAt: null, exitCode: null, range: null };
  return {
    running: job.finishedAt === null,
    lines: job.lines,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    range: job.range,
  };
}

export async function GET() {
  return NextResponse.json(view(g.__collectJob), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (g.__collectJob && g.__collectJob.finishedAt === null) {
    return NextResponse.json({ error: "이미 자료를 가져오는 중이에요.", ...view(g.__collectJob) }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { start?: string; end?: string; skipSettlements?: boolean };
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(body.start ?? "") || !iso.test(body.end ?? "") || body.start! > body.end!) {
    return NextResponse.json({ error: "기간을 다시 골라 주세요." }, { status: 400 });
  }

  const script = path.join(process.cwd(), "scripts", "run-collect.mjs");
  if (!fs.existsSync(script)) return NextResponse.json({ error: "수집 프로그램을 찾지 못했어요." }, { status: 500 });

  const args = [script, "--start", body.start!, "--end", body.end!];
  if (body.skipSettlements) args.push("--skip-settlements");

  const job: Job = {
    id: Date.now().toString(36),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    lines: [],
    child: null,
    range: { start: body.start!, end: body.end! },
  };
  g.__collectJob = job;

  const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  job.child = child;
  child.stdout.on("data", (b: Buffer) => push(job, b.toString("utf8")));
  child.stderr.on("data", (b: Buffer) => push(job, b.toString("utf8")));
  child.on("close", (code) => {
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    job.child = null;
    try {
      const dir = path.join(process.cwd(), "data", "jobs");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${job.id}.log`), job.lines.join("\n"), "utf8");
    } catch {
      /* 기록 실패는 무시 */
    }
  });

  return NextResponse.json(view(job));
}

/** 진행 중인 수집 중단 */
export async function DELETE() {
  const job = g.__collectJob;
  if (!job || job.finishedAt !== null) return NextResponse.json({ error: "진행 중인 수집이 없어요." }, { status: 400 });
  job.child?.kill();
  push(job, "사용자가 수집을 중단했습니다.");
  return NextResponse.json(view(job));
}
