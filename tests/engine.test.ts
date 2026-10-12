import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Q } from "@/lib/engine/rational";
import { pct, pp, won, wonShort } from "@/lib/engine/format";
import { checkCustomRange, coverage, daysInclusive, kstBounds, presetRange, prorate } from "@/lib/engine/period";
import {
  type ChannelInput,
  computeChannel,
  computeCogs,
  fixedFor,
  headline,
  ratioOfTotals,
} from "@/lib/engine/profit";
import { breakeven } from "@/lib/engine/breakeven";
import { simulatePrice } from "@/lib/engine/simulate";
import { aggregate, type CostSettings, menuTotals, type Store, verifyStore, weekdayStats } from "@/lib/dataset";
import { demoBusinesses } from "@/lib/demo";
import { quickCalc, takeShare, weeklyCompare } from "@/lib/insights";
import { addDays as addDaysFn } from "@/lib/engine/period";
import { readProgress } from "@/lib/collectProgress";

// PRD 12장 가상 예시 (월 2,000건)
const example: ChannelInput = {
  orders: 2000,
  grossSales: 40_000_000,
  ownerDiscount: 2_000_000,
  deductions: [
    { kind: "brokerage", amount: 2_800_000 },
    { kind: "payment", amount: 1_200_000 },
    { kind: "delivery", amount: 6_000_000 },
    { kind: "other", amount: 400_000 },
  ],
  cogs: { ratePct: 30, base: "gross", includesPackaging: false },
  packaging: 1_000_000,
  directFixed: Q.of(1_200_000),
  commonAllocated: Q.of(9_000_000),
};

describe("Q 유리수", () => {
  it("0.1 + 0.2 = 0.3 을 정확히 계산", () => {
    expect(Q.of(0.1).add(0.2).cmp(Q.of("0.3"))).toBe(0);
  });
  it("반올림·올림", () => {
    expect(Q.frac(5, 2).round()).toBe(3n);
    expect(Q.frac(-5, 2).round()).toBe(-3n);
    expect(Q.frac(10_200_000, 7300).ceil()).toBe(1398n);
    expect(Q.frac(-7, 2).floor()).toBe(-4n);
  });
});

describe("12장 예시 손익 (AC 05·20·31·59)", () => {
  const r = computeChannel(example);

  it("순매출 = 할인 전 판매액 − 점주 할인, 할인 재차감 없음", () => {
    expect(won(r.R)).toBe("38,000,000원");
    expect(won(r.R.div(r.N))).toBe("19,000원");
  });

  it("수익성 3단계: 공헌이익 1,460만 / 직접비 후 1,340만 / 배분 후 440만", () => {
    expect(won(r.cm)).toBe("14,600,000원");
    expect(won(r.direct)).toBe("13,400,000원");
    expect(won(r.allocated)).toBe("4,400,000원");
  });

  it("첫 화면 두 카드가 같은 범위로 함께 바뀜", () => {
    const d = headline(r, "direct");
    expect([won(d.perOrder), won(d.period), pct(d.ratio)]).toEqual(["6,700원", "13,400,000원", "35.3%"]);
    const a = headline(r, "allocated");
    expect([won(a.perOrder), won(a.period), pct(a.ratio)]).toEqual(["2,200원", "4,400,000원", "11.6%"]);
  });

  it("손익분기 1,398건, 하루 47건, 순매출 약 26,547,945원", () => {
    const b = breakeven(r, fixedFor(r, "allocated"), { businessDays: 30 });
    expect(b.status).toBe("ok");
    if (b.status !== "ok") return;
    expect(won(b.perOrderCm)).toBe("7,300원");
    expect(b.orders).toBe(1398n);
    expect(b.dailyOrders).toBe(47n);
    expect(won(b.netSales)).toBe("26,547,945원");
    expect(won(b.netSalesAtOrders)).toBe("26,562,000원");
  });

  it("1,000원 인상 시나리오: 620만 / 538만 / 456만 / 374만, 감소 한계 10.98%, 최소 1,781건", () => {
    const s = simulatePrice(r, fixedFor(r, "allocated"), {
      priceDelta: 1000,
      qtyPerOrder: 1,
      feeRatePct: 10,
      declinesPct: [0, 5, 10, 15],
    });
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    expect(won(s.c1)).toBe("8,200원");
    expect(s.scenarios.map((x) => won(x.profit))).toEqual(["6,200,000원", "5,380,000원", "4,560,000원", "3,740,000원"]);
    expect(s.scenarios.map((x) => won(x.diff, { signed: true }))).toEqual([
      "+1,800,000원",
      "+980,000원",
      "+160,000원",
      "−660,000원",
    ]);
    expect(s.scenarios.map((x) => won(x.netSales))).toEqual(["40,000,000원", "38,000,000원", "36,000,000원", "34,000,000원"]);
    expect(pct(s.scenarios[0].ratio, 2)).toBe("15.50%");
    expect(pp(s.scenarios[0].ratio!.sub(s.baseRatio!), 2)).toBe("+3.92%p");
    expect(pct(s.maxDecline, 2)).toBe("10.98%");
    expect(s.minOrders).toBe(1781n);
  });
});

