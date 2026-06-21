import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

export const GLOBE_RADIUS = 1.6

/** Load a texture, resolving to null on failure (keeps the globe rendering). */
function useTexture(path: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let disposed = false
    const loader = new THREE.TextureLoader()
    loader.load(
      `${import.meta.env.BASE_URL}${path}`,
      (t) => {
        if (disposed) {
          t.dispose()
          return
        }
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 8
        setTex(t)
      },
      undefined,
      () => {
        /* missing texture → stay null (procedural fallback) */
      },
    )
    return () => {
      disposed = true
    }
  }, [path])
  return tex
}

/**
 * Day/night Earth shader: the lit hemisphere shows the satellite day map; the
 * dark hemisphere fades to glowing city lights. A fixed world-space sun means
 * the terminator stays put while the globe rotates, so day sweeps into night.
 */
function useEarthMaterial(day: THREE.Texture | null, night: THREE.Texture | null) {
  return useMemo(() => {
    if (!day) return null
    return new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: day },
        uNight: { value: night },
        uHasNight: { value: night ? 1 : 0 },
        // Sun mostly toward the camera so the front of the globe always reads
        // as lit (no black hemisphere sweeping past as it rotates).
        uSun: { value: new THREE.Vector3(0.18, 0.25, 1.0).normalize() },
        uAtmo: { value: new THREE.Color('#3fc6e8') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform float uHasNight;
        uniform vec3 uSun;
        uniform vec3 uAtmo;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          // View-based lighting: the hemisphere facing the viewer is always lit,
          // so the globe never turns black as it rotates. Only the grazing limbs
          // fall into night (city lights).
          float facing = max(dot(N, V), 0.0);
          vec3 key = normalize(uSun); // reused as a soft key for surface form
          float form = 0.55 + 0.45 * clamp(dot(N, key), 0.0, 1.0);
          vec3 tex = texture2D(uDay, vUv).rgb;
          vec3 lit = tex * (0.7 + 0.6 * form);
          vec3 cities = uHasNight > 0.5
            ? texture2D(uNight, vUv).rgb * vec3(1.2, 1.0, 0.65) * 1.6
            : vec3(0.0);
          vec3 limb = tex * 0.16 + cities;
          float t = smoothstep(0.02, 0.5, facing);
          vec3 color = mix(limb, lit, t);
          // soft ocean specular for a premium sheen
          vec3 H = normalize(key + V);
          float spec = pow(max(dot(N, H), 0.0), 26.0) * t * 0.22;
          color += vec3(0.5, 0.7, 0.9) * spec;
          // cyan atmosphere rim toward the camera
          float rim = pow(1.0 - facing, 2.6);
          color += uAtmo * rim * 0.6;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    })
  }, [day, night])
}

export default function Globe() {
  const day = useTexture('textures/earth_daymap.jpg')
  const night = useTexture('textures/earth_lights.png')
  const earthMaterial = useEarthMaterial(day, night)

  // Cyan fresnel atmosphere shell.
  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color('#38bdf8') } },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vNormal;
          uniform vec3 uColor;
          void main() {
            float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
            gl_FragColor = vec4(uColor, 1.0) * intensity;
          }
        `,
      }),
    [],
  )

  useEffect(
    () => () => {
      atmosphereMaterial.dispose()
      earthMaterial?.dispose()
    },
    [atmosphereMaterial, earthMaterial],
  )

  return (
    <group>
      {/* Earth surface */}
      <mesh material={earthMaterial ?? undefined}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
        {!earthMaterial && (
          // Procedural fallback until/if textures load.
          <meshStandardMaterial
            color={new THREE.Color('#15405e')}
            metalness={0.3}
            roughness={0.55}
            emissive={new THREE.Color('#0c4b6b')}
            emissiveIntensity={0.5}
          />
        )}
      </mesh>

      {/* Cyan fresnel atmosphere */}
      <mesh scale={1.22} material={atmosphereMaterial}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
      </mesh>
    </group>
  )
}
