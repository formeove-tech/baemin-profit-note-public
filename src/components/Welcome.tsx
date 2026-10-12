"use client";

/**
 * 처음 켰을 때(아직 내 가게 자료가 없을 때) 보여 주는 안내.
 * v3: 가상 사장님 QA에서 처음 켜자마자 예시 가게의 가짜 숫자를 "우리 가게 숫자"로 오해해서,
 *     예시는 원할 때만 보게 하고 먼저 무엇을 하면 되는지 보여 준다.
 *     수기 장부를 쓰는 사장님이 "장부로는 안 보이던 것"에 설득됐던 점을 첫 문장에 둔다.
 */
export function Welcome({ onShowExample }: { onShowExample: () => void }) {
  return (
    <section className="card mb-4 p-5 md:p-6">
      <h1 className="text-xl font-extrabold leading-snug md:text-2xl">배민 주문 1건마다, 실제로 얼마가 남는지 알려 드려요</h1>
      <p className="mt-2 text-sm leading-relaxed">
        배민에 내는 <strong>수수료·배달비·광고비</strong>를 주문 1건 기준으로 쪼개서 보여 줘요. 매출 장부로는 잘 안 보이는 부분이에요.
        <br />
        예) &ldquo;배민에 내는 비용 중 배달비가 가장 커요: 주문 1건당 2,450원&rdquo;
      </p>

      <ol className="mt-4 grid gap-2 text-sm md:grid-cols-3">
        {[
          { n: 1, t: "아래 '자료 가져오기'를 누르고", d: "열리는 크롬에서 배민에 로그인해요. 5~10분 걸려요." },
          { n: 2, t: "재료비·포장비·인건비를 넣고", d: "대표 메뉴 하나의 재료비만 알아도 시작할 수 있어요." },
          { n: 3, t: "주문 1건당 남는 돈을 봐요", d: "어디서 얼마가 빠지는지, 어떤 메뉴가 남는지 보여 줘요." },
        ].map((s) => (
          <li key={s.n} className="rounded-lg p-3" style={{ background: "var(--soft)" }}>
            <div className="font-semibold">
              {s.n}. {s.t}
            </div>
            <div className="mt-1 text-xs muted">{s.d}</div>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-xs muted">
        🔒 가져온 자료는 이 컴퓨터에만 저장되고 어디로도 보내지 않아요. 배민 메뉴·가격·광고 설정은 건드리지 않고 읽기만 해요.
      </p>
      {/* v4: 밑줄 글씨는 어르신 눈에 버튼으로 안 보여서 보통 버튼으로 */}
      <button className="btn mt-3" onClick={onShowExample}>
        자료 없이 예시 화면 먼저 구경하기
      </button>
    </section>
  );
}
