import { Q } from "./rational";

const nf = new Intl.NumberFormat("ko-KR");

/** 1,234,567원 */
export function won(x: Q | bigint | number | null, opts: { signed?: boolean } = {}): string {
  if (x === null) return "계산 불가";
  const v = x instanceof Q ? x.round() : BigInt(Math.round(Number(x)));
  const sign = v < 0n ? "−" : opts.signed && v > 0n ? "+" : "";
  const abs = v < 0n ? -v : v;
  return `${sign}${nf.format(abs)}원`;
}

/** 큰 금액을 읽기 쉽게: 13,400,000 → "1,340만 원", 234,500,000 → "2억 3,450만 원". 1만 원 미만은 빈 문자열 */
export function wonShort(x: Q | bigint | number | null): string {
  if (x === null) return "";
  const v = x instanceof Q ? x.round() : BigInt(Math.round(Number(x)));
  const abs = v < 0n ? -v : v;
  if (abs < 10_000n) return "";
  const sign = v < 0n ? "−" : "";
  const man = abs / 10_000n; // 만 단위로 내림
  const eok = man / 10_000n;
  const rest = man % 10_000n;
  if (eok > 0n) return `${sign}${nf.format(eok)}억${rest > 0n ? ` ${nf.format(rest)}만` : ""} 원`;
  return `${sign}${nf.format(man)}만 원`;
}

/** 비율(0.353)을 35.3% 로. 기본 소수점 1자리 */
export function pct(ratio: Q | null, digits = 1, opts: { signed?: boolean } = {}): string {
  if (ratio === null) return "계산 불가";
  const scaled = ratio.mul(100).mul(10 ** digits).round();
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const s = abs.toString().padStart(digits + 1, "0");
  const body = digits > 0 ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
  const sign = neg ? "−" : opts.signed && scaled > 0n ? "+" : "";
  return `${sign}${body}%`;
}

/** 비율 차이를 %p 로 (+3.9%p) */
export function pp(diff: Q | null, digits = 1): string {
  if (diff === null) return "계산 불가";
  return pct(diff, digits, { signed: true }).replace(/%$/, "%p");
}

export function count(n: bigint | number | null, unit = "건"): string {
  if (n === null) return "계산 불가";
  return `${nf.format(n)}${unit}`;
}
