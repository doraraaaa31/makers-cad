import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Bounds, Grid } from '@react-three/drei'
import { BufferGeometry } from 'three'
import { syncFaces, syncLines, type ReplicadMesh } from 'replicad-threejs-helper'

export function Viewer({ mesh }: { mesh: ReplicadMesh | null }) {
  const faces = useMemo(() => new BufferGeometry(), [])
  const lines = useMemo(() => new BufferGeometry(), [])
  useEffect(() => {
    if (!mesh) return
    syncFaces(faces, mesh.faces)
    if (mesh.edges) syncLines(lines, mesh.edges)
  }, [mesh, faces, lines])

  return (
    // CAD の Z-up に合わせる
    <Canvas camera={{ position: [150, -200, 150], up: [0, 0, 1], fov: 35, near: 1, far: 5000 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[100, -150, 250]} intensity={1.6} />
      <directionalLight position={[-150, 100, 50]} intensity={0.5} />
      <Grid rotation={[Math.PI / 2, 0, 0]} args={[600, 600]} cellSize={10} sectionSize={50}
        cellColor="#ccd" sectionColor="#99a" fadeDistance={800} infiniteGrid />
      <Bounds fit clip observe margin={1.4}>
        <group>
          <mesh geometry={faces}>
            <meshStandardMaterial color="#e8734a" roughness={0.55} metalness={0.05} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
          </mesh>
          <lineSegments geometry={lines}>
            <lineBasicMaterial color="#3a2a22" />
          </lineSegments>
        </group>
      </Bounds>
      <OrbitControls makeDefault />
    </Canvas>
  )
}