describe("원가와 누락 비용 (AC 10·13·17·30·38·39)", () => {
  it("A는 상세 원가 4천원, B만 원가율 30% → 7천원, 상세 비중 50%", () => {
    const c = computeCogs(
      { ratePct: 30, base: "gross", includesPackaging: false, detailed: [{ menu: "A", sales: 10_000, cost: 4_000 }] },
      Q.of(20_000),
      Q.of(20_000),
    );
    expect(won(c.cogs)).toBe("7,000원");
    expect(pct(c.detailedShare)).toBe("50.0%");
  });

  it("원가율 미입력이면 0원으로 두지 않고 공헌이익을 계산하지 않음", () => {
    const r = computeChannel({ ...example, cogs: { ratePct: null, base: "gross", includesPackaging: false } });
    expect(r.flags.cogsMissing).toBe(true);
    expect(r.cm).toBeNull();
    expect(headline(r, "direct").perOrder).toBeNull();
    expect(breakeven(r, fixedFor(r, "direct"), { businessDays: 30 }).status).toBe("unavailable");
  });

  it("포장비만 모르면 '포장비 제외 추정'으로 계산", () => {
    const r = computeChannel({ ...example, packaging: null });
    expect(r.flags.packagingMissing).toBe(true);
    expect(won(r.cm)).toBe("15,600,000원");
  });

  it("공통비 미입력: 공헌이익·직접비 후는 보여주고 배분 후 손익·손익분기는 막음", () => {
    const r = computeChannel({ ...example, commonAllocated: null });
    expect(won(r.direct)).toBe("13,400,000원");
    expect(r.allocated).toBeNull();
    expect(fixedFor(r, "allocated")).toBeNull();
    expect(breakeven(r, fixedFor(r, "allocated"), { businessDays: 30 }).status).toBe("unavailable");
  });

  it("주문 0건·공헌이익 0 이하에서 오류 없이 계산 불가 / 구조적 손실", () => {
    const zero = computeChannel({ ...example, orders: 0, grossSales: 0, ownerDiscount: 0, deductions: [], packaging: 0 });
    expect(headline(zero, "direct").perOrder).toBeNull();
    expect(breakeven(zero, fixedFor(zero, "direct"), { businessDays: 30 }).status).toBe("unavailable");

    const loss = computeChannel({ ...example, deductions: [{ kind: "delivery", amount: 30_000_000 }] });
    expect(breakeven(loss, fixedFor(loss, "direct"), { businessDays: 30 }).status).toBe("unrecoverable");
  });

  it("가격을 올려도 기준 재료원가 금액은 그대로 (주문당 추가 공헌이익 = 인상액 − 수수료)", () => {
    const r = computeChannel(example);
    const s = simulatePrice(r, fixedFor(r, "direct"), { priceDelta: 500, qtyPerOrder: 2, feeRatePct: 10, declinesPct: [0] });
    if (s.status !== "ok") throw new Error(s.status);
    expect(won(s.addedPerOrder)).toBe("900원"); // 같은 메뉴 2개 → 1,000원 인상, 수수료 100원
  });

  it("메뉴 하나만 올리면 그 메뉴가 팔린 개수만큼만 (v6): 2,000건 중 800개 팔린 메뉴 +500원", () => {
    const r = computeChannel(example);
    const s = simulatePrice(r, fixedFor(r, "direct"), { priceDelta: 500, qtyPerOrder: Q.of(800).div(2000), feeRatePct: 10, declinesPct: [0] });
    if (s.status !== "ok") throw new Error(s.status);
    expect(won(s.addedPerOrder)).toBe("180원"); // 500 × 0.4 = 200, 수수료 10% 빼면 180
    expect(won(s.scenarios[0].diff)).toBe("360,000원"); // 800개 × 450원 (전 주문이면 900,000원)
  });

  it("정액 광고에서 주문 10% 감소: 광고 총액 유지, 주문당 배분액 증가 (AC 14)", () => {
    const r = computeChannel(example);
    const s = simulatePrice(r, fixedFor(r, "direct"), { priceDelta: 0, qtyPerOrder: 1, feeRatePct: 10, declinesPct: [10] });
    if (s.status !== "ok") throw new Error(s.status);
    const sc = s.scenarios[0];
    expect(sc.orders).toBe(1800n);
    expect(won(sc.profit)).toBe(won(Q.of(7300).mul(1800).sub(1_200_000)));
    expect(won(Q.of(1_200_000).div(sc.orders))).toBe("667원");
  });
});

