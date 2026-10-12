"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type DateRange, type PresetKey, PRESETS, addDays, checkCustomRange, koreaToday, presetRange } from "@/lib/engine/period";
import { type Scope, computeChannel, fixedFor, headline } from "@/lib/engine/profit";
import { breakeven } from "@/lib/engine/breakeven";
import { aggregate, type Business, type CostSettings } from "@/lib/dataset";
import { demoBusinesses } from "@/lib/demo";
import { businessFromStoreData, fetchSavedSettings, loadSettings, REAL_BUSINESS_ID, saveSettings, type StoreDataFile } from "@/lib/realStore";
import { CollectPanel } from "./CollectPanel";
import { ExportPanel } from "./ExportPanel";
import { Onboarding } from "./Onboarding";
import { Welcome } from "./Welcome";
import { DEMO_SITE } from "@/lib/siteMode";
import { QuickCalc, TakeShareLine, WeekCompareLine } from "./insights";
import {
  ActionLog,
  AdEfficiencyPanel,
  BreakevenPanel,
  CostPanel,
  CoverageNotice,
  HeadlineCards,
  MenuPanel,
  MonthlyPanel,
  PriceSimPanel,
  RecommendationPanel,
  SettlementPanel,
  StatRow,
  TopChecks,
  TrendPanel,
  WeekdayPanel,
  DataCheckNotice,
  Waterfall,
} from "./panels";

type PeriodMode = PresetKey | "custom";

