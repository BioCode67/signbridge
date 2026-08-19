/**
 * Selectable 3D avatars — all bundled locally (`public/models/*.glb`), verified
 * to render + sign cleanly, load fast, and work offline at the live demo.
 * Every avatar is a Mixamo-compatible humanoid with full finger bones and ARKit
 * blendshapes, so the keypoint→bone retargeting drives them identically.
 *
 * To add a new avatar: drop a rigged `.glb` (RPM/Avaturn/Mixamo) into
 * public/models and add an entry here.
 */
const BASE = import.meta.env.BASE_URL

export const DEFAULT_MODEL_URL = `${BASE}models/real-avaturn.glb`

/** 당사자 화면(받기·묻기·대화)이 쓰는 아바타.
 *
 *  소개 페이지는 고를 수 있게 두지만 **앱은 하나로 고정한다** — 사용자가 매번
 *  고르게 할 자리가 아니고, 아바타가 화면마다 다르면 같은 앱을 다시 배우게 된다.
 *  예전에는 `AVATARS[0]`으로 박혀 있어서 목록 순서를 바꾸면 앱 아바타가
 *  같이 바뀌었다 — 이름으로 가리켜 그 연결을 끊는다. */
export const APP_MODEL_URL = `${BASE}models/real-david.glb`

export interface AvatarOption {
  id: string
  label: string
  url: string
  /** realistic human (vs stylized character) — small UI hint */
  real?: boolean
}

export const AVATARS: AvatarOption[] = [
  // Photoreal, clean
  { id: 'avaturn', label: '실사 앵커(여)', url: `${BASE}models/real-avaturn.glb`, real: true },
  { id: 'avatarsdk', label: '실사 인물(남)', url: `${BASE}models/real-avatarsdk.glb`, real: true },
  { id: 'david', label: '실사 인물(남2)', url: `${BASE}models/real-david.glb`, real: true },
  // Clean stylized characters
  { id: 'julia', label: '캐릭터(여)', url: `${BASE}models/real-julia.glb`, real: false },
  { id: 'vroid', label: '캐릭터(여2)', url: `${BASE}models/char-vroid.glb`, real: false },
  { id: 'naoki', label: '만화풍 기자(남)', url: `${BASE}models/anchor-naoki.glb`, real: false },
]
