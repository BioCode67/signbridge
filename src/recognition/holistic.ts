// MediaPipe Tasks Vision — HolisticLandmarker 래퍼.
// 웹캠 <video> 프레임을 받아 표준 LandmarkFrame(포즈/양손)으로 정규화해 돌려준다.
import {
  HolisticLandmarker,
  FilesetResolver,
  type HolisticLandmarkerResult,
} from '@mediapipe/tasks-vision'
import type { Landmark, LandmarkFrame } from './landmarks'

// WASM 런타임과 .task 모델은 기본적으로 CDN에서 로드한다.
// 오프라인 시연이 필요하면 아래 경로를 로컬(public/mediapipe/…)로 바꾸고 파일을 동봉하면 된다.
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
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
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    this.landmarker = await HolisticLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
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
