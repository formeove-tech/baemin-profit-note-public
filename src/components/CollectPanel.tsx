"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, koreaToday } from "@/lib/engine/period";
import { COLLECT_STEPS as STEPS, readProgress } from "@/lib/collectProgress";

interface JobView {
  running: boolean;
  lines: string[];
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  range: { start: string; end: string } | null;
}

/**
 * 배민에서 자료를 가져오는 버튼. 누르면 내 컴퓨터에서 크롬이 열리고,
 * 사장님이 배민에 직접 로그인하면 그 뒤는 알아서 읽어 온다.
 */
export function CollectPanel({
  onDone,
  request,
}: {
  onDone: () => void;
  /** v5: '자료 없는 기간 가져오기' 버튼이 넘겨 주는 기간. n이 바뀔 때마다 날짜를 바꾸고 이 칸으로 화면을 옮긴다 */
  request?: { start: string; end: string; n: number } | null;
}) {
  const [today] = useState(() => koreaToday());
  const [start, setStart] = useState(() => addDays(today, -30));
  const [end, setEnd] = useState(() => addDays(today, -1));
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const wasRunning = useRef(false);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!request) return;
    setStart(request.start);
    setEnd(request.end);
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [request]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/collect", { cache: "no-store" });
        const data = (await res.json()) as JobView;
        if (!alive) return;
        setJob(data);
        if (wasRunning.current && !data.running) onDone(); // 끝나면 화면 자료를 새로 읽는다
        wasRunning.current = data.running;
      } catch {
        /* 앱을 껐다 켜는 중 */
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [onDone]);

  async function startCollect() {
    setError(null);
    const res = await fetch("/api/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start, end }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "시작하지 못했어요.");
    else {
      setJob(data);
      wasRunning.current = true;
    }
  }

  const running = job?.running ?? false;
  const p = readProgress(job?.lines ?? []);
  const hasLog = (job?.lines.length ?? 0) > 0;

  return (
    <section ref={box} className="card mb-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="section">배민에서 자료 가져오기</h2>
          <p className="mt-1 text-sm">
            버튼을 누르면 크롬 창이 열려요. <strong>배민에 로그인만 해 주시면</strong> 주문·정산·광고 자료를 알아서 읽어 옵니다.
          </p>
          <p className="mt-1 text-xs muted">
            🔒 비밀번호는 배민 화면에만 입력되고 저장하지 않아요. 가져온 자료는 <strong>이 컴퓨터에만</strong> 저장되고 어디로도 보내지 않아요.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="muted">언제부터</span>
            <input type="date" className="input w-auto" max={today} value={start} onChange={(e) => setStart(e.target.value)} disabled={running} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="muted">언제까지</span>
            <input type="date" className="input w-auto" max={today} value={end} onChange={(e) => setEnd(e.target.value)} disabled={running} />
          </label>
          {running ? (
            <button className="btn" onClick={() => fetch("/api/collect", { method: "DELETE" })}>
              그만 가져오기
            </button>
          ) : (
            <button className="btn btn-primary" onClick={startCollect}>
              자료 가져오기
            </button>
          )}
        </div>
      </div>
      {!running && !hasLog && <p className="mt-2 text-xs muted">처음엔 최근 30일로 두시면 돼요. 보통 5~10분 걸려요.</p>}

      {error && <p className="mt-2 text-sm loss">{error}</p>}

      {job && (running || hasLog) && (
        <div className="mt-3 rounded-lg p-3" style={{ background: "var(--soft)" }}>
          {running && (
            <p className="mb-2 text-sm font-semibold" style={{ color: "var(--accent)" }}>
              {p.waitingLogin || p.step === 0
                ? "크롬 창에서 배민에 로그인해 주세요. 로그인하면 나머지는 알아서 해요."
                : "가져오는 중이에요. 크롬 창은 끝나면 저절로 닫혀요 — 닫지 말고 기다려 주세요."}
            </p>
          )}
          {!running && (
            <p className="mb-2 text-sm font-semibold">
              {job.exitCode === 0 ? "✓ 다 가져왔어요. 아래 숫자가 새로 바뀌었어요." : "중간에 멈췄어요. 받은 만큼은 저장했어요 — 다시 누르면 이어서 가져와요."}
            </p>
          )}

          <ol className="flex flex-col gap-1.5 text-sm">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const isDone = p.done.has(n) || (!running && job.exitCode === 0);
              const isNow = running && p.step === n && !p.done.has(n);
              return (
                <li key={label} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="w-4 text-center">{isDone ? "✓" : isNow ? "●" : "○"}</span>
                    <span className={isNow ? "font-semibold" : isDone ? "" : "muted"}>
                      {n}. {label}
                    </span>
                    {isNow && p.count && p.count.total > 0 && (
                      <span className="text-xs muted">
                        {p.count.now.toLocaleString("ko-KR")} / {p.count.total.toLocaleString("ko-KR")}
                        {n === 1 ? "건" : "개"}
                      </span>
                    )}
                  </div>
                  {isNow && p.count && p.count.total > 0 && (
                    <div className="ml-6 h-1.5 rounded-full" style={{ background: "var(--line)" }}>
                      <div
                        className="h-1.5 rounded-full"
                        style={{ width: `${Math.min(100, (p.count.now / p.count.total) * 100)}%`, background: "var(--accent)" }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {p.failedSettlements && !running && (
            <p className="mt-2 text-xs">정산명세서 일부를 못 받았어요. &lsquo;자료 가져오기&rsquo;를 한 번 더 누르면 이어서 받아요.</p>
          )}

          <button className="mt-2 text-xs underline muted" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "기술 기록 접기" : "기술 기록 보기 (문제가 생겼을 때 보내 주세요)"}
          </button>
          {showLog && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg p-2 text-xs" style={{ background: "var(--card)", whiteSpace: "pre-wrap" }}>
              {(job.lines ?? []).slice(-200).join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
