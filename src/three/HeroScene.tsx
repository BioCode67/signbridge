import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { useResponsive } from '../hooks/useResponsive'
import Starfield from './Starfield'

/**
 * Hero "Signal Field": a luminous national network — glowing nodes linked by
 * faint lines, with data pulses flowing from a bright hub out across the web.
 * Metaphor for KOREN's low-latency broadcast reaching everyone at once.
 * No textures / no terminator → cannot flicker; pure additive glow + bloom.
 */

interface Quality {
  nodes: number
  neighbors: number
  pulses: number
  dpr: [number, number]
  bloom: number
  stars: number
}

function qualityFor(bp: 'mobile' | 'tablet' | 'desktop'): Quality {
  switch (bp) {
    case 'mobile':
      return { nodes: 60, neighbors: 2, pulses: 16, dpr: [1, 1.5], bloom: 0.9, stars: 900 }
    case 'tablet':
      return { nodes: 95, neighbors: 3, pulses: 26, dpr: [1, 1.7], bloom: 1.1, stars: 1600 }
    default:
      return { nodes: 140, neighbors: 3, pulses: 40, dpr: [1, 2], bloom: 1.25, stars: 2600 }
  }
}

/** Soft radial sprite used for every node / pulse. */
function makeDotTexture(): THREE.Texture {
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(186,245,253,0.9)')
  g.addColorStop(0.6, 'rgba(34,211,238,0.35)')
  g.addColorStop(1, 'rgba(34,211,238,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface Graph {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  phases: Float32Array
  linePositions: Float32Array
  edges: { a: THREE.Vector3; b: THREE.Vector3 }[]
}

function buildGraph(count: number, neighbors: number): Graph {
  const pts: THREE.Vector3[] = []
  // Distribute nodes through a rounded volume, denser toward the centre.
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const r = Math.cbrt(Math.random())
    const xy = Math.sqrt(1 - u * u)
    pts.push(
      new THREE.Vector3(
        Math.cos(theta) * xy * r * 2.55,
        u * r * 1.55,
        Math.sin(theta) * xy * r * 1.5,
      ),
    )
  }
  // Hub = node nearest the centre.
  let hub = 0
  let best = Infinity
  pts.forEach((p, i) => {
    const d = p.lengthSq()
    if (d < best) {
      best = d
      hub = i
    }
  })
  pts[hub].set(0, 0, 0)

  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const cCore = new THREE.Color('#eafdff')
  const cCyan = new THREE.Color('#22d3ee')
  const cSoft = new THREE.Color('#7dd3fc')
  for (let i = 0; i < count; i++) {
    const p = pts[i]
    positions[i * 3] = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
    phases[i] = Math.random() * Math.PI * 2
    if (i === hub) {
      sizes[i] = 7
      cCore.toArray(colors, i * 3)
    } else {
      const accent = Math.random() < 0.18
      sizes[i] = accent ? 3.4 : 1.6 + Math.random() * 1.2
      ;(accent ? cSoft : cCyan).toArray(colors, i * 3)
    }
  }

  // kNN edges (deduped), plus every node tethered toward the hub occasionally.
  const edgeSet = new Set<string>()
  const edges: { a: THREE.Vector3; b: THREE.Vector3 }[] = []
  const addEdge = (i: number, j: number) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    edges.push({ a: pts[i], b: pts[j] })
  }
  for (let i = 0; i < count; i++) {
    const dists: { j: number; d: number }[] = []
    for (let j = 0; j < count; j++) {
      if (j === i) continue
      dists.push({ j, d: pts[i].distanceToSquared(pts[j]) })
    }
    dists.sort((m, n) => m.d - n.d)
    for (let k = 0; k < neighbors && k < dists.length; k++) addEdge(i, dists[k].j)
    if (Math.random() < 0.12 && i !== hub) addEdge(i, hub)
  }

  const linePositions = new Float32Array(edges.length * 6)
  edges.forEach((e, i) => {
    linePositions[i * 6] = e.a.x
    linePositions[i * 6 + 1] = e.a.y
    linePositions[i * 6 + 2] = e.a.z
    linePositions[i * 6 + 3] = e.b.x
    linePositions[i * 6 + 4] = e.b.y
    linePositions[i * 6 + 5] = e.b.z
  })

  return { positions, colors, sizes, phases, linePositions, edges }
}

