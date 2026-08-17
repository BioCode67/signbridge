/**
 * AI 백엔드(FastAPI) 주소 한 곳에서 관리.
 *
 * 배포본은 빌드 시 `VITE_API_URL`로 넣는다(예: Render 주소).
 *   VITE_API_URL=https://signbridge-api.onrender.com npm run build
 * 값이 없으면 로컬 개발 서버로 떨어진다 — 즉 아무 설정 없이 로컬에서 그냥 돌아간다.
 *
 * 이 주소가 죽어 있어도 사이트는 정상 동작해야 한다(수록 문장 재생·아바타·인식은
 * 전부 브라우저 안에서 돌아간다). 각 호출부가 실패 시 폴백하도록 되어 있다.
 */
export const API_URL: string = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

/** 배포본에서 외부 API를 쓰도록 설정됐는지 — UI 안내 문구 분기에 쓴다. */
export const API_IS_REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(API_URL)
