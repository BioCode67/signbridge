import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

export const GLOBE_RADIUS = 1.6

/**
 * Try to load the Blue Marble texture; fall back to `null` (procedural look)
 * if the asset is missing. This guarantees the globe always renders — no blank
 * screen before the user has downloaded the texture.
 */
function useGlobeTexture(): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let disposed = false
    const url = `${import.meta.env.BASE_URL}textures/earth_daymap.jpg`
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        if (disposed) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        setTexture(tex)
      },
      undefined,
      () => {
        // Missing texture → stay on the procedural fallback. Not an error.
        console.info(
          '[SignBridge] earth_daymap.jpg not found — using procedural globe fallback. See README for the texture path.',
        )
      },
    )
    return () => {
      disposed = true
    }
  }, [])

  return texture
}

export default function Globe() {
  const texture = useGlobeTexture()

  // Fresnel atmosphere shader — a cyan rim that glows on the limb of the globe.
  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color('#22d3ee') },
        },
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
            float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
            gl_FragColor = vec4(uColor, 1.0) * intensity;
          }
        `,
      }),
    [],
  )

  useEffect(() => () => atmosphereMaterial.dispose(), [atmosphereMaterial])

  return (
    <group>
      {/* Earth surface */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        {texture ? (
          <meshStandardMaterial
            map={texture}
            metalness={0.1}
            roughness={0.85}
            emissive={new THREE.Color('#0a1f33')}
            emissiveIntensity={0.25}
          />
        ) : (
          // Procedural fallback: deep ocean blue with a clear cyan sheen so the
          // sphere reads even before the Blue Marble texture is added.
          <meshStandardMaterial
            color={new THREE.Color('#15405e')}
            metalness={0.35}
            roughness={0.5}
            emissive={new THREE.Color('#0c4b6b')}
            emissiveIntensity={0.55}
          />
        )}
      </mesh>

      {/* Inner subtle glow shell */}
      <mesh scale={1.015}>
        <sphereGeometry args={[GLOBE_RADIUS, 48, 48]} />
        <meshBasicMaterial
          color="#0e3a52"
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Fresnel atmosphere rim */}
      <mesh scale={1.18} material={atmosphereMaterial}>
        <sphereGeometry args={[GLOBE_RADIUS, 48, 48]} />
      </mesh>
    </group>
  )
}
