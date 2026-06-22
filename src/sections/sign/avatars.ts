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

export interface AvatarOption {
  id: string
  label: string
  url: string
  /** realistic human (vs stylized character) — small UI hint */
  real?: boolean
}

export const AVATARS: AvatarOption[] = [
  { id: 'avaturn', label: '실사 앵커(여)', url: `${BASE}models/real-avaturn.glb`, real: true },
  { id: 'avatarsdk', label: '실사 인물(남)', url: `${BASE}models/real-avatarsdk.glb`, real: true },
  { id: 'jiwoo', label: '실사 인물(남2)', url: `${BASE}models/real-jiwoo.glb`, real: true },
  { id: 'emma', label: '실사 캐주얼(여)', url: `${BASE}models/real-emma.glb`, real: true },
  { id: 'david', label: '데이비드', url: `${BASE}models/real-david.glb`, real: true },
  { id: 'julia', label: '줄리아', url: `${BASE}models/real-julia.glb`, real: true },
  { id: 'naoki', label: '정장 기자(남)', url: `${BASE}models/anchor-naoki.glb`, real: true },
  { id: 'yuna', label: '캐릭터 안내원(여)', url: `${BASE}models/real-yuna.glb`, real: false },
]
