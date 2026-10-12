// 정확한 유리수 계산. 원화 원본은 정수로 받고, 요율·배분·평균은 반올림 없이 들고 다니다가
// 화면에 보여줄 때만 한 번 반올림한다 (PRD 14.2, 11장 "화면 반올림값을 다시 합산하지 않는다").

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export type QLike = Q | number | string | bigint;

export class Q {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    if (d === 0n) throw new RangeError("0으로 나눌 수 없습니다");
    if (d < 0n) [n, d] = [-n, -d];
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }

  static readonly ZERO = new Q(0n, 1n);
  static readonly ONE = new Q(1n, 1n);

  static frac(n: bigint | number, d: bigint | number = 1n): Q {
    return new Q(BigInt(n), BigInt(d));
  }

  /** 10진 표기 그대로 변환한다. 0.1 → 1/10 (부동소수점 오차 없음) */
  static of(x: QLike): Q {
    if (x instanceof Q) return x;
    if (typeof x === "bigint") return new Q(x, 1n);
    let s = typeof x === "number" ? String(x) : x.trim();
    if (typeof x === "number") {
      if (!Number.isFinite(x)) throw new RangeError(`숫자가 아닙니다: ${x}`);
      if (/e/i.test(s)) s = x.toFixed(12);
    }
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s.replace(/,/g, ""));
    if (!m || (m[2] === "" && !m[3])) throw new RangeError(`숫자가 아닙니다: ${x}`);
    const frac = m[3] ?? "";
    const n = BigInt((m[1] === "-" ? "-" : "") + (m[2] || "0") + frac);
    return new Q(n, 10n ** BigInt(frac.length));
  }

  /** 퍼센트 값(30 → 30%)을 비율로 */
  static pct(p: QLike): Q {
    return Q.of(p).div(100);
  }

  add(o: QLike): Q {
    const b = Q.of(o);
    return new Q(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  sub(o: QLike): Q {
    const b = Q.of(o);
    return new Q(this.n * b.d - b.n * this.d, this.d * b.d);
  }
  mul(o: QLike): Q {
    const b = Q.of(o);
    return new Q(this.n * b.n, this.d * b.d);
  }
  div(o: QLike): Q {
    const b = Q.of(o);
    if (b.n === 0n) throw new RangeError("0으로 나눌 수 없습니다");
    return new Q(this.n * b.d, this.d * b.n);
  }
  neg(): Q {
    return new Q(-this.n, this.d);
  }

  cmp(o: QLike): -1 | 0 | 1 {
    const b = Q.of(o);
    const l = this.n * b.d;
    const r = b.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  isZero(): boolean {
    return this.n === 0n;
  }
  isPositive(): boolean {
    return this.n > 0n;
  }

  floor(): bigint {
    const q = this.n / this.d;
    return this.n < 0n && q * this.d !== this.n ? q - 1n : q;
  }
  ceil(): bigint {
    return -this.neg().floor();
  }
  /** 0.5는 0에서 먼 쪽으로 (원 단위 표시용) */
  round(): bigint {
    const abs = this.n < 0n ? this.neg() : this;
    const r = abs.add(Q.frac(1, 2)).floor();
    return this.n < 0n ? -r : r;
  }

  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }

  static sum(xs: QLike[]): Q {
    return xs.reduce<Q>((acc, x) => acc.add(x), Q.ZERO);
  }
}

/** 분모가 0이면 null (화면에서 '계산 불가') */
export function safeDiv(a: Q | null, b: Q | null): Q | null {
  if (a === null || b === null || b.isZero()) return null;
  return a.div(b);
}
