// 아바타 계측 — 자동 검사(`scripts/measure_avatar.py`)만 쓴다. 화면 동작에는 관여하지 않는다.
//
// **왜 화면 재생이 아니라 시뮬레이션으로 재나.** 화면 재생은 기기 속도에 따라 프레임을
// 건너뛴다(소프트웨어 렌더링 환경은 초당 4틱). 그 상태로 떨림을 재면 "기기가 느려서
// 생긴 떨림"과 "계산이 만든 떨림"이 섞인다. 그래서 같은 문장을 **프레임 하나씩 같은 간격으로**
// 화면 루프와 똑같은 함수(`stepGLB`)에 넣어 보고 뼈 회전·손 위치를 기록한다.
//
// 재는 것:
//   jitter  — 떨림. 프레임 f의 회전이 f-1과 f+1의 한가운데에서 얼마나 벗어났나(도).
//             부드러운 동작이면 0에 가깝고, 움찔거리면 커진다.
//   lag     — 지연. 평활을 끈 자세(그 프레임의 목표)와 실제 자세의 각도 차(도).
//             떨림만 줄이고 지연을 키우면 수어가 뭉개진다 — 둘을 함께 본다.
//   fpsGap  — 화면 주사율 의존. 30Hz로 갱신했을 때와 60Hz로 갱신했을 때 자세 차(도).
//             0이어야 폰(60·120Hz)과 느린 기기에서 같은 수어가 나온다.
//   handsIn — 손(손목·손가락 끝)이 전부 화면 안에 있는 프레임 비율.
import * as THREE from 'three'
import type { SignData } from './signTypes'
import { tuning } from './glbRetarget'

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']
const ARM_BONES = ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand']
const FINGER_BONES = ['Left', 'Right'].flatMap((s) =>
  FINGERS.flatMap((f) => [1, 2, 3].map((k) => `${s}Hand${f}${k}`)),
)

export interface ProbeCtx {
  scene: THREE.Object3D
  camera: THREE.Camera
  size: { width: number; height: number }
  getData: () => SignData | undefined
  step: (data: SignData, frame: number, t: number, dt: number) => void
  /** 화면 루프가 프레임 사이를 보간하는가(소수 프레임을 넘기는가). 계측도 화면과 똑같이 넘긴다. */
  fractional?: boolean
}

const clean = (n: string) => n.replace(/^mixamorig\d*:?/i, '')

function angle(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const d = Math.min(1, Math.abs(a.dot(b)))
  return 2 * Math.acos(d)
}