describe("기간 (AC 49·50·51·52)", () => {
  it("2026-09-17의 최근 한 달은 8/18~9/16, 30일, 한국 시간 경계", () => {
    const r = presetRange("1m", "2026-09-17");
    expect(r).toEqual({ start: "2026-08-18", end: "2026-09-16" });
    expect(daysInclusive(r)).toBe(30);
    expect(kstBounds(r)).toEqual({ from: "2026-08-18T00:00:00+09:00", toExclusive: "2026-09-17T00:00:00+09:00" });
    expect(daysInclusive(presetRange("6m", "2026-09-17"))).toBe(180);
  });

  it("직접 지정: 미래·역순 차단, 오늘 포함 표시, 6개월 초과 허용", () => {
    expect(checkCustomRange("2026-09-10", "2026-09-18", "2026-09-17").ok).toBe(false);
    expect(checkCustomRange("2026-09-10", "2026-09-01", "2026-09-17").ok).toBe(false);
    const c = checkCustomRange("2025-01-01", "2026-09-17", "2026-09-17");
    expect(c.ok && c.includesToday && c.days > 180).toBe(true);
  });

  it("8월 31만원·9월 60만원을 8/18~9/16에 일할 배분하면 46만원", () => {
    const p = prorate(
      [
        { id: "8", label: "8월", amount: 310_000, start: "2026-08-01", end: "2026-08-31" },
        { id: "9", label: "9월", amount: 600_000, start: "2026-09-01", end: "2026-09-30" },
      ],
      { start: "2026-08-18", end: "2026-09-16" },
    );
    expect(won(p.total)).toBe("460,000원");
    expect(p.parts.map((x) => [x.overlapDays, x.costDays])).toEqual([
      [14, 31],
      [16, 30],
    ]);
  });

  it("빈 구간은 누락으로 남김", () => {
    const c = coverage({ start: "2026-06-01", end: "2026-06-30" }, [
      { start: "2026-06-01", end: "2026-06-09" },
      { start: "2026-06-15", end: "2026-06-20" },
    ]);
    expect(c.complete).toBe(false);
    expect(c.coveredDays).toBe(15);
    expect(c.missing).toEqual([
      { start: "2026-06-10", end: "2026-06-14" },
      { start: "2026-06-21", end: "2026-06-30" },
    ]);
  });

  it("기간 이익률은 합계로 (17.5%), 월별 단순 평균 15% 금지", () => {
    const ratio = ratioOfTotals([
      { numerator: 100_000, denominator: 1_000_000 },
      { numerator: 600_000, denominator: 3_000_000 },
    ]);
    expect(pct(ratio)).toBe("17.5%");
  });
});

