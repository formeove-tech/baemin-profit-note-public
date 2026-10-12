"use client";

import { Q } from "@/lib/engine/rational";
import type { DateRange } from "@/lib/engine/period";
import { DEDUCTION_LABEL, type DeductionKind, type ChannelResult, type Scope, SCOPE_LABEL, headline } from "@/lib/engine/profit";
import type { MenuTotal } from "@/lib/dataset";

const num = (x: Q | null) => (x === null ? "" : String(x.round()));

/** 엑셀에서 한글이 깨지지 않도록 BOM 을 붙여 내려받는다 */
function download(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 계산 결과를 엑셀(CSV)이나 인쇄로 뽑는다.
 * 어떤 가정으로 계산했는지(원가율 추정·포장비 제외 등)를 파일 안에 함께 적는다.
 */
export function ExportPanel({
  result: r,
  menus,
  range,
  scope,
  storeName,
}: {
  result: ChannelResult;
  menus: MenuTotal[];
  range: DateRange;
  scope: Scope;
  storeName: string;
}) {
  const head = headline(r, scope);
  const stamp = `${range.start}_${range.end}`;

  function exportSummary() {
    const per = (x: Q | null) => (x === null || r.N <= 0 ? null : x.div(r.N));
    const rows: (string | number)[][] = [
      ["배달이익노트 — 손익 요약"],
      ["매장", storeName],
      ["기간", `${range.start} ~ ${range.end}`],
      ["비용 범위", SCOPE_LABEL[scope]],
      [
        "계산 가정",
        [
          r.flags.cogsEstimated ? "재료비는 원가율 추정" : "메뉴별 원가 반영",
          r.flags.packagingMissing ? "포장비 미입력(제외)" : "포장비 반영",
          r.flags.commonMissing ? "공통비 미입력" : "공통비 반영",
          "부가세·소득세 조정 전",
        ].join(" / "),
      ],
      [],
      ["항목", "기간 합계(원)", "주문당(원)"],
      ["완료 주문 수", r.N, ""],
      ["할인 전 판매액", num(r.G), num(per(r.G))],
      ["점주 부담 할인", num(r.D), num(per(r.D))],
      ["할인 뺀 매출", num(r.R), num(per(r.R))],
      ...(r.otherRevenue.isZero() ? [] : [["가게배달팁 등 매장 수입", num(r.otherRevenue), num(per(r.otherRevenue))]]),
      ...(Object.keys(r.deductionsByKind) as DeductionKind[])
        .filter((k) => !r.deductionsByKind[k].isZero())
        .map((k) => [DEDUCTION_LABEL[k], num(r.deductionsByKind[k]), num(per(r.deductionsByKind[k]))]),
      ["재료비", num(r.cogs), num(per(r.cogs))],
      ["포장비", num(r.packaging), num(per(r.packaging))],
      ["배민 공헌이익", num(r.cm), num(per(r.cm))],
      ["배민 전용 기간 비용", num(r.directFixed), num(per(r.directFixed))],
      ["광고비까지 뺀 돈", num(r.direct), num(per(r.direct))],
      ["공통비 배분", num(r.commonAllocated), num(per(r.commonAllocated))],
      ["공통비 배분 후", num(r.allocated), num(per(r.allocated))],
      [],
      ["선택한 범위 기준 남는 금액", num(head.period), num(head.perOrder)],
    ];
    download(`배달이익노트_손익_${stamp}.csv`, rows);
  }

  function exportMenus() {
    const total = Q.sum(menus.map((m) => m.sales));
    const rows: (string | number)[][] = [
      ["배달이익노트 — 메뉴별 판매", storeName, `${range.start} ~ ${range.end}`],
      [],
      ["메뉴", "수량", "판매액(원)", "판매 비중(%)", "개당 판매가(원)"],
      ...menus.map((m) => [
        m.name,
        m.qty,
        m.sales,
        total.isZero() ? "" : (Math.round((m.sales / Number(total.toNumber())) * 1000) / 10).toFixed(1),
        m.qty ? Math.round(m.sales / m.qty) : "",
      ]),
      [],
      ["옵션 포함 판매액입니다. 배달비·포장비처럼 주문 단위 비용은 메뉴에 나누지 않았습니다."],
    ];
    download(`배달이익노트_메뉴_${stamp}.csv`, rows);
  }

  return (
    <section className="card p-4 print-hide">
      <h2 className="section">보고서 내보내기</h2>
      <p className="mt-1 text-xs muted">
        지금 화면의 기간·비용 범위 그대로 뽑아요. 어떤 가정으로 계산했는지도 파일에 함께 들어갑니다.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={exportSummary}>
          손익 요약 (엑셀)
        </button>
        <button className="btn" onClick={exportMenus} disabled={!menus.length} style={{ opacity: menus.length ? 1 : 0.5 }}>
          메뉴별 판매 (엑셀)
        </button>
        <button className="btn" onClick={() => window.print()}>
          인쇄 / PDF 저장
        </button>
      </div>
    </section>
  );
}
