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
        uSun: { value: new THREE.Vector3(0.45, 0.32, 1.0).normalize() },
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
          float sun = dot(N, normalize(uSun));
          float dayAmt = smoothstep(-0.12, 0.30, sun);
          vec3 day = texture2D(uDay, vUv).rgb;
          // gentle day shading so the lit side has form
          day *= 0.55 + 0.65 * clamp(sun, 0.0, 1.0);
          vec3 night = uHasNight > 0.5
            ? texture2D(uNight, vUv).rgb * vec3(1.15, 1.0, 0.7) * 1.4
            : day * 0.04;
          vec3 color = mix(night, day, dayAmt);
          // cyan atmosphere rim toward the camera
          vec3 V = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
          color += uAtmo * rim * 0.55;
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