describe("데모 자료 집계", () => {
  const [a, b] = demoBusinesses("2026-09-17");

  it("사업자 A의 일별 자료를 합치면 12장 예시와 같음", () => {
    const agg = aggregate(a.stores[0], a.settings, presetRange("1m", "2026-09-17"));
    expect(agg.coverage.complete).toBe(true);
    const r = computeChannel(agg.input);
    expect(r.N).toBe(2000);
    expect(won(headline(r, "direct").perOrder)).toBe("6,700원");
    expect(won(headline(r, "allocated").period)).toBe("4,400,000원");
  });

  it("사업자 A에서 6개월을 고르면 부분 합계와 누락 표시, 빈 기간을 채우지 않음", () => {
    const agg = aggregate(a.stores[0], a.settings, presetRange("6m", "2026-09-17"));
    expect(agg.coverage.complete).toBe(false);
    expect(agg.coverage.coveredDays).toBe(30);
    expect(agg.input.orders).toBe(2000);
  });

  it("사업자 B는 포장비·공통비 미입력, 월 광고비는 선택 기간만큼만", () => {
    const range = presetRange("1m", "2026-09-17");
    const agg = aggregate(b.stores[0], b.settings, range);
    const r = computeChannel(agg.input);
    expect(r.flags.packagingMissing).toBe(true);
    expect(r.flags.commonMissing).toBe(true);
    expect(r.flags.hasUnclassified).toBe(true);
    // 8월 450,000 × 14/31 + 9월 450,000 × 16/30
    expect(won(r.directFixed)).toBe(won(Q.of(450_000).mul(14).div(31).add(Q.of(450_000).mul(16).div(30))));
  });

  it("사업자 A 설정이 B에 복사되지 않음", () => {
    expect(b.settings.commonCosts).toHaveLength(0);
    expect(a.settings.cogs.ratePct).not.toBe(b.settings.cogs.ratePct);
  });
});

