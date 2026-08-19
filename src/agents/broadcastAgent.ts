// (d) 송출 제어 에이전트.
// 재난 판단 결과 → 표출 채널·우선순위·KOREN 다지점 라우팅 계획(시뮬레이션).
// 실서비스에서는 SDN/NFV 제어면과 연동해 실제 멀티캐스트 경로를 설정한다.
import type { BroadcastAgent, BroadcastPlan, DisasterAssessment, Severity } from './types'

// KOREN NIA POP 10개소(시연용 목록).
const ALL_POPS = ['서울', '대전', '대구', '부산', '광주', '수원', '춘천', '전주', '창원', '제주']

const SEVERITY_PRIORITY: Record<Severity, number> = {
  emergency: 1,
  warning: 2,
  watch: 3,
  info: 4,
}

export class SimBroadcastAgent implements BroadcastAgent {
  plan(assessment: DisasterAssessment): BroadcastPlan {
    const priority = SEVERITY_PRIORITY[assessment.severity]
    // 긴급/경보는 전국 다채널, 그 외는 축소 채널.
    const emergency = assessment.severity === 'emergency' || assessment.severity === 'warning'
    const channels = emergency
      ? ['재난방송(지상파)', '모바일 앱', '옥외 전광판', '재난문자 연계', '키오스크']
      : ['모바일 앱', '옥외 전광판']
    const pops = emergency ? ALL_POPS : ALL_POPS.slice(0, 5)
    return {
      channels,
      priority,
      pops,
      // 좌표 스트림(관절 좌표)은 영상 대비 대역폭이 매우 낮다(≈0.1Mbps).
      bandwidthMbps: 0.1,
      latencyMsTarget: emergency ? 400 : 800,
    }
  }
}
