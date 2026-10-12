/**
 * 데모 사이트 모드 (빌드할 때 NEXT_PUBLIC_DEMO_SITE=1 로 켠다).
 * 켜지면: 로그인·가져오기 없이 가상 예시 가게(C)가 바로 열리고, 내 컴퓨터 파일(실제 자료·설정)은 읽지도 쓰지도 않는다.
 */
export const DEMO_SITE = process.env.NEXT_PUBLIC_DEMO_SITE === "1";
