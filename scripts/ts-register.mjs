// 위 해석 훅을 등록한다 — `node --import ./scripts/ts-register.mjs` 로 쓴다.
import { register } from 'node:module'
register('./ts-resolve-hooks.mjs', import.meta.url)
