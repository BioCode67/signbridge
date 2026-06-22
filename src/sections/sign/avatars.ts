/**
 * Selectable 3D avatars.
 *
 * Two tiers:
 *  1) BUNDLED (local `public/models/*.glb`) — verified to render + sign cleanly,
 *     load instantly, and work offline at the live demo. The default is here.
 *  2) RPM (remote Ready Player Me CDN) — extra variety to curate. Every RPM
 *     avatar shares the exact Mixamo-compatible skeleton our retargeter drives,
 *     so hand/sign articulation is identical to the bundled ones; only the look
 *     differs. They stream in the browser (need network) — preview, keep the
 *     ones you like, and we bundle those locally for the final build.
 */
const BASE = import.meta.env.BASE_URL

// RPM CDN model, with ARKit blendshapes (eye-blink) + a sane texture budget.
const rpm = (id: string) =>
  `https://models.readyplayer.me/${id}.glb?morphTargets=ARKit&textureAtlas=1024&lod=0`

export const DEFAULT_MODEL_URL = `${BASE}models/real-avaturn.glb`

export interface AvatarOption {
  id: string
  label: string
  url: string
  /** realistic human (vs stylized character) — small UI hint */
  real?: boolean
  /** streamed from a remote CDN (needs network) vs bundled locally */
  remote?: boolean
}

export const AVATARS: AvatarOption[] = [
  // --- Bundled · verified (render + sign tested) ---
  { id: 'avaturn', label: '실사 앵커(여)', url: `${BASE}models/real-avaturn.glb`, real: true },
  { id: 'avatarsdk', label: '실사 인물(남)', url: `${BASE}models/real-avatarsdk.glb`, real: true },
  { id: 'jiwoo', label: '실사 인물(남2)', url: `${BASE}models/real-jiwoo.glb`, real: true },
  { id: 'emma', label: '실사 캐주얼(여)', url: `${BASE}models/real-emma.glb`, real: true },
  { id: 'david', label: '데이비드', url: `${BASE}models/real-david.glb`, real: true },
  { id: 'julia', label: '줄리아', url: `${BASE}models/real-julia.glb`, real: true },
  { id: 'naoki', label: '정장 기자(남)', url: `${BASE}models/anchor-naoki.glb`, real: true },
  { id: 'yuna', label: '캐릭터 안내원(여)', url: `${BASE}models/real-yuna.glb`, real: false },

  // --- Ready Player Me · 미리보기 후보 (브라우저 스트리밍, 손동작 동일) ---
  { id: 'rpm1', label: 'RPM 후보 1', url: rpm('64bfa15f0e72c63d7c3934a6'), real: true, remote: true },
  { id: 'rpm2', label: 'RPM 후보 2', url: rpm('629865e71e270d2d0b103ca1'), real: true, remote: true },
  { id: 'rpm3', label: 'RPM 후보 3', url: rpm('631d5da63a656b9c32056699'), real: true, remote: true },
  { id: 'rpm4', label: 'RPM 후보 4', url: rpm('6361baf427dd6d429df5b5db'), real: true, remote: true },
  { id: 'rpm5', label: 'RPM 후보 5', url: rpm('6394c1e69ef842b3a5112221'), real: true, remote: true },
  { id: 'rpm6', label: 'RPM 후보 6', url: rpm('63bc912fcf5517c87ab46d1d'), real: true, remote: true },
  { id: 'rpm7', label: 'RPM 후보 7', url: rpm('63f69e1d9233b3995d6dede9'), real: true, remote: true },
  { id: 'rpm8', label: 'RPM 후보 8', url: rpm('640594355167081fc2ed91be'), real: true, remote: true },
  { id: 'rpm9', label: 'RPM 후보 9', url: rpm('64493df7e1abd0ad48965cbf'), real: true, remote: true },
  { id: 'rpm10', label: 'RPM 후보 10', url: rpm('64a7e287682160d141fa1c65'), real: true, remote: true },
]
