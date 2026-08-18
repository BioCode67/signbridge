// MediaPipe Tasks Vision — HolisticLandmarker 래퍼.
// 웹캠 <video> 프레임을 받아 표준 LandmarkFrame(포즈/양손)으로 정규화해 돌려준다.
import {
  HolisticLandmarker,
  FilesetResolver,
  type HolisticLandmarkerResult,
} from '@mediapipe/tasks-vision'
import type { Landmark, LandmarkFrame } from './landmarks'

// **WASM 런타임과 .task 모델을 직접 동봉한다.**
//
// 예전에는 jsdelivr CDN과 Google 저장소에서 받아 왔다. 그러면 이렇게 된다:
//   · **인터넷이 없으면 수어 인식이 아예 안 된다.** 재난 때가 곧 오프라인인데,
//     정작 "대피소 어디?"를 물어야 하는 순간에 카메라가 켜지지 않는다.
//   · 카메라를 켤 때마다 외부 두 곳에 요청이 나간다(기관 방화벽·기내·지하).
//   · COOP/COEP를 켤 수 없다 — 켜면 CDN 로드가 막힌다. 그래서 ORT 스레드도 못 쓴다.
//
// 32MB가 늘지만 **없으면 기능 자체가 없는 것**이라 동봉이 맞다.
// CDN은 폴백으로만 남긴다(동봉 파일이 빠진 채 배포된 경우를 위해).
const BASE = import.meta.env.BASE_URL
const LOCAL_ROOT = new URL(`${BASE}mediapipe`, document.baseURI).href
const LOCAL_MODEL = new URL(`${BASE}mediapipe/holistic_landmarker.task`, document.baseURI).href
const CDN_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task'

function toLandmarks(arr: { x: number; y: number; z: number; visibility?: number }[] | undefined): Landmark[] {
  if (!arr) return []
  return arr.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }))
}

// HolisticLandmarkerResult의 필드는 배열(다중 검출)로 오므로 첫 결과만 취한다.
function first<T>(v: T[] | undefined): T | undefined {
  return v && v.length > 0 ? v[0] : undefined
}

export class HolisticEngine {
  private landmarker: HolisticLandmarker | null = null
  private lastTs = -1

  async init(delegate: 'GPU' | 'CPU' = 'GPU'): Promise<void> {
    try {
      await this.load(LOCAL_ROOT, LOCAL_MODEL, delegate)
    } catch (e) {
      // 동봉 파일이 없는 배포본에서도 인터넷만 있으면 되게 한다.
      console.warn('[holistic] 동봉 모델 로드 실패 — CDN으로 되돌립니다', e)
      await this.load(CDN_ROOT, CDN_MODEL, delegate)
    }
  }

  private async load(wasmRoot: string, modelUrl: string, delegate: 'GPU' | 'CPU'): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(wasmRoot)
    this.landmarker = await HolisticLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
    })
  }

  get ready(): boolean {
    return this.landmarker !== null
  }

  /** 비디오 한 프레임을 추론. 같은 타임스탬프 중복 호출은 무시(MediaPipe 제약). */
  detect(video: HTMLVideoElement, tsMs: number): LandmarkFrame | null {
    if (!this.landmarker) return null
    if (tsMs <= this.lastTs) return null
    this.lastTs = tsMs
    let res: HolisticLandmarkerResult
    try {
      res = this.landmarker.detectForVideo(video, tsMs)
    } catch {
      return null
    }
    return {
      pose: toLandmarks(first(res.poseLandmarks)),
      leftHand: toLandmarks(first(res.leftHandLandmarks)),
      rightHand: toLandmarks(first(res.rightHandLandmarks)),
    }
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}
