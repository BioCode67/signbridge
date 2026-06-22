import { motion } from 'framer-motion'

/**
 * System architecture diagram (responsive SVG): disaster text + Deaf question
 * (GPS) → KOREN HPC 4-agent cluster → KOREN low-latency transport (joint
 * coordinates, ~0.1Mbps) → terminal 3D avatar, with the bidirectional Q&A loop
 * returning from the terminal back to the agents. Built to make the Agentic AI
 * + KOREN structure legible at a glance for reviewers.
 */

const C = {
  box: '#0b1220',
  stroke: '#1a2740',
  accent: '#22d3ee',
  text: '#e8eef7',
  sub: '#7c8ba1',
}

export default function SystemDiagram() {
  const BY = 44
  const BH = 132
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mt-12"
    >
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        시스템 구성도
      </p>
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-space-900/40 p-4 sm:p-6">
        <svg viewBox="0 0 1080 280" className="h-auto w-full min-w-[680px]" role="img" aria-label="SignBridge 시스템 구성도">
          <defs>
            <linearGradient id="koren" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#0e7490" />
              <stop offset="1" stopColor="#22d3ee" />
            </linearGradient>
            <marker id="arrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 z" fill={C.accent} />
            </marker>
            <marker id="arrowBack" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 z" fill="#f0abfc" />
            </marker>
          </defs>

          {/* ---- forward connectors ---- */}
          {[
            [234, 292],
            [560, 612],
            [806, 858],
          ].map(([x1, x2], i) => {
            const y = BY + BH / 2
            return (
              <g key={`c${i}`}>
                <line x1={x1} y1={y} x2={x2 - 2} y2={y} stroke={C.accent} strokeWidth="1.6" opacity="0.55" markerEnd="url(#arrow)" />
                <circle r="3.5" fill="#a5f3fc">
                  <animate attributeName="cx" from={x1} to={x2 - 2} dur="2.2s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
                  <animate attributeName="cy" values={`${y};${y}`} dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;1;1;0" dur="2.2s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
                </circle>
              </g>
            )
          })}

          {/* ---- bidirectional Q&A return path: terminal → agents ---- */}
          <path
            d={`M 962 ${BY + BH} C 962 250, 432 250, 432 ${BY + BH}`}
            fill="none"
            stroke="#f0abfc"
            strokeWidth="1.5"
            strokeDasharray="5 5"
            opacity="0.7"
            markerEnd="url(#arrowBack)"
          />
          <text x="697" y="244" textAnchor="middle" fontSize="12.5" fill="#f0abfc">
            양방향 Q&amp;A — 농인 질문 → 맞춤 수어 응답
          </text>

          {/* ---- 1. Input ---- */}
          <g>
            <rect x={24} y={BY} width={210} height={BH} rx="14" fill={C.box} stroke={C.stroke} strokeWidth="1.2" />
            <text x={129} y={BY + 30} textAnchor="middle" fontSize="19" fontWeight="700" fill={C.text}>입력</text>
            {['재난문자(CBS)·방송', '농인 질문 (버튼/텍스트)', '+ GPS 위치'].map((t, j) => (
              <text key={t} x={129} y={BY + 58 + j * 22} textAnchor="middle" fontSize="13" fill={C.sub}>{t}</text>
            ))}
          </g>

          {/* ---- 2. KOREN HPC 4-agent cluster ---- */}
          <g>
            <rect x={292} y={BY} width={268} height={BH} rx="14" fill="#0a1626" stroke={C.accent} strokeWidth="1.6" opacity="0.95" />
            <text x={426} y={BY + 28} textAnchor="middle" fontSize="17" fontWeight="700" fill={C.accent}>KOREN HPC · 4-에이전트</text>
            {[
              '① 재난 판단',
              '② 수어 변환',
              '③ Q&A 대응 (판단)',
              '④ 송출 제어',
            ].map((t, j) => {
              const col = j % 2
              const row = Math.floor(j / 2)
              return (
                <text key={t} x={306 + col * 132} y={BY + 60 + row * 30} fontSize="13.5" fill={C.text}>{t}</text>
              )
            })}
            <text x={426} y={BY + BH - 12} textAnchor="middle" fontSize="11.5" fill={C.sub}>H200 GPU · KoGPT2 · Transformer</text>
          </g>

          {/* ---- 3. KOREN transport ---- */}
          <g>
            <rect x={612} y={BY} width={194} height={BH} rx="14" fill="url(#koren)" stroke={C.accent} strokeWidth="2" opacity="0.95" />
            <text x={709} y={BY + 34} textAnchor="middle" fontSize="18" fontWeight="700" fill="#04111a">KOREN망 송출</text>
            {['SRT · WebRTC', '관절 좌표 ≈ 0.1Mbps', '다채널 동시 송출'].map((t, j) => (
              <text key={t} x={709} y={BY + 62 + j * 22} textAnchor="middle" fontSize="12.5" fill="#06303a">{t}</text>
            ))}
          </g>

          {/* ---- 4. Terminal ---- */}
          <g>
            <rect x={858} y={BY} width={198} height={BH} rx="14" fill={C.box} stroke={C.stroke} strokeWidth="1.2" />
            <text x={957} y={BY + 30} textAnchor="middle" fontSize="19" fontWeight="700" fill={C.text}>출력 단말</text>
            {['3D 수어 아바타', '웹·모바일·방송', '정보 표출 + 질의응답'].map((t, j) => (
              <text key={t} x={957} y={BY + 58 + j * 22} textAnchor="middle" fontSize="13" fill={C.sub}>{t}</text>
            ))}
          </g>
        </svg>
      </div>
      <p className="mt-2 text-center text-[10px] text-slate-600 sm:hidden">← 옆으로 밀어서 전체 보기 →</p>
      <p className="mx-auto mt-3 max-w-2xl text-center text-xs leading-relaxed text-slate-500">
        무거운 영상이 아닌 경량 관절 좌표만 전송 — KOREN 저지연망에서 다채널 동시 송출과 양방향 질의응답을 모두 초저지연으로 처리합니다.
      </p>
    </motion.div>
  )
}