function Field({ quality, animate }: { quality: Quality; animate: boolean }) {
  const group = useRef<THREE.Group>(null)
  const tex = useMemo(makeDotTexture, [])
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio) : 1.5
  const graph = useMemo(() => buildGraph(quality.nodes, quality.neighbors), [quality.nodes, quality.neighbors])

  // Node geometry
  const nodeGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(graph.positions, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(graph.colors, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(graph.sizes, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(graph.phases, 1))
    return g
  }, [graph])

  const nodeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uTex: { value: tex }, uScale: { value: 26 * dpr } },
        vertexShader: /* glsl */ `
          attribute float aSize; attribute float aPhase; attribute vec3 aColor;
          uniform float uTime; uniform float uScale;
          varying vec3 vColor; varying float vTw;
          void main(){
            vColor=aColor;
            float tw=0.6+0.4*sin(uTime*1.6+aPhase);
            vTw=tw;
            vec4 mv=modelViewMatrix*vec4(position,1.0);
            gl_PointSize=aSize*uScale*tw/ -mv.z;
            gl_Position=projectionMatrix*mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex; varying vec3 vColor; varying float vTw;
          void main(){
            vec4 t=texture2D(uTex, gl_PointCoord);
            if(t.a<0.01) discard;
            gl_FragColor=vec4(vColor*(0.7+0.7*vTw), t.a);
          }
        `,
      }),
    [tex, dpr],
  )

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(graph.linePositions, 3))
    return g
  }, [graph])
  const lineMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color('#22d3ee'),
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  )

  // Pulses travelling along edges
  const pulses = useMemo(() => {
    const arr: { a: THREE.Vector3; b: THREE.Vector3; t: number; speed: number }[] = []
    for (let i = 0; i < quality.pulses; i++) {
      const e = graph.edges[Math.floor(Math.random() * graph.edges.length)]
      if (!e) continue
      arr.push({ a: e.a, b: e.b, t: Math.random(), speed: 0.25 + Math.random() * 0.5 })
    }
    return arr
  }, [graph, quality.pulses])
  const pulseGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pulses.length * 3), 3))
    return g
  }, [pulses])
  const pulseMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: tex,
        size: 0.16,
        sizeAttenuation: true,
        color: new THREE.Color('#baf5fd'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [tex],
  )

  useFrame((state, delta) => {
    nodeMat.uniforms.uTime.value = state.clock.elapsedTime
    // Mouse parallax + gentle drift
    if (group.current) {
      const targetY = animate ? state.pointer.x * 0.45 + state.clock.elapsedTime * 0.04 : 0
      const targetX = animate ? -state.pointer.y * 0.28 : 0
      group.current.rotation.y += (targetY - group.current.rotation.y) * 0.05
      group.current.rotation.x += (targetX - group.current.rotation.x) * 0.05
    }
    // Advance pulses
    if (animate) {
      const pos = pulseGeo.getAttribute('position') as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      for (let i = 0; i < pulses.length; i++) {
        const p = pulses[i]
        p.t += p.speed * delta
        if (p.t > 1) {
          p.t -= 1
          const e = graph.edges[Math.floor(Math.random() * graph.edges.length)]
          if (e) {
            p.a = e.a
            p.b = e.b
          }
        }
        arr[i * 3] = p.a.x + (p.b.x - p.a.x) * p.t
        arr[i * 3 + 1] = p.a.y + (p.b.y - p.a.y) * p.t
        arr[i * 3 + 2] = p.a.z + (p.b.z - p.a.z) * p.t
      }
      pos.needsUpdate = true
    }
  })

  return (
    <group ref={group}>
      <lineSegments geometry={lineGeo} material={lineMat} />
      <points geometry={nodeGeo} material={nodeMat} />
      <points geometry={pulseGeo} material={pulseMat} />
    </group>
  )
}

function Rig() {
  const { camera } = useThree()
  useMemo(() => {
    camera.position.set(0, 0, 6)
    camera.lookAt(0, 0, 0)
  }, [camera])
  return null
}

export default function HeroScene() {
  const { breakpoint, reducedMotion } = useResponsive()
  const quality = useMemo(() => qualityFor(breakpoint), [breakpoint])
  const animate = !reducedMotion

  return (
    <Canvas
      dpr={quality.dpr}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 6], fov: 45 }}
      style={{ width: '100%', height: '100%' }}
    >
      <Rig />
      <Suspense fallback={null}>
        <Starfield count={quality.stars} animate={animate} />
        <Field quality={quality} animate={animate} />
      </Suspense>
      <EffectComposer>
        <Bloom intensity={quality.bloom} luminanceThreshold={0.15} luminanceSmoothing={0.9} mipmapBlur />
      </EffectComposer>
    </Canvas>
  )
}
