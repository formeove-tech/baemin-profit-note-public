// 수집 기록(기술 로그)을 사장님이 읽을 수 있는 진행 상황으로 바꾼다.
// v3: 가상 사장님 QA에서 "data\collect… 이게 끝났다는 거예요?", "크롬 창 하나 꺼도 돼요?"가 나와서
//     단계·진행 막대·할 일 한 줄로 보여 주고, 기술 기록은 접어 둔다.

export const COLLECT_STEPS = ["주문·정산 내역", "광고·마케팅 비용", "정산명세서", "자료 정리"];

export interface CollectProgress {
  /** 지금 하는 단계 (1부터, 시작 전이면 0) */
  step: number;
  done: Set<number>;
  /** 지금 단계에서 받은 개수 / 전체 개수 */
  count: { now: number; total: number } | null;
  /** 사장님이 크롬에서 로그인해야 하는 상태 */
  waitingLogin: boolean;
  /** 받지 못한 정산명세서가 있음 */
  failedSettlements: boolean;
}

export function readProgress(lines: string[]): CollectProgress {
  let step = 0;
  const done = new Set<number>();
  let count: CollectProgress["count"] = null;
  let waitingLogin = false;
  let failedSettlements = false;
  for (const l of lines) {
    const start = l.match(/▶ \[(\d)\/(\d)\]/);
    if (start) {
      step = Number(start[1]);
      count = null;
      waitingLogin = false;
    }
    const fin = l.match(/✔ \[(\d)\/(\d)\]/);
    if (fin) done.add(Number(fin[1]));
    const orders = l.match(/([\d,]+) \/ ([\d,]+)건 수집/);
    if (orders) count = { now: Number(orders[1].replace(/,/g, "")), total: Number(orders[2].replace(/,/g, "")) };
    const settle = l.match(/(\d+)\/(\d+) · /);
    if (settle && step === 3) count = { now: Number(settle[1]), total: Number(settle[2]) };
    if (/로그인이 필요|로그인을 기다리는/.test(l)) waitingLogin = true;
    if (/로그인 확인|조회 결과 총|수집 기간|정산 조회 기간/.test(l)) waitingLogin = false;
    if (/받지 못한 정산/.test(l)) failedSettlements = true;
  }
  return { step, done, count, waitingLogin, failedSettlements };
}
