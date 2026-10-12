"use client";

import { useState } from "react";

/**
 * 어려운 말 옆에 붙이는 물음표. 누르면 바로 아래에 쉬운 설명이 펼쳐진다.
 * (마우스를 올려야 보이는 방식은 휴대폰·어르신께 잘 안 보여서 누르는 방식으로 한다)
 */
export function Help({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="설명 보기"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold align-middle"
        style={{ background: "var(--soft)", color: "var(--muted)", border: "1px solid var(--line)" }}
      >
        ?
      </button>
      {open && (
        <span
          className="mt-1 block w-full basis-full rounded-lg p-2 text-sm font-normal leading-relaxed"
          style={{ background: "var(--soft)", color: "var(--ink)" }}
        >
          {children}
        </span>
      )}
    </>
  );
}
