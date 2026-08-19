// 확장자 없는 상대 임포트를 .ts로 이어 준다.
//
// 브라우저 코드는 번들러가 확장자를 채워 주지만, Node ESM은 채우지 않는다.
// 앱의 TS를 **고쳐 쓰지 않고 그대로** 돌리기 위한 해석 훅이다(감사 수치가
// 실제 앱과 같아야 하므로 코드를 손대지 않는 것이 중요하다).
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = dirname(fileURLToPath(context.parentURL))
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const cand = resolvePath(base, specifier + ext)
      if (existsSync(cand)) return next(pathToFileURL(cand).href, context)
    }
  }
  return next(specifier, context)
}