export function attachProbe(ctx: ProbeCtx) {
  const byName = new Map<string, THREE.Object3D>()
  ctx.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone || o.type === 'Bone') byName.set(clean(o.name), o)
  })
  const arms = ARM_BONES.map((n) => byName.get(n)).filter(Boolean) as THREE.Object3D[]
  const fingers = FINGER_BONES.map((n) => byName.get(n)).filter(Boolean) as THREE.Object3D[]

  /** 손가락 끝 — 이 리그에는 끝마디 뒤 뼈(…4)가 없어서, 3마디 관절에서
   *  2→3 마디 방향으로 한 마디만큼 더 나간 점을 끝으로 본다. */
  const tipPairs: [THREE.Object3D, THREE.Object3D][] = []
  for (const s of ['Left', 'Right']) {
    for (const f of FINGERS) {
      const b2 = byName.get(`${s}Hand${f}2`)
      const b3 = byName.get(`${s}Hand${f}3`)
      if (b2 && b3) tipPairs.push([b2, b3])
    }
  }
  const wrists = ['LeftHand', 'RightHand'].map((n) => byName.get(n)).filter(Boolean) as THREE.Object3D[]

  const _a = new THREE.Vector3()
  const _b = new THREE.Vector3()
  /** 프레임마다 왼손·오른손의 가장 낮은 점(월드 y, m) — 자막 띠에 가려지는지 높이로 본다. */
  let lowY: [number, number][] = []

  /** 손 점들을 화면 좌표(NDC, -1~1)로. */
  function handNdc(): number[] {
    ctx.scene.updateMatrixWorld(true)
    ctx.camera.updateMatrixWorld()
    const out: number[] = []
    let lowL = Infinity, lowR = Infinity
    wrists.forEach((w, i) => {
      w.getWorldPosition(_a)
      if (i === 0) lowL = Math.min(lowL, _a.y); else lowR = Math.min(lowR, _a.y)
      _a.project(ctx.camera)
      out.push(_a.x, _a.y)
    })
    tipPairs.forEach(([b2, b3], i) => {
      b2.getWorldPosition(_a)
      b3.getWorldPosition(_b)
      _b.add(_b.clone().sub(_a))
      if (i < 5) lowL = Math.min(lowL, _b.y); else lowR = Math.min(lowR, _b.y)
      _b.project(ctx.camera)
      out.push(_b.x, _b.y)
    })
    lowY.push([lowL, lowR])
    return out
  }

  function run(rate: number, raw = false) {
    const data = ctx.getData()
    if (!data) return null
    const sub = Math.max(1, Math.round(rate / data.fps))
    const dt = 1 / rate
    // 기준 자세(raw)는 **데이터 그대로** — slerp도 앞뒤 평활도 끈다. 평활이 동작을 얼마나
    // 늦추고 뭉개는지를 함께 잰다. (예전 코드는 3탭 평활을 끌 수 없어 기준에 그것이 남는다 —
    // 예전 쪽에 유리한 비교다.)
    const saved = { ...tuning }
    tuning.raw = raw
    if (raw) Object.assign(tuning, { sigmaArm: 0, sigmaHand: 0, sigmaZ: 0 })
    const armQ: THREE.Quaternion[][] = []
    const finQ: THREE.Quaternion[][] = []
    // 갱신할 때마다의 기록 — 60Hz 떨림은 프레임 사이 갱신까지 봐야 계단(30Hz로 툭툭)이 드러난다.
    const armAll: THREE.Quaternion[][] = []
    const finAll: THREE.Quaternion[][] = []
    const ndc: number[][] = []
    // 첫 자세로 수렴시킨 뒤 기록한다 — 앞 문장의 자세가 남아 있으면 비교가 흐려진다.
    lowY = []
    let t = 0
    for (let i = 0; i < 60; i++) { ctx.step(data, 0, t, dt); t += dt }
    for (let f = 0; f < data.num_frames; f++) {
      for (let s = 0; s < sub; s++) {
        const ff = ctx.fractional ? Math.min(data.num_frames - 1, f + s / sub) : f
        ctx.step(data, ff, t, dt)
        t += dt
        armAll.push(arms.map((b) => b.quaternion.clone()))
        finAll.push(fingers.map((b) => b.quaternion.clone()))
        if (s === 0) {
          armQ.push(armAll[armAll.length - 1])
          finQ.push(finAll[finAll.length - 1])
          ndc.push(handNdc())
        }
      }
    }
    Object.assign(tuning, saved)
    return { armQ, finQ, armAll, finAll, ndc, lowY: lowY.slice() }
  }

  function jitter(seq: THREE.Quaternion[][]): number {
    const mid = new THREE.Quaternion()
    let sum = 0, n = 0
    for (let f = 1; f + 1 < seq.length; f++) {
      for (let j = 0; j < seq[f].length; j++) {
        mid.copy(seq[f - 1][j]).slerp(seq[f + 1][j], 0.5)
        sum += angle(seq[f][j], mid)
        n++
      }
    }
    return n ? (sum / n) * (180 / Math.PI) : 0
  }

  function gap(a: THREE.Quaternion[][], b: THREE.Quaternion[][]): number {
    let sum = 0, n = 0
    for (let f = 0; f < Math.min(a.length, b.length); f++) {
      for (let j = 0; j < a[f].length; j++) { sum += angle(a[f][j], b[f][j]); n++ }
    }
    return n ? (sum / n) * (180 / Math.PI) : 0
  }

  /** 지연(ms) — 실제 자세를 기준 자세(평활 없음)와 견줄 때, 기준을 몇 프레임 늦춰야
   *  가장 가까워지는지(각도 차가 최소가 되는 이동량)를 0.25프레임 단위로 찾는다.
   *  뒤따라가는 평활(slerp)은 늦게 따라가므로 이 값이 커지고, 앞뒤 대칭 평활은 0에 머문다.
   *  그래서 예전 기준(3탭 대칭 평활 포함)과 지금 기준(평활 없음)이 이 값에서는 같은 자리에 선다. */
  function delayMs(a: THREE.Quaternion[][], ref: THREE.Quaternion[][], fps: number): number {
    const q = new THREE.Quaternion()
    let best = 0, bestErr = Infinity
    for (let sh = 0; sh <= 4.0001; sh += 0.25) {
      let sum = 0, n = 0
      for (let f = 6; f < a.length; f++) {
        const t = f - sh
        const i = Math.floor(t), u = t - i
        for (let j = 0; j < a[f].length; j++) {
          q.copy(ref[i][j]).slerp(ref[Math.min(ref.length - 1, i + 1)][j], u)
          sum += angle(a[f][j], q)
          n++
        }
      }
      const e = sum / Math.max(1, n)
      if (e < bestErr) { bestErr = e; best = sh }
    }
    return (best * 1000) / fps
  }

  function handsIn(ndc: number[][], bottomNdc = -1): { inside: number; clear: number; minMarginPx: number } {
    let inside = 0, clear = 0
    let minM = Infinity
    for (const row of ndc) {
      let ok = true, okClear = true
      for (let i = 0; i < row.length; i += 2) {
        const x = row[i], y = row[i + 1]
        const mx = (1 - Math.abs(x)) * ctx.size.width / 2
        const my = (1 - Math.abs(y)) * ctx.size.height / 2
        minM = Math.min(minM, mx, my)
        if (Math.abs(x) > 1 || Math.abs(y) > 1) ok = false
        if (y < bottomNdc) okClear = false
      }
      if (ok) inside++
      if (ok && okClear) clear++
    }
    return { inside: inside / ndc.length, clear: clear / ndc.length, minMarginPx: minM }
  }

  function perHand(ndc: number[][], bottomNdc: number) {
    let l = 0, r = 0
    for (const row of ndc) {
      const pts = (idx: number[]) => idx.every((i) => {
        const x = row[i * 2], y = row[i * 2 + 1]
        return Math.abs(x) <= 1 && Math.abs(y) <= 1 && y >= bottomNdc
      })
      if (pts([0, 2, 3, 4, 5, 6])) l++
      if (pts([1, 7, 8, 9, 10, 11])) r++
    }
    return { clearLeft: l / ndc.length, clearRight: r / ndc.length }
  }

  function pct(rows: [number, number][]) {
    const q = (arr: number[], p: number) => {
      const s = arr.slice().sort((a, b) => a - b)
      return s[Math.min(s.length - 1, Math.floor(p * s.length))]
    }
    const L = rows.map((r) => r[0]), R = rows.map((r) => r[1])
    return { left: [q(L, 0.05), q(L, 0.25), q(L, 0.5)], right: [q(R, 0.05), q(R, 0.25), q(R, 0.5)] }
  }

  return {
    /** 평활 값을 바꿔 가며 떨림·오차를 잰다 — 기본값을 고르는 데 썼다. */
    sweep(configs: Record<string, number>[]) {
      const saved = { ...tuning }
      const r30 = run(30, true)
      const out = configs.map((cfg) => {
        Object.assign(tuning, cfg)
        const a = run(30)
        Object.assign(tuning, saved)
        if (!a || !r30) return null
        return { ...cfg, jArm: jitter(a.armQ), jFin: jitter(a.finQ), eArm: gap(a.armQ, r30.armQ), eFin: gap(a.finQ, r30.finQ),
          dArm: delayMs(a.armQ, r30.armQ, 30), dFin: delayMs(a.finQ, r30.finQ, 30) }
      })
      return out
    },
    /** 한 번에 전부 잰다. `overlayPx`는 화면 아래 자막 띠의 높이 — 손이 그 밑에 숨으면 안 보인다. */
    measure(overlayPx = 0) {
      const a30 = run(30)
      const a60 = run(60)
      const r30 = run(30, true)
      if (!a30 || !a60 || !r30) return null
      const bottomNdc = -1 + (2 * overlayPx) / Math.max(1, ctx.size.height)
      const h = handsIn(a30.ndc, bottomNdc)
      const h60 = handsIn(a60.ndc, bottomNdc)
      return {
        frames: a30.armQ.length,
        canvas: [ctx.size.width, ctx.size.height],
        jitterArmDeg: jitter(a30.armQ),
        jitterFingerDeg: jitter(a30.finQ),
        // 60Hz 떨림은 갱신 간격이 절반이라 값도 대략 절반 크기로 나온다 — 30Hz 값과 직접 견주지 말 것.
        jitterArmDeg60: jitter(a60.armAll),
        jitterFingerDeg60: jitter(a60.finAll),
        delayArmMs: delayMs(a30.armQ, r30.armQ, 30),
        delayFingerMs: delayMs(a30.finQ, r30.finQ, 30),
        lagArmDeg: gap(a30.armQ, r30.armQ),
        lagFingerDeg: gap(a30.finQ, r30.finQ),
        fpsGapArmDeg: gap(a30.armQ, a60.armQ),
        fpsGapFingerDeg: gap(a30.finQ, a60.finQ),
        handsIn: h.inside,
        handsClear: h.clear,
        handsIn60: h60.inside,
        minMarginPx: h.minMarginPx,
        // 손별로 자막 띠 위에 온전히 보이는 비율 — 쉬는 손(비우세손)이 내려가 가려지는 것과
        // 수어하는 손이 가려지는 것은 무게가 다르다. 계산은 ndc 순서(왼손목·오른손목·왼끝5·오른끝5).
        ...perHand(a30.ndc, bottomNdc),
        lowY: pct(a30.lowY),
      }
    },
  }
}
