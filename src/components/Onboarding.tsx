"use client";

import { useState } from "react";
import { Q } from "@/lib/engine/rational";
import { pct, won } from "@/lib/engine/format";
import { type DateRange, daysInclusive, monthRange, monthsBetween } from "@/lib/engine/period";
import type { CostSettings, MenuTotal } from "@/lib/dataset";
import type { ChannelResult } from "@/lib/engine/profit";

const onlyDigits = (v: string) => v.replace(/[^\d]/g, "");
const num = (v: string) => Number(onlyDigits(v)) || 0;

/**
 * 처음 쓰는 사장님이 막히지 않게, 지금 무엇이 비었고 다음에 뭘 하면 되는지 하나씩 보여 준다.
 * v3: 원가율(%)을 몰라도 대표 메뉴 한 개의 판매가·재료비로 시작할 수 있고,
 *     인건비·월세도 이 자리에서 바로 넣는다 (가상 사장님 QA에서 막힌 두 곳).
 */
export function Onboarding({
  hasData,
  result,
  settings: s,
  onChange,
  orders,
  menus,
  range,
}: {
  hasData: boolean;
  result: ChannelResult | null;
  settings: CostSettings;
  onChange: (p: Partial<CostSettings>) => void;
  orders: number;
  menus: MenuTotal[];
  range: DateRange | null;
}) {
  const [hide, setHide] = useState(false);
  // 원가율
  const [rateMode, setRateMode] = useState<"menu" | "percent">("menu");
  const [rate, setRate] = useState("");
  const topMenus = menus.filter((m) => m.qty > 0).slice(0, 8);
  const [menuName, setMenuName] = useState(topMenus[0]?.name ?? "");
  const pickedMenu = topMenus.find((m) => m.name === menuName);
  const [price, setPrice] = useState(pickedMenu ? String(Math.round(pickedMenu.sales / pickedMenu.qty)) : "");
  const [menuCost, setMenuCost] = useState("");
  // 포장비
  const [pack, setPack] = useState("");
  // 인건비·월세
  const [labor, setLabor] = useState("");
  const [rent, setRent] = useState("");
  const [utility, setUtility] = useState("");
  const [share, setShare] = useState("");
  // v6 QA: "배민 매출 비중을 내가 무슨 수로 알아요" → 이 기간 가게 전체 매출을 넣으면 비중을 계산해 준다
  const [shareMode, setShareMode] = useState<"pct" | "sales">("pct");
  const [totalSales, setTotalSales] = useState("");

  const computedRate = num(price) > 0 && num(menuCost) > 0 ? (num(menuCost) / num(price)) * 100 : null;
  const monthlyCommon = num(labor) + num(rent) + num(utility);
  // 인건비·월세가 '한 달' 단위라 전체 매출도 한 달치로 묻는다. 배민 쪽은 선택 기간 주문 금액을 한 달(30일) 평균으로 바꿔 비교
  const rangeDays = range ? daysInclusive(range) : 0;
  const baeminMonthly = result && rangeDays > 0 ? Math.round((Number(result.G.round()) / rangeDays) * 30) : 0;
  const sharePct =
    shareMode === "sales"
      ? num(totalSales) > 0 && baeminMonthly > 0
        ? Math.round(Math.min(100, (baeminMonthly / num(totalSales)) * 100) * 10) / 10
        : 0
      : Number(share.replace(/[^\d.]/g, "")) || 0;
  const monthlyShare = Q.of(monthlyCommon).mul(Q.pct(sharePct));

  const steps = [
    {
      key: "collect",
      title: "배민 자료 가져오기",
      done: hasData,
      body: <p className="text-sm">위의 <strong>&lsquo;자료 가져오기&rsquo;</strong>를 누르고, 열리는 크롬에서 배민에 로그인해 주세요.</p>,
    },
    {
      key: "rate",
      title: "재료비 넣기",
      done: s.cogs.ratePct !== null,
      body: (
        <div className="flex flex-col gap-3 text-sm">
          <div className="seg self-start" role="group" aria-label="재료비 넣는 방법">
            <button aria-pressed={rateMode === "menu"} onClick={() => setRateMode("menu")}>
              대표 메뉴로 넣기
            </button>
            <button aria-pressed={rateMode === "percent"} onClick={() => setRateMode("percent")}>
              %로 알고 있어요
            </button>
          </div>

          {rateMode === "menu" ? (
            <>
              <p>
                가장 많이 파는 메뉴 <strong>한 그릇</strong>의 판매가와 재료비만 넣어 주세요. 그 비율로 전체 재료비를 어림해요.
                나중에 메뉴마다 따로 넣을 수도 있어요.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs">메뉴</span>
                  {topMenus.length ? (
                    <select
                      className="input"
                      value={menuName}
                      onChange={(e) => {
                        setMenuName(e.target.value);
                        const m = topMenus.find((x) => x.name === e.target.value);
                        if (m) setPrice(String(Math.round(m.sales / m.qty)));
                      }}
                    >
                      {topMenus.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="input muted">대표 메뉴</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">평균 판매가 (옵션 포함, 원)</span>
                  <input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(onlyDigits(e.target.value))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">한 그릇 재료비 (원)</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="예: 4500"
                    value={menuCost}
                    onChange={(e) => setMenuCost(onlyDigits(e.target.value))}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-primary"
                  disabled={computedRate === null || computedRate >= 100}
                  style={{ opacity: computedRate === null || computedRate >= 100 ? 0.5 : 1 }}
                  onClick={() => {
                    if (computedRate === null || computedRate >= 100) return;
                    onChange({ cogs: { ...s.cogs, ratePct: Math.round(computedRate * 10) / 10 } });
                  }}
                >
                  넣기
                </button>
                {computedRate !== null && (
                  <span className="text-xs">
                    → 판매가의 <strong>{computedRate.toFixed(1)}%</strong>를 재료비로 계산해요
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <p>판매가의 몇 %가 재료비인지 넣어 주세요. 정확히 모르셔도 괜찮아요. 대충 넣고 나중에 고치면 됩니다.</p>
              <div className="flex items-center gap-2">
                <input
                  className="input w-24"
                  inputMode="decimal"
                  placeholder="예: 35"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <span>%</span>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const v = Number(rate);
                    if (v > 0 && v < 100) onChange({ cogs: { ...s.cogs, ratePct: v } });
                  }}
                >
                  넣기
                </button>
              </div>
            </>
          )}
        </div>
      ),
    },
    {
      key: "pack",
      title: "주문 1건당 포장비 넣기",
      done: s.packagingPerOrder !== null,
      body: (
        <div className="flex flex-col gap-2 text-sm">
          <p>용기·비닐·젓가락처럼 주문 한 건마다 나가는 돈이에요. 재료비에 이미 넣으셨다면 0을 넣으세요.</p>
          <div className="flex items-center gap-2">
            <input className="input w-28" inputMode="numeric" placeholder="예: 500" value={pack} onChange={(e) => setPack(onlyDigits(e.target.value))} />
            <span>원</span>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (pack !== "") onChange({ packagingPerOrder: Number(pack) });
              }}
            >
              넣기
            </button>
          </div>
        </div>
      ),
    },
    {
      key: "common",
      title: "인건비·월세 넣기",
      done: s.commonCosts.length > 0 || s.noCommonCosts,
      body: (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            이걸 넣어야 <strong>진짜 남는 돈</strong>이 나와요. 가게 전체에 한 달 동안 나가는 돈을 적고, 그중 배민 몫이 몇 %인지 정해 주세요.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { label: "한 달 인건비 (원)", value: labor, set: setLabor, ph: "예: 3000000" },
              { label: "월세·관리비 (원)", value: rent, set: setRent, ph: "예: 1500000" },
              { label: "전기·가스·수도 (원)", value: utility, set: setUtility, ph: "예: 500000" },
            ].map((f) => (
              <label key={f.label} className="flex flex-col gap-1">
                <span className="text-xs">{f.label}</span>
                <input className="input" inputMode="numeric" placeholder={f.ph} value={f.value} onChange={(e) => f.set(onlyDigits(e.target.value))} />
              </label>
            ))}
          </div>
          <div className="seg self-start" role="group" aria-label="배민 몫 정하는 방법">
            <button aria-pressed={shareMode === "pct"} onClick={() => setShareMode("pct")}>
              배민 몫 %를 알아요
            </button>
            <button aria-pressed={shareMode === "sales"} onClick={() => setShareMode("sales")}>
              몰라요 — 전체 매출로 계산
            </button>
          </div>
          {shareMode === "pct" ? (
            <label className="flex flex-wrap items-center gap-2">
              <span>그중 배민 몫</span>
              <input className="input w-20" inputMode="decimal" placeholder="예: 60" value={share} onChange={(e) => setShare(e.target.value.replace(/[^\d.]/g, ""))} />
              <span>%</span>
              <span className="text-xs muted">홀 없이 배민만 하시면 100. 모르겠으면 60쯤 넣고 나중에 고쳐도 돼요.</span>
            </label>
          ) : (
            <label className="flex flex-wrap items-center gap-2">
              <span>
                한 달 가게 <strong>전체</strong> 매출 (홀+모든 앱, 원)
              </span>
              <input className="input w-36" inputMode="numeric" placeholder="예: 60000000" value={totalSales} onChange={(e) => setTotalSales(onlyDigits(e.target.value))} />
              <span className="text-xs muted">
                배민 한 달 평균 {won(baeminMonthly)} ÷ 전체 매출 = {sharePct > 0 ? `배민 몫 ${sharePct}%` : "배민 몫 %"}
              </span>
            </label>
          )}
          {monthlyCommon > 0 && sharePct > 0 && (
            <p className="text-xs">
              한 달 {won(monthlyCommon)} 중 배민 몫 {pct(Q.pct(sharePct))} = <strong>{won(monthlyShare)}</strong>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={!(monthlyCommon > 0 && sharePct > 0 && range)}
              style={{ opacity: monthlyCommon > 0 && sharePct > 0 && range ? 1 : 0.5 }}
              onClick={() => {
                if (!(monthlyCommon > 0 && sharePct > 0 && range)) return;
                const id = Math.random().toString(36).slice(2, 8);
                const months = monthsBetween(range.start.slice(0, 7), range.end.slice(0, 7));
                onChange({
                  commonCosts: [
                    ...s.commonCosts,
                    ...months.map((m) => ({
                      id: `${id}-${m}`,
                      label: `인건비·월세 배민 몫 (${Number(m.slice(5))}월, 한 달 ${won(monthlyCommon)}의 ${sharePct}%)`,
                      amount: Number(monthlyShare.round()),
                      ...monthRange(m),
                    })),
                  ],
                });
              }}
            >
              넣기
            </button>
            <button className="btn" onClick={() => onChange({ noCommonCosts: true })}>
              정말 없어요 (0원) — 결과에 &lsquo;인건비·월세 0원&rsquo;으로 표시돼요
            </button>
          </div>
        </div>
      ),
    },
  ];

  const nextStep = steps.find((x) => !x.done);
  const doneCount = steps.filter((x) => x.done).length;

  if (!nextStep || hide) {
    if (!nextStep && !hide && result?.direct !== null && orders > 0) {
      return (
        <section className="card mb-4 p-4" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section">준비 끝! 주문 {orders.toLocaleString("ko-KR")}건 기준으로 계산했어요.</h2>
            <button className="tap-target text-sm underline" onClick={() => setHide(true)}>
              닫기
            </button>
          </div>
          <p className="mt-1 text-sm">
            아래에서 주문 1건당 남는 돈, 어디서 얼마가 빠지는지, 어떤 메뉴가 남는지 보세요. 숫자는 &lsquo;자세히 보기&rsquo; → &lsquo;원가와 비용&rsquo;에서 언제든 고칠 수 있어요.
          </p>
        </section>
      );
    }
    return null;
  }

  return (
    <section className="card mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section">
          처음 설정 ({doneCount}/{steps.length} 단계 끝)
        </h2>
        <button className="tap-target text-sm underline muted" onClick={() => setHide(true)}>
          나중에 하기
        </button>
      </div>

      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((st) => {
          const isNext = st.key === nextStep.key;
          return (
            <li
              key={st.key}
              className="rounded-lg p-3"
              style={{ background: isNext ? "var(--accent-soft)" : "var(--soft)", color: isNext ? "var(--accent)" : undefined }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span>{st.done ? "✓" : isNext ? "→" : "·"}</span>
                <span className={st.done ? "line-through opacity-60" : ""}>{st.title}</span>
              </div>
              {isNext && <div className="mt-2">{st.body}</div>}
            </li>
          );
        })}
      </ol>

      {result && result.cm !== null && (
        <p className="mt-3 text-xs muted">
          지금까지 넣은 기준으로 주문 1건당 수수료·재료비 뺀 돈은 {won(result.N > 0 ? result.cm.div(result.N) : Q.ZERO)}이에요. 남은 단계를
          채우면 더 정확해져요.
        </p>
      )}
    </section>
  );
}
