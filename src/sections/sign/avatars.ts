/**
 * Selectable 3D avatars.
 *
 * Realistic humans (Ready Player Me, GLB) lead — bundled locally so they load
 * fast and work offline at the live demo. The stylized VRMs (CC0 "100 Avatars")
 * remain as extra variety. Drop a custom suited/anchor avatar into
 * public/models and add it here to extend.
 */
const BASE = import.meta.env.BASE_URL

export const DEFAULT_MODEL_URL = `${BASE}models/anchor-naoki.glb`

export interface AvatarOption {
  id: string
  label: string
  url: string
  /** realistic (RPM/GLB human) vs stylized (VRM) — for a small UI hint */
  real?: boolean
}

export const AVATARS: AvatarOption[] = [
  { id: 'naoki', label: '기자(남)', url: `${BASE}models/anchor-naoki.glb`, real: true },
  { id: 'nanami', label: '앵커(여)', url: `${BASE}models/anchor-nanami.glb`, real: true },
  { id: 'person', label: '인물', url: `${BASE}models/person-rpm.glb`, real: true },
  { id: 'vroid', label: '기본(VRoid)', url: `${BASE}models/avatar.vrm` },
]
