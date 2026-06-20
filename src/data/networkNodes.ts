import * as THREE from 'three'

export interface CityNode {
  id: string
  name: string
  lat: number
  lng: number
  /** Larger nodes read as primary hubs */
  primary?: boolean
}

/**
 * Major Korean nodes that symbolize the KOREN low-latency research network.
 * Daejeon is the hub (KISTI / KOREN NOC), so most arcs originate there.
 */
export const CITY_NODES: CityNode[] = [
  { id: 'seoul', name: '서울', lat: 37.5665, lng: 126.978 },
  { id: 'daejeon', name: '대전', lat: 36.3504, lng: 127.3845, primary: true },
  { id: 'pangyo', name: '판교', lat: 37.3947, lng: 127.1112 },
  { id: 'daegu', name: '대구', lat: 35.8714, lng: 128.6014 },
  { id: 'busan', name: '부산', lat: 35.1796, lng: 129.0756 },
  { id: 'gwangju', name: '광주', lat: 35.1595, lng: 126.8526 },
  { id: 'jeju', name: '제주', lat: 33.4996, lng: 126.5312 },
]

/**
 * Geographic centroid of the nodes. Used to "spread" the cluster (below).
 */
const CENTROID = {
  lat: CITY_NODES.reduce((s, c) => s + c.lat, 0) / CITY_NODES.length,
  lng: CITY_NODES.reduce((s, c) => s + c.lng, 0) / CITY_NODES.length,
}

/**
 * Korea is tiny relative to the whole globe, so the real city coordinates
 * collapse into a single dot at hero scale. We keep the *arrangement* (Seoul
 * north, Busan south-east, …) but scale each city's offset from the centroid
 * so the network reads as a legible constellation of nodes + arcs. This is a
 * deliberate stylization for communication, not a geographic map.
 */
const SPREAD = 3.6

export function spreadLatLng(c: { lat: number; lng: number }) {
  return {
    lat: CENTROID.lat + (c.lat - CENTROID.lat) * SPREAD,
    lng: CENTROID.lng + (c.lng - CENTROID.lng) * SPREAD,
  }
}

/** Edges drawn as glowing arcs (pairs of node ids). Hub-and-spoke from Daejeon. */
export const CITY_EDGES: [string, string][] = [
  ['daejeon', 'seoul'],
  ['daejeon', 'pangyo'],
  ['daejeon', 'daegu'],
  ['daejeon', 'busan'],
  ['daejeon', 'gwangju'],
  ['daejeon', 'jeju'],
  ['seoul', 'pangyo'],
  ['daegu', 'busan'],
  ['gwangju', 'busan'],
]

/**
 * Convert latitude/longitude to a point on a sphere of the given radius.
 * Returns a THREE.Vector3 in the standard three.js coordinate frame.
 */
export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number,
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  const x = -radius * Math.sin(phi) * Math.cos(theta)
  const z = radius * Math.sin(phi) * Math.sin(theta)
  const y = radius * Math.cos(phi)
  return new THREE.Vector3(x, y, z)
}

/**
 * Build a quadratic-bezier arc that bows outward from the sphere surface,
 * so connections visibly lift off the globe instead of cutting through it.
 */
export function buildArc(
  start: THREE.Vector3,
  end: THREE.Vector3,
  lift = 0.45,
): THREE.QuadraticBezierCurve3 {
  const mid = start.clone().add(end).multiplyScalar(0.5)
  const distance = start.distanceTo(end)
  mid.normalize().multiplyScalar(start.length() + distance * lift)
  return new THREE.QuadraticBezierCurve3(start, mid, end)
}
