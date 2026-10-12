// 노트북에서 수집한 실제 배민 자료를 앱의 사업자 하나로 만들어 준다.
import type { Business, CostSettings, DailyRow } from "./dataset";
import type { DatedCost, DateRange } from "./engine/period";

export interface StoreDataFile {
  store: { id: string; name: string };
  collectedAt: string;
  requested: DateRange;
  collected: DateRange[];
  rows: DailyRow[];
  /** 가게통계에서 가져온 월별 광고·배민클럽 비용 (주문별 자료와 겹치지 않는 것만) */
  autoDirectCosts?: DatedCost[];
  /** 정산 건별 입금액과 광고비 (정산명세서) */
  settlements?: {
    giveId: number;
    depositDueDate: string;
    status: string;
    settlePeriod: DateRange;
    depositAmount: number;
    adCost: number;
    adjustment: number;
  }[];
  adjustments?: { depositDueDate: string; amount: number; details: { code?: string; text?: string; amount?: number }[] }[];
  marketingByMonth?: Record<string, { orderCount: number; orderAmount: number; groups: Record<string, { cost: number | null; orderCount: number; orderAmount: number }> }>;
  notes: {
    alreadyInOrders?: string[];
    settledOrders: number;
    unsettledOrders: number;
    unsettledDates: [string, number][];
    meetOrders: number;
    unknownCodes: [string, number][];
    vatCountedAsCost: boolean;
  };
}

export const REAL_BUSINESS_ID = "real";

const defaultSettings = (): CostSettings => ({
  cogs: { ratePct: null, base: "gross", includesPackaging: false },
  packagingPerOrder: null,
  directCosts: [],
  commonCosts: [],
  noDirectCosts: false,
  noCommonCosts: false,
  closedDays: 0,
});

/**
 * 수집 파일 → 사업자. 재료원가·포장비·공통비는 사장님이 직접 넣어야 하므로 비워 두고,
 * 자동으로 확인된 광고비는 배민 전용 비용에 넣어 둔다 (id 가 auto- 로 시작).
 */
export function businessFromStoreData(data: StoreDataFile, saved?: CostSettings | null): Business {
  const base = saved ?? defaultSettings();
  const auto = data.autoDirectCosts ?? [];
  const mine = base.directCosts.filter((c) => !c.id.startsWith("auto-")); // 사장님이 직접 넣은 것은 유지
  return {
    id: REAL_BUSINESS_ID,
    name: data.store.name,
    demo: false,
    stores: [{ id: data.store.id, name: data.store.name, collected: data.collected, rows: data.rows }],
    settings: { ...base, directCosts: [...auto, ...mine], noDirectCosts: auto.length > 0 ? false : base.noDirectCosts },
  };
}

const key = (id: string) => `bpn-settings-${id}`;

export function loadSettings(id: string): CostSettings | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as CostSettings) : null;
  } catch {
    return null;
  }
}

export function saveSettings(id: string, settings: CostSettings): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(settings));
  } catch {
    /* 저장할 수 없는 환경에서는 화면에만 유지 */
  }
  // 내 컴퓨터 파일에도 저장한다 (브라우저를 바꿔도 남게)
  void fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, settings }),
  }).catch(() => {});
}

/** 파일에 저장된 설정 (앱을 켤 때 한 번 읽는다) */
export async function fetchSavedSettings(): Promise<Record<string, CostSettings>> {
  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const body = (await res.json()) as { settings?: Record<string, CostSettings> };
    return body.settings ?? {};
  } catch {
    return {};
  }
}
