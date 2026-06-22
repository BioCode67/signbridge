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
  // Photoreal, clean
  { id: 'avaturn', label: '실사 앵커(여)', url: `${BASE}models/real-avaturn.glb`, real: true },
  { id: 'keito', label: '비즈니스 정장(VRM)', url: `${BASE}models/business-keito.vrm`, real: false },
  { id: 'toma', label: '비즈니스 정장2(VRM)', url: `${BASE}models/business-toma.vrm`, real: false },
  { id: 'avatarsdk', label: '실사 인물(남)', url: `${BASE}models/real-avatarsdk.glb`, real: true },
  { id: 'david', label: '실사 인물(남2)', url: `${BASE}models/real-david.glb`, real: true },
  // Clean stylized characters
  { id: 'julia', label: '캐릭터(여)', url: `${BASE}models/real-julia.glb`, real: false },
  { id: 'vroid', label: '캐릭터(여2)', url: `${BASE}models/char-vroid.glb`, real: false },
  { id: 'naoki', label: '만화풍 기자(남)', url: `${BASE}models/anchor-naoki.glb`, real: false },
]