describe("메뉴별 자료 (실제 수집 구조)", () => {
  const store: Store = {
    id: "s1",
    name: "테스트 매장",
    collected: [{ start: "2026-09-01", end: "2026-09-02" }],
    rows: [
      {
        date: "2026-09-01",
        orders: 2,
        gross: 30_000,
        discount: 0,
        otherRevenue: 1_000,
        deductions: { brokerage: 2_000, payment: 900 },
        menus: {
          국밥: { qty: 1, sales: 10_000, discount: 0, orders: 1, options: { 곱빼기: { qty: 1, sales: 2_000 } } },
          수육: { qty: 1, sales: 20_000, discount: 0, orders: 1 },
        },
      },
      {
        date: "2026-09-02",
        orders: 1,
        gross: 10_000,
        discount: 0,
        deductions: { brokerage: 700, payment: 300 },
        menus: { 국밥: { qty: 1, sales: 10_000, discount: 0, orders: 1 } },
      },
    ],
  };
  const settings: CostSettings = {
    cogs: { ratePct: 30, base: "gross", includesPackaging: false },
    packagingPerOrder: 0,
    directCosts: [],
    commonCosts: [],
    noDirectCosts: true,
    noCommonCosts: true,
    closedDays: 0,
  };

  it("기간 안의 메뉴만 합치고 판매액 순으로 정렬한다", () => {
    const all = menuTotals(store, { start: "2026-09-01", end: "2026-09-02" });
    expect(all.map((m) => [m.name, m.qty, m.sales])).toEqual([
      ["국밥", 2, 20_000],
      ["수육", 1, 20_000],
    ]);
    expect(all[0].options).toEqual([{ name: "곱빼기", qty: 1, sales: 2_000 }]);

    const oneDay = menuTotals(store, { start: "2026-09-02", end: "2026-09-02" });
    expect(oneDay.map((m) => [m.name, m.sales])).toEqual([["국밥", 10_000]]);
  });

  it("메뉴 원가를 넣으면 그 메뉴만 상세 원가, 나머지는 원가율 (중복 없음)", () => {
    const range = { start: "2026-09-01", end: "2026-09-02" };
    const agg = aggregate(store, { ...settings, menuCosts: { 국밥: 3_500 } }, range);
    const r = computeChannel(agg.input);
    // 국밥 2개 × 3,500원 + 수육 20,000원 × 30% = 13,000원
    expect(won(r.cogs)).toBe("13,000원");
    expect(pct(r.detailedShare)).toBe("50.0%");
    // 가게배달팁 수입은 객단가가 아니라 공헌이익에만 더한다
    expect(won(r.R)).toBe("40,000원");
    expect(won(r.cm)).toBe("24,100원");
  });

  it("메뉴 원가를 안 넣으면 전체 원가율만 적용한다", () => {
    const agg = aggregate(store, settings, { start: "2026-09-01", end: "2026-09-02" });
    const r = computeChannel(agg.input);
    expect(won(r.cogs)).toBe("12,000원");
    expect(pct(r.detailedShare)).toBe("0.0%");
  });
});

describe("수집 진행 표시 (v3 — 실제 기록 형식)", () => {
  it("로그인 대기 → 주문 받는 중 → 정산명세서 → 끝", () => {
    const lines = [
      "[16시 55분 01초] 자료 가져오기 시작: 2026-08-22 ~ 2026-09-20",
      "[16시 55분 01초] ▶ [1/4] 주문·정산 내역",
      "[16시 55분 02초] 브라우저 실행 (chrome)",
      "[16시 55분 03초] 배민 로그인이 필요합니다. 열린 크롬 창에서 직접 로그인해 주세요. (최대 10분 대기)",
    ];
    let p = readProgress(lines);
    expect(p.step).toBe(1);
    expect(p.waitingLogin).toBe(true);

    lines.push("[16시 56분 10초] 수집 기간 2026-08-22 ~ 2026-09-20", "[16시 56분 20초] 800 / 1577건 수집");
    p = readProgress(lines);
    expect(p.waitingLogin).toBe(false);
    expect(p.count).toEqual({ now: 800, total: 1577 });

    lines.push(
      "[16시 58분 00초] ✔ [1/4] 주문·정산 내역 완료",
      "[16시 58분 00초] ▶ [2/4] 광고·마케팅 비용",
      "[16시 58분 40초] ✔ [2/4] 광고·마케팅 비용 완료",
      "[16시 58분 40초] ▶ [3/4] 정산명세서",
      "[16시 59분 10초] 7/24 · 입금일 2026-09-15 · 정산기간 2026-09-10~2026-09-10 · 입금 577,316원",
    );
    p = readProgress(lines);
    expect(p.step).toBe(3);
    expect([...p.done]).toEqual([1, 2]);
    expect(p.count).toEqual({ now: 7, total: 24 });

    lines.push("[17시 02분 00초] 받지 못한 정산 1건: 2026-09-03 — 다시 실행하면 이어서 받습니다.");
    expect(readProgress(lines).failedSettlements).toBe(true);
  });
});

describe("wonShort — 큰 금액을 만·억 단위로 읽어 주기 (v4)", () => {
  it("만 단위로 내림해서 읽는다", () => {
    expect(wonShort(13_400_000)).toBe("1,340만 원");
    expect(wonShort(Q.of(6_700))).toBe(""); // 1만 원 미만은 안 붙임
    expect(wonShort(234_500_000)).toBe("2억 3,450만 원");
    expect(wonShort(-1_200_000)).toBe("−120만 원");
    expect(wonShort(null)).toBe("");
  });
});

