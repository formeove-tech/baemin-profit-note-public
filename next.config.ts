import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // 화면 오른쪽 위에 v4처럼 보여 주기 위해 package.json 버전을 넘긴다
  env: { NEXT_PUBLIC_APP_VERSION: version },
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 다른 사장님 PC에 넣을 꾸러미를 만들기 위해 혼자 도는 형태로 빌드한다
  output: "standalone",
  outputFileTracingIncludes: { "/api/**": ["./scripts/**"] },
  // data 폴더(실제 매출·배민 로그인 프로필)는 꾸러미를 만들 때 scripts/package-app.mjs 가 걸러낸다.
  // 여기서 outputFileTracingExcludes 로 막으면 Next 내부 파일까지 빠져 앱이 켜지지 않는다.
};

export default nextConfig;
