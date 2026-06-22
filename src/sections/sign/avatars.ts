/**
 * Selectable 3D avatars.
 *
 * `default` is the bundled VRoid VRM. The rest are CC0 (public-domain) VRMs
 * from Polygonal Mind's "100 Avatars" set, loaded on demand from a CDN so they
 * don't bloat the repo. Drop a custom `.vrm` into public/models and add it here
 * (e.g. a photorealistic suited anchor exported from VRoid Studio / RPM).
 */
export const DEFAULT_MODEL_URL = `${import.meta.env.BASE_URL}models/avatar.vrm`

export interface AvatarOption {
  id: string
  label: string
  url: string
}

export const AVATARS: AvatarOption[] = [
  { id: 'default', label: '기본', url: DEFAULT_MODEL_URL },
  { id: 'anchor', label: '앵커', url: 'https://arweave.net/GhML2d0T_lBZvRA_S28LWVg9wFCWJWqc0cFsVulQQlo' },
  { id: 'reporter', label: '기자', url: 'https://arweave.net/EgFSDc6Kbh0lrNWARVqwg7PxqrxfK1wluuxzLWFsNLM' },
  { id: 'suit', label: '정장', url: 'https://arweave.net/MRYB-qSnrV11_Sa6BwMOqTEpH7n_bczN_pNY_1q7DOs' },
  { id: 'mister', label: '신사', url: 'https://arweave.net/elvlpN6jefoDXqqCWMxCBVZnl6Z2lLD7-wC8N5z1bVk' },
  { id: 'robert', label: '로버트', url: 'https://arweave.net/gwG7w4bY-A5c3R6A6GOz3xBCgbPvkFQmqPIDtvnNsYI' },
  { id: 'olivia', label: '올리비아', url: 'https://arweave.net/MgsNlTetzAoVEC6E-lswj65vp7StkOZXXd5OjjqzYZI' },
  { id: 'kate', label: '케이트', url: 'https://arweave.net/1q4IQwLQXJVS0JGSpeXlRdazmZYdwJbmLbTv7o0s5Y8' },
  { id: 'david', label: '데이비드', url: 'https://arweave.net/H3cBhsOEoiQ8XZiwG31SyCUtiDewBZRccxIDztyHfSY' },
  { id: 'hugo', label: '휴고', url: 'https://arweave.net/iYaEdMdq8faogyRdgF4plnZIq40oOERENie94XmEdvQ' },
  { id: 'agnes', label: '아그네스', url: 'https://arweave.net/c8mrbRq29sfQdovW1l_D2JYGOaCNF3JxTaUsmHTSNAg' },
]