describe("예시 가게 C — 처음부터 만든 가상 자료 (v8)", () => {
  const today = "2026-10-12";
  const c = demoBusinesses(today).find((b) => b.id === "biz-c")!;
  const rows = c.stores[0].rows;

  it("112일치이고 어제(오늘 − 1일)로 끝난다", () => {
    expect(rows).toHaveLength(112);
    expect(rows[rows.length - 1].date).toBe("2026-10-11");
  });

  it("하루 판매액·할인은 그날 메뉴별 합과 정확히 같다", () => {
    for (const r of rows) {
      const m = Object.values(r.menus ?? {});
      expect(m.reduce((a, x) => a + x.sales, 0)).toBe(r.gross);
      expect(m.reduce((a, x) => a + x.discount, 0)).toBe(r.discount);
    }
  });

  it("같은 날 두 번 만들어도 똑같다 (시드 고정)", () => {
    const again = demoBusinesses(today).find((b) => b.id === "biz-c")!;
    expect(again.stores[0].rows).toEqual(rows);
  });

  it("광고비 항목은 auto- 로 시작해 화면에서 한 줄로 접힌다", () => {
    expect(c.settings.directCosts.length).toBeGreaterThan(100);
    expect(c.settings.directCosts.every((d) => d.id.startsWith("auto-"))).toBe(true);
  });

  it("정산은 최근 입금 순이고, 입금 전(입금요청) 건이 기간 안에 하나 있다", () => {
    const list = c.settlements!;
    for (let i = 1; i < list.length; i++) expect(list[i - 1].depositDueDate >= list[i].depositDueDate).toBe(true);
    const yesterday = "2026-10-11";
    expect(list.some((x) => x.status === "입금요청" && x.depositDueDate <= yesterday)).toBe(true);
  });

  it("실제 가게 이름·메뉴 이름·번호가 들어 있지 않다", () => {
    const text = JSON.stringify(c);
    // 11자리 이상 숫자(사업자 번호 모양)는 가상 자료에 나올 수 없다
    expect(/[0-9]{11,}/.test(text)).toBe(false);
    // 금지어 목록은 저장소에 두지 않는다: 내 컴퓨터의 data/forbidden-names.txt(git 제외)가 있을 때만 확인한다
    const file = path.join(process.cwd(), "data", "forbidden-names.txt");
    if (fs.existsSync(file)) {
      for (const bad of fs.readFileSync(file, "utf8").split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)) expect(text.includes(bad)).toBe(false);
    }
  });
});

describe("데모 정산: 어느 날짜에 열어도 입금 전 줄이 보인다", () => {
  it("14일 연속 날짜 모두, 선택 기간(어제까지) 안에 입금요청 정산이 있다", () => {
    for (let i = 0; i < 14; i++) {
      const today = addDaysFn("2026-10-01", i);
      const c = demoBusinesses(today)[2];
      const yesterday = addDaysFn(today, -1);
      expect(c.settlements!.some((x) => x.status === "입금요청" && x.depositDueDate <= yesterday), today).toBe(true);
    }
  });
});