export function Dashboard() {
  const [today] = useState(() => koreaToday());
  const [businesses, setBusinesses] = useState<Business[]>(() => demoBusinesses(today));
  // 데모 사이트는 정산·광고까지 채워진 예시 가게 C(맨 끝)에서 시작한다
  const startBiz = DEMO_SITE ? businesses[businesses.length - 1] : businesses[0];
  const [bizId, setBizId] = useState(startBiz.id);
  const [storeId, setStoreId] = useState(startBiz.stores[0].id);
  const [mode, setMode] = useState<PeriodMode>("1m");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("1m", today));
  const [scope, setScope] = useState<Scope>("direct");
  const [realNotes, setRealNotes] = useState<StoreDataFile["notes"] | null>(null);
  const [storeData, setStoreData] = useState<StoreDataFile | null>(null);
  const [realInfo, setRealInfo] = useState<{ collectedAt: string } | null>(null);
  const [checked, setChecked] = useState(false); // 내 가게 자료가 있는지 확인을 마쳤는가
  const [showCollect, setShowCollect] = useState(false); // v4: 예시를 볼 때는 '자료 가져오기'를 접어 둔다
  const [collectReq, setCollectReq] = useState<{ start: string; end: string; n: number } | null>(null); // v5: 빠진 기간 가져오기
  // v5: 처음엔 '간단히 보기'(남는 돈·빠진 돈·확인할 것). 표·실험은 '자세히 보기'에서
  const [detail, setDetail] = useState(false);
  useEffect(() => {
    try {
      setDetail(localStorage.getItem("bpn-view") === "detail");
    } catch {
      /* 저장 못 해도 동작 */
    }
  }, []);
  function toggleDetail() {
    setDetail((v) => {
      try {
        localStorage.setItem("bpn-view", v ? "simple" : "detail");
      } catch {
        /* 저장 못 해도 동작 */
      }
      return !v;
    });
  }
  function requestCollect(r: DateRange) {
    // 오늘 이후·오늘은 아직 정산 전이라 어제까지만
    const yesterday = addDays(today, -1);
    const end = r.end > yesterday ? yesterday : r.end;
    if (r.start > end) return;
    setShowCollect(true);
    setCollectReq((c) => ({ start: r.start, end, n: (c?.n ?? 0) + 1 }));
  }
  const [showExample, setShowExample] = useState(DEMO_SITE); // 자료 없이 예시 화면을 보는 중

  // 내 컴퓨터에서 수집한 실제 배민 자료가 있으면 사업자 목록 맨 앞에 넣는다 (배포 사이트에는 없음)
  const loadReal = useCallback(async (select = true) => {
    const saved = await fetchSavedSettings(); // 파일에 저장해 둔 원가·비용
    fetch("/api/store-data", { cache: "no-store" })
      .then((r) => r.json())
      .then((res: { available: boolean; data?: StoreDataFile }) => {
        if (!res.available || !res.data) return;
        const data = res.data;
        setStoreData(data);
        setBusinesses((list) => [
          businessFromStoreData(data, saved[REAL_BUSINESS_ID] ?? loadSettings(REAL_BUSINESS_ID)),
          ...list.filter((b) => b.id !== REAL_BUSINESS_ID),
        ]);
        setRealNotes(data.notes);
        setRealInfo({ collectedAt: data.collectedAt });
        if (select) {
          setBizId(REAL_BUSINESS_ID);
          setStoreId(data.store.id);
        }
      })
      .catch(() => {
        /* 실제 자료 없이 예시만 사용 */
      })
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (DEMO_SITE) {
      setChecked(true); // 데모 사이트: 내 컴퓨터 자료를 찾지 않는다
      return;
    }
    void loadReal();
  }, [loadReal]);

  const biz = businesses.find((b) => b.id === bizId)!;
  const store = biz.stores.find((s) => s.id === storeId) ?? biz.stores[0];
  // 처음 켠 사장님(아직 내 가게 자료 없음)에게는 예시 숫자 대신 안내부터 보여 준다
  const firstRun = checked && !storeData && !showExample;

  const rangeCheck = mode === "custom" ? checkCustomRange(custom.start, custom.end, today) : null;
  const range: DateRange | null =
    mode === "custom" ? (rangeCheck?.ok ? rangeCheck.range : null) : presetRange(mode, today);

  const view = useMemo(() => {
    if (!range) return null;
    const agg = aggregate(store, biz.settings, range);
    const result = computeChannel(agg.input);
    const fixed = fixedFor(result, scope);
    return {
      agg,
      result,
      fixed,
      head: headline(result, scope),
      be: breakeven(result, fixed, { businessDays: agg.businessDays }),
    };
  }, [store, biz.settings, range?.start, range?.end, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // 돈 흐름의 재료비 줄에 "판매가의 40%로 어림"처럼 넣은 값을 그대로 보여 준다
  const cogsNote =
    biz.settings.cogs.ratePct === null ? undefined : `${biz.settings.cogs.base === "gross" ? "판매가" : "할인 뺀 금액"}의 ${biz.settings.cogs.ratePct}%로 어림`;
  const commonNote = biz.settings.noCommonCosts && biz.settings.commonCosts.length === 0 ? "0원으로 두심" : undefined;
  // v7: 정산·광고 자료는 실제 자료(storeData)에서 오거나, 예시 가게 C처럼 사업자 자체에 들어 있을 수 있다
  const marketing = biz.marketingByMonth ?? (!biz.demo ? storeData?.marketingByMonth : undefined);
  const settlementsList = biz.settlements ?? (!biz.demo ? storeData?.settlements : undefined);

  function switchBusiness(id: string) {
    // 사업자를 바꾸면 매장·원가·비용 범위가 함께 바뀐다 (설정은 사업자별로 따로 보관)
    const next = businesses.find((b) => b.id === id)!;
    setBizId(id);
    setStoreId(next.stores[0].id);
  }

  /** 데모 사이트: 눌러서 바뀐 것(브라우저에 남은 기록)을 지우고 처음 상태로 */
  function resetDemo() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("bpn-actions-") || k.startsWith("bpn-settings-"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* 저장소를 못 써도 새로고침만 한다 */
    }
    window.location.reload();
  }

  function updateSettings(patch: Partial<CostSettings>) {
    setBusinesses((list) =>
      list.map((b) => {
        if (b.id !== bizId) return b;
        const settings = { ...b.settings, ...patch };
        if (!DEMO_SITE) saveSettings(b.id, settings); // 입력한 원가·비용은 이 브라우저에만 저장 (데모 사이트는 저장하지 않음)
        return { ...b, settings };
      }),
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
        <div className="text-lg font-extrabold tracking-tight">
          배달이익노트 <span className="text-xs font-normal muted">v{(process.env.NEXT_PUBLIC_APP_VERSION ?? "0").split(".")[0]}</span>
        </div>
        {firstRun || !checked ? null : (
        <>
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span className="muted shrink-0">가게</span>
          <select className="input py-1.5" value={bizId} onChange={(e) => switchBusiness(e.target.value)}>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {biz.stores.length > 1 ? (
          <select className="input w-auto py-1.5" value={store.id} onChange={(e) => setStoreId(e.target.value)}>
            {biz.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-semibold">{store.name}</span>
        )}
        <span className="chip chip-accent">배민 주문 분석</span>
        </>
        )}
      </header>

      {!checked ? (
        <p className="py-8 text-sm muted">불러오는 중…</p>
      ) : firstRun ? (
        <>
          <Welcome onShowExample={() => setShowExample(true)} />
          <div className="-mt-2 mb-4">
            <QuickCalc />
          </div>
          <CollectPanel onDone={() => void loadReal(true)} />
        </>
      ) : (
      <>
      {DEMO_SITE && (
        <div className="card mb-4 p-4 text-sm" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-base">데모입니다 · 가상 데이터</strong>
            <button className="btn tap-target" onClick={resetDemo}>
              데모 데이터 다시 채우기
            </button>
          </div>
          <p className="mt-1">로그인 없이 눌러 보세요. 숫자는 모두 처음부터 만든 가상 숫자이고, 눌러도 어디에도 저장되지 않아요.</p>
          <ol className="mt-2 list-decimal pl-5 leading-relaxed">
            <li><strong>여기부터 눌러 보세요</strong> — 맨 위 '평균 주문 ○○원 중, 1건당 배민에 내는 수수료·비용' 한 줄을 읽어 보세요.</li>
            <li>위쪽 <strong>자세히 보기</strong>를 누르고 '메뉴별 수익성'에서 남는 비율이 낮은 <strong>모둠 수육 (중)</strong>을 찾아 보세요.</li>
            <li>'가격 실험'에서 그 메뉴를 골라 값을 올려 보고, 아래 '정산 대조'의 빨간 줄(입금 전)을 확인해 보세요.</li>
          </ol>
        </div>
      )}
      {biz.demo && !DEMO_SITE ? (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 border-dashed p-3 text-sm" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          <span>
            <strong>예시 화면이에요.</strong> 실제 가게 숫자가 아니라 구경용 가상 숫자예요.
          </span>
          {!storeData && (
            <button className="btn" onClick={() => setShowExample(false)}>
              처음 화면으로
            </button>
          )}
        </div>
      ) : DEMO_SITE ? null : (
        <div className="card mb-4 flex flex-col gap-1 p-3 text-sm" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>
            <strong>배민에서 가져온 우리 가게 자료</strong>
            {realInfo && ` · 마지막으로 가져온 때 ${new Date(realInfo.collectedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`}
            {realNotes && ` · 주문 ${realNotes.settledOrders.toLocaleString("ko-KR")}건`}
            {storeData && storeData.collected.length > 0 && (
              <>
                {" "}
                · 가져온 기간 <strong>{storeData.collected[0].start} ~ {storeData.collected[storeData.collected.length - 1].end}</strong>
              </>
            )}
          </span>
          {realNotes && realNotes.unsettledOrders > 0 && (
            <span>
              최근 주문 {realNotes.unsettledOrders}건은 배민 정산이 아직 안 끝나 빼고 계산했어요
              {realNotes.unsettledDates.length ? ` (${realNotes.unsettledDates.map(([d]) => d.slice(5)).join(", ")})` : ""}. 며칠 뒤 다시
              가져오면 들어가요.
            </span>
          )}
          {realNotes && realNotes.unknownCodes.length > 0 && (
            <span>
              이 프로그램이 아직 모르는 정산 항목 {realNotes.unknownCodes.length}개가 있어 &lsquo;확인이 필요한 정산 항목&rsquo;으로 따로 두었어요:{" "}
              {realNotes.unknownCodes.map(([n]) => n).join(", ")}
            </span>
          )}
        </div>
      )}

      {DEMO_SITE ? null : biz.demo && !showCollect ? (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span>예시를 보는 중이에요. 내 가게 숫자로 보려면 배민에서 자료를 가져와야 해요.</span>
          <button className="btn" onClick={() => setShowCollect(true)}>
            내 가게 자료 가져오기
          </button>
        </div>
      ) : (
        <CollectPanel onDone={() => void loadReal(true)} request={collectReq} />
      )}

      {/* v4: 예시 가게에서도 처음 설정을 보여 줘서, 자료 없이 구경하는 사장님도 입력 순서를 미리 볼 수 있게 */}
      <Onboarding
          hasData={biz.demo || Boolean(storeData)}
          result={view?.result ?? null}
          settings={biz.settings}
          onChange={updateSettings}
          orders={view?.result.N ?? 0}
          menus={view?.agg.menus ?? []}
          range={range}
        />

      <section className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <div className="seg" role="group" aria-label="분석 기간">
            {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
              <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>
                {PRESETS[k].label}
              </button>
            ))}
            <button aria-pressed={mode === "custom"} onClick={() => setMode("custom")}>
              기간 지정
            </button>
          </div>
          {mode === "custom" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="date"
                className="input w-auto"
                max={today}
                value={custom.start}
                onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
              />
              <span>~</span>
              <input
                type="date"
                className="input w-auto"
                max={today}
                value={custom.end}
                onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
              />
            </div>
          )}
          <div className="text-sm">
            {range ? (
              <>
                <strong>
                  {range.start} ~ {range.end}
                </strong>
                <span className="muted">
                  {" "}
                  · {view?.agg.coverage.requestedDays}일
                  {rangeCheck?.ok && rangeCheck.includesToday ? " · 오늘 진행 중" : ""}
                </span>
              </>
            ) : (
              <span className="loss">{rangeCheck && !rangeCheck.ok ? rangeCheck.error : ""}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label="비용 범위">
            <button aria-pressed={scope === "direct"} onClick={() => setScope("direct")}>
              인건비·월세 빼기 전
            </button>
            <button aria-pressed={scope === "allocated"} onClick={() => setScope("allocated")}>
              인건비·월세까지 빼기
            </button>
          </div>
          <div className="seg" role="group" aria-label="보기 방식">
            <button aria-pressed={!detail} onClick={() => detail && toggleDetail()}>
              간단히 보기
            </button>
            <button aria-pressed={detail} onClick={() => !detail && toggleDetail()}>
              자세히 보기
            </button>
          </div>
        </div>
      </section>

      {view && (
        <>
          <DataCheckNotice store={store} range={range!} />
          <CoverageNotice coverage={view.agg.coverage} onFetch={biz.demo ? undefined : requestCollect} />
          <HeadlineCards result={view.result} head={view.head} scope={scope} coverage={view.agg.coverage} commonZero={biz.settings.noCommonCosts && biz.settings.commonCosts.length === 0} />
          <TakeShareLine result={view.result} />
          <WeekCompareLine store={store} settings={biz.settings} scope={scope} />
          <StatRow result={view.result} be={view.be} scope={scope} />
          <TopChecks result={view.result} coverage={view.agg.coverage} scope={scope} demo={biz.demo} commonZero={biz.settings.noCommonCosts && biz.settings.commonCosts.length === 0} />

          {!detail && (
            <>
              <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Waterfall result={view.result} cogsNote={cogsNote} commonNote={commonNote} />
                <RecommendationPanel
                  result={view.result}
                  fixed={view.fixed}
                  hasMenus={view.agg.menus.length > 0}
                  menus={view.agg.menus}
                  priceLocked={biz.settings.priceLocked ?? false}
                  onPriceLocked={(v) => updateSettings({ priceLocked: v })}
                />
              </div>
              <div className="card mt-4 flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>원가·비용 고치기, 가격 실험, 달마다 비교, 메뉴별 남는 돈, 엑셀로 내보내기는 &lsquo;자세히 보기&rsquo;에 있어요.</span>
                <button className="btn" onClick={toggleDetail}>
                  자세히 보기
                </button>
              </div>
            </>
          )}

          {detail && (
          <>
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Waterfall result={view.result} cogsNote={cogsNote} commonNote={commonNote} />
            <CostPanel
              settings={biz.settings}
              onChange={updateSettings}
              agg={view.agg}
              range={range!}
              baeminSales={view.result.G}
              key={biz.id}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PriceSimPanel result={view.result} fixed={view.fixed} scope={scope} menus={view.agg.menus} />
            <div className="flex flex-col gap-4">
              <BreakevenPanel be={view.be} result={view.result} scope={scope} businessDays={view.agg.businessDays} />
              <TrendPanel store={store} range={range!} />
              <WeekdayPanel store={store} range={range!} />
            </div>
          </div>

          <div className="mt-4">
            <MonthlyPanel store={store} settings={biz.settings} range={range!} scope={scope} />
          </div>

          {view.agg.menus.length > 0 && (
            <div className="mt-4">
              <MenuPanel menus={view.agg.menus} result={view.result} settings={biz.settings} onChange={updateSettings} />
            </div>
          )}

          {(marketing || settlementsList?.length) && (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {marketing && <AdEfficiencyPanel result={view.result} marketing={marketing} />}
              {settlementsList?.length ? <SettlementPanel settlements={settlementsList} range={range!} /> : null}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ExportPanel result={view.result} menus={view.agg.menus} range={range!} scope={scope} storeName={store.name} />
            <RecommendationPanel
                  result={view.result}
                  fixed={view.fixed}
                  hasMenus={view.agg.menus.length > 0}
                  menus={view.agg.menus}
                  priceLocked={biz.settings.priceLocked ?? false}
                  onPriceLocked={(v) => updateSettings({ priceLocked: v })}
                />
            <ActionLog businessId={biz.id} key={biz.id} />
          </div>
          </>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
