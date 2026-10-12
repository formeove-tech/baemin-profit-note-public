// 분석 기간 (PRD 11장 기간 선택, CALC 07). 날짜는 한국 날짜 'YYYY-MM-DD' 문자열로 다룬다.
import { Q } from "./rational";

export type PresetKey = "1m" | "3m" | "6m";
export interface DateRange {
  start: string; // 포함
  end: string; // 포함
}

export const PRESETS: Record<PresetKey, { label: string; days: number }> = {
  "1m": { label: "최근 한 달", days: 30 },
  "3m": { label: "3개월", days: 90 },
  "6m": { label: "6개월", days: 180 },
};

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(d: string, n: number): string {
  return fromMs(toMs(d) + n * DAY);
}

export function daysInclusive(r: DateRange): number {
  return Math.round((toMs(r.end) - toMs(r.start)) / DAY) + 1;
}

/** 지금 이 순간의 한국 날짜 */
export function koreaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 프리셋: 오늘(T) 기준 T−N일 ~ T−1일, 양 끝 포함 */
export function presetRange(key: PresetKey, today: string): DateRange {
  return { start: addDays(today, -PRESETS[key].days), end: addDays(today, -1) };
}

export type RangeCheck =
  | { ok: true; range: DateRange; days: number; includesToday: boolean }
  | { ok: false; error: string };

/** 직접 지정 기간 검증. 6개월 제한은 두지 않는다. */
export function checkCustomRange(start: string, end: string, today: string): RangeCheck {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(start) || !iso.test(end)) return { ok: false, error: "시작일과 종료일을 모두 골라 주세요." };
  if (start > end) return { ok: false, error: "시작일이 종료일보다 늦습니다." };
  if (end > today) return { ok: false, error: "미래 날짜는 고를 수 없습니다." };
  const range = { start, end };
  return { ok: true, range, days: daysInclusive(range), includesToday: end === today };
}

/** 한국 시간 조회 경계: 시작일 00:00 이상, 종료일 다음 날 00:00 미만 */
export function kstBounds(r: DateRange): { from: string; toExclusive: string } {
  return { from: `${r.start}T00:00:00+09:00`, toExclusive: `${addDays(r.end, 1)}T00:00:00+09:00` };
}

export function inRange(date: string, r: DateRange): boolean {
  return date >= r.start && date <= r.end;
}

export function overlap(a: DateRange, b: DateRange): DateRange | null {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
}

export function monthRange(month: string): DateRange {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/** 적용 기간이 있는 비용 (월 비용이면 그 달 1일~말일) */
export interface DatedCost {
  id: string;
  label: string;
  amount: number; // 원, 적용 기간 전체 금액
  start: string;
  end: string;
}

export interface ProratedPart {
  cost: DatedCost;
  overlapDays: number;
  costDays: number;
  share: Q; // 선택 기간에 배분된 금액
}

/**
 * 선택 기간과 겹치는 만큼 달력 일수로 일할 배분한다 (CALC 07 잠정 기준).
 * 월 정액비 310,000원(8월) + 600,000원(9월), 8/18~9/16 → 140,000 + 320,000 = 460,000원
 */
export function prorate(costs: DatedCost[], r: DateRange): { total: Q; parts: ProratedPart[] } {
  const parts: ProratedPart[] = [];
  for (const cost of costs) {
    const ov = overlap(r, cost);
    if (!ov) continue;
    const costDays = daysInclusive(cost);
    const overlapDays = daysInclusive(ov);
    parts.push({ cost, overlapDays, costDays, share: Q.of(cost.amount).mul(overlapDays).div(costDays) });
  }
  return { total: Q.sum(parts.map((p) => p.share)), parts };
}

/** 요청 기간 중 자료가 있는 날과 빈 구간 (빈 구간을 0원으로 채우지 않기 위해) */
export function coverage(r: DateRange, available: DateRange[]) {
  const covered = new Set<string>();
  for (const a of available) {
    const ov = overlap(r, a);
    if (!ov) continue;
    for (let d = ov.start; d <= ov.end; d = addDays(d, 1)) covered.add(d);
  }
  const missing: DateRange[] = [];
  let cur: DateRange | null = null;
  for (let d = r.start; d <= r.end; d = addDays(d, 1)) {
    if (covered.has(d)) {
      cur = null;
    } else if (cur) {
      cur.end = d;
    } else {
      cur = { start: d, end: d };
      missing.push(cur);
    }
  }
  const requestedDays = daysInclusive(r);
  return { requestedDays, coveredDays: covered.size, missing, complete: covered.size === requestedDays };
}