describe("v9: 요일별 평균과 자료 검산", () => {
  const row = (date: string, orders: number, gross: number, discount = 0) => ({ date, orders, gross, discount, deductions: { brokerage: 1000 } });
  const range = { start: "2026-09-07", end: "2026-09-20" }; // 월~일 두 주
  it("요일마다 하루 평균을 내고, 자료 없는 요일은 0일로 둔다", () => {
    const store: Store = { id: "s", name: "s", collected: [range], rows: [row("2026-09-07", 10, 100000), row("2026-09-14", 20, 200000), row("2026-09-12", 5, 50000)] };
    const w = weekdayStats(store, range);
    expect(w.map((x) => x.label)).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    expect(w[0]).toMatchObject({ days: 2, avgOrders: 15, avgNet: 150000, avgAfterDeductions: 149000 });
    expect(w[1].days).toBe(0);
    expect(w[5]).toMatchObject({ label: "토", days: 1, avgOrders: 5 });
  });
  it("예시 가게 A·B·C는 검산에서 아무 문제도 안 나온다", () => {
    for (const b of demoBusinesses("2026-10-12")) {
      for (const s of b.stores) expect(verifyStore(s, { start: "2026-06-01", end: "2026-10-11" })).toEqual([]);
    }
  });
  it("같은 날짜가 두 번이면 잡아낸다", () => {
    const store: Store = { id: "s", name: "s", collected: [range], rows: [row("2026-09-07", 10, 100000), row("2026-09-07", 10, 100000)] };
    expect(verifyStore(store, range)[0]).toContain("두 번");
  });
  it("할인이 매출보다 크거나 음수 매출이면 잡아낸다", () => {
    const store: Store = { id: "s", name: "s", collected: [range], rows: [row("2026-09-07", 10, 1000, 5000), row("2026-09-08", -1, -5)] };
    expect(verifyStore(store, range).length).toBe(2);
  });
});

describe("v9: 배민 몫 한 줄 · 주간 비교 · 빠른 계산", () => {
  it("빠른 계산: 100원 중 몫·주문당·재료비 전 남는 돈", () => {
    const r = quickCalc({ sales: 12_000_000, orders: 600, takenByBaemin: 3_000_000 })!;
    expect(r.per100.toNumber()).toBe(25);
    expect(r.avgOrder.toNumber()).toBe(20000);
    expect(r.takenPerOrder.toNumber()).toBe(5000);
    expect(r.leftBeforeCosts.toNumber()).toBe(9_000_000);
  });
  it("빠른 계산: 말이 안 되는 입력은 계산하지 않는다", () => {
    expect(quickCalc({ sales: 0, orders: 10, takenByBaemin: 1 })).toBeNull();
    expect(quickCalc({ sales: 1000, orders: 0, takenByBaemin: 1 })).toBeNull();
    expect(quickCalc({ sales: 1000, orders: 5, takenByBaemin: 5000 })).toBeNull();
    expect(quickCalc({ sales: NaN, orders: 5, takenByBaemin: 1 })).toBeNull();
  });
  it("배민 몫: 예시 가게 A·B·C 모두 0~100원 사이", () => {
    for (const b of demoBusinesses("2026-10-12")) {
      const store = b.stores[0];
      const range = { start: "2026-06-01", end: "2026-10-12" };
      const t = takeShare(computeChannel(aggregate(store, b.settings, range).input))!;
      expect(t.per100.toNumber()).toBeGreaterThan(0);
      expect(t.per100.toNumber()).toBeLessThan(100);
    }
  });
  it("주간 비교: 7일씩 더해 차이를 낸다 / 자료가 5일 미만이면 비교하지 않는다", () => {
    const row = (date: string, gross: number) => ({ date, orders: 10, gross, discount: 0, deductions: {} });
    const days = (from: string, n: number, gross: number) => Array.from({ length: n }, (_, i) => row(addDaysFn(from, i), gross));
    const settings = demoBusinesses("2026-10-12")[0].settings;
    const full: Store = { id: "s", name: "s", collected: [], rows: [...days("2026-09-01", 7, 100000), ...days("2026-09-08", 7, 150000)] };
    const w = weeklyCompare(full, settings, "direct");
    expect(w).not.toBeNull();
    expect(w!.cur.start).toBe("2026-09-08");
    expect(w!.diff.cmp(0)).toBeGreaterThan(0);
    const thin: Store = { id: "s", name: "s", collected: [], rows: [...days("2026-09-01", 7, 100000), ...days("2026-09-08", 3, 150000)] };
    expect(weeklyCompare(thin, settings, "direct")).toBeNull();
  });
});
