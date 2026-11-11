import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Bounds, Grid, TransformControls } from '@react-three/drei'
import { BoxGeometry, BufferGeometry, EdgesGeometry, type Mesh } from 'three'
import { syncFaces, syncLines, type ReplicadMesh } from 'replicad-threejs-helper'
import type { PreviewMesh } from './kernel/client'
import { anchorPos, WORLD_ID, type SnapMode, type Vec3 } from './custom/custom'

/** 編集中のパーツを囲む枠（ドラッグで移動・拡大縮小するための操作対象） */
export interface OverlayItem {
  id: string
  op: 'add' | 'cut'
  center: [number, number, number]
  size: [number, number, number]
}
/** 位置合わせ（点→点 / 線→線 / 線→距離）の基準を、3Dビュー上でクリックして選ぶための設定 */
export interface SnapOverlay {
  mode: SnapMode
  /** マーカーを出す対象の枠の id（動かすパーツ、または合わせ先。WORLD_ID は原点と座標軸） */
  targetIds: string[]
  /** 選んだ基準以外を隠す対象の id（動かす側は、選んだ後は緑の目印だけ残す） */
  hideUnpicked: string[]
  /** すでに選んだ基準（緑で表示） */
  picked: { partId: string; s: Vec3 }[]
  onPick: (partId: string, s: Vec3) => void
}
export interface Overlay {
  snap?: SnapOverlay
  items: OverlayItem[]
  selectedId: string | null
  mode: 'translate' | 'scale'
  onSelect: (id: string) => void
  /** ドラッグ終了時に、枠の新しい中心と倍率を通知する */
  onTransform: (id: string, center: [number, number, number], scale: [number, number, number]) => void
}

// ギズモ（矢印・ハンドル）で実際に動かした最後の時刻。ドラッグ直後のクリックで選択が切り替わらないようにする
let gizmoDraggedAt = 0

const ADD_COLOR = '#2f7de1'
const CUT_COLOR = '#e03a3a'

function PartBoxView({ item, selected, overlay }: { item: OverlayItem; selected: boolean; overlay: Overlay }) {
  const ref = useRef<Mesh>(null)
  const color = item.op === 'cut' ? CUT_COLOR : ADD_COLOR
  const edges = useMemo(() => {
    const g = new BoxGeometry(item.size[0], item.size[1], item.size[2])
    const e = new EdgesGeometry(g)
    g.dispose()
    return e
  }, [item.size[0], item.size[1], item.size[2]]) // eslint-disable-line react-hooks/exhaustive-deps

  // 寸法が変わったら、ドラッグで付いた倍率をリセット（枠の大きさは geometry 側で表現する）
  useEffect(() => {
    ref.current?.scale.set(1, 1, 1)
    ref.current?.position.set(...item.center)
  }, [item.center[0], item.center[1], item.center[2], item.size[0], item.size[1], item.size[2]]) // eslint-disable-line react-hooks/exhaustive-deps

  const box = (
    <mesh ref={ref} position={item.center} userData={{ partId: item.id }}
      {...(overlay.snap ? { raycast: () => null } : {})} // 位置合わせ中は、枠がクリックを受けて目印への操作を邪魔しないようにする
      onClick={(e) => {
        e.stopPropagation()
        if (overlay.snap) return // 位置合わせ中は、枠のクリックで選択を切り替えない
        if (Date.now() - gizmoDraggedAt < 300) return // 実際にドラッグした直後のクリックは、選択の切り替えに使わない
        // クリック位置で重なっているパーツを手前から順に集め、選択中の「次」を選ぶ（同じ場所を続けて押すと順に切り替わる）
        const ids: string[] = []
        for (const hit of e.intersections) {
          const id = hit.object.userData.partId as string | undefined
          if (id && !ids.includes(id)) ids.push(id)
        }
        const at = ids.indexOf(overlay.selectedId ?? '')
        overlay.onSelect(ids[at < 0 ? 0 : (at + 1) % ids.length] ?? item.id)
      }}>
      <boxGeometry args={item.size} />
      <meshBasicMaterial color={color} transparent opacity={selected ? 0.18 : 0.07} depthWrite={false} />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </mesh>
  )

  if (!selected || overlay.snap) return box // 位置合わせ中はギズモを隠す
  return (
    <>
      {box}
      <TransformControls
        object={ref as React.RefObject<Mesh>}
        mode={overlay.mode}
        translationSnap={1}
        scaleSnap={0.05}
        size={0.8}
        onObjectChange={() => { gizmoDraggedAt = Date.now() + 300 }}
        onMouseUp={() => {
          const o = ref.current
          if (!o) return
          overlay.onTransform(item.id, [o.position.x, o.position.y, o.position.z], [o.scale.x, o.scale.y, o.scale.z])
          o.scale.set(1, 1, 1) // 倍率は寸法に反映済み。寸法が変わらなかった場合も枠を元の大きさに戻す
        }}
      />
    </>
  )
}

const MARK = '#ff9f1a'
const MARK_HOVER = '#ff2d55'
const MARK_PICKED = '#22c55e'
const S3 = [-1, 0, 1]

function Marker({ position, args, picked, onPick }: {
  position: Vec3
  args: [number, number, number] | number
  picked: boolean
  onPick: () => void
}) {
  const [hover, setHover] = useState(false)
  const color = picked ? MARK_PICKED : hover ? MARK_HOVER : MARK
  return (
    <mesh position={position} renderOrder={10}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
      onPointerOut={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); onPick() }}>
      {Array.isArray(args) ? <boxGeometry args={args} /> : <sphereGeometry args={[args, 12, 12]} />}
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={hover || picked ? 1 : 0.85} />
    </mesh>
  )
}

/** 1つの枠（または原点・座標軸）に、選べる点・辺のマーカーを並べる */
function SnapMarkers({ item, snap }: { item: OverlayItem; snap: SnapOverlay }) {
  const isWorld = item.id === WORLD_ID
  const maxDim = Math.max(...item.size)
  const r = isWorld ? 2 : Math.min(6, Math.max(1, maxDim * 0.035))
  const isPicked = (s: Vec3) => snap.picked.some((p) => p.partId === item.id && p.s.every((v, i) => v === s[i]))
  const box = { center: item.center, size: item.size }
  const out: React.ReactNode[] = []
  const show = (s: Vec3) => !snap.hideUnpicked.includes(item.id) || isPicked(s)

  if (snap.mode === 'point' || snap.mode === 'face') {
    for (const x of isWorld ? [0] : S3) for (const y of isWorld ? [0] : S3) for (const z of isWorld ? [0] : S3) {
      const s: Vec3 = [x, y, z]
      // 面に貼る：面の中心（0 がちょうど2つ）だけを選べるようにする
      if (snap.mode === 'face' && s.filter((v) => v === 0).length !== 2) continue
      if (show(s)) out.push(<Marker key={s.join()} position={anchorPos(box, s)} args={r} picked={isPicked(s)} onPick={() => snap.onPick(item.id, s)} />)
    }
  } else {
    // 辺：向き a の軸に沿った線。ほかの2軸は ±1（枠の端）。原点・座標軸は各軸1本だけ
    for (let a = 0; a < 3; a++) {
      const o = [0, 1, 2].filter((k) => k !== a)
      for (const sb of isWorld ? [-1] : [-1, 1]) for (const sc of isWorld ? [-1] : [-1, 1]) {
        const s: Vec3 = [0, 0, 0]
        s[o[0]] = sb
        s[o[1]] = sc
        const len = isWorld ? 400 : item.size[a]
        const t = isWorld ? 2.5 : Math.min(8, Math.max(2.5, maxDim * 0.05)) // 辺の太さ（クリックしやすいように太めにする）
        const args: Vec3 = [t, t, t]
        args[a] = Math.max(len, t)
        if (show(s)) out.push(<Marker key={'e' + a + s.join()} position={anchorPos(box, s)} args={args} picked={isPicked(s)} onPick={() => snap.onPick(item.id, s)} />)
      }
    }
  }
  return <>{out}</>
}

function snapItems(overlay: Overlay): OverlayItem[] {
  const snap = overlay.snap!
  return snap.targetIds.map((id) =>
    id === WORLD_ID ? { id, op: 'add' as const, center: [0, 0, 0] as Vec3, size: [0, 0, 0] as Vec3 } : overlay.items.find((i) => i.id === id)!,
  ).filter(Boolean)
}

/** 1つのメッシュ（1パーツ分）を、指定した色で描く */
function MeshView({ mesh, color }: { mesh: ReplicadMesh; color: string }) {
  const faces = useMemo(() => new BufferGeometry(), [])
  const lines = useMemo(() => new BufferGeometry(), [])
  useEffect(() => {
    syncFaces(faces, mesh.faces)
    if (mesh.edges) syncLines(lines, mesh.edges)
  }, [mesh, faces, lines])
  return (
    <group>
      <mesh geometry={faces}>
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
      </mesh>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#3a2a22" />
      </lineSegments>
    </group>
  )
}

export function Viewer({ meshes, color, colors, overlay }: {
  meshes: PreviewMesh[]
  color: string // 共通の色
  colors: Record<string, string> // パーツ id → そのパーツの色（未指定は共通の色）
  overlay?: Overlay
}) {
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
          {meshes.map((m) => <MeshView key={m.id} mesh={m.mesh} color={colors[m.id] ?? color} />)}
        </group>
      </Bounds>
      {/* 枠は Bounds の外に置く（カメラの自動フィットに影響させない） */}
      {overlay?.items.map((it) => (
        <PartBoxView key={it.id} item={it} selected={it.id === overlay.selectedId} overlay={overlay} />
      ))}
      {overlay?.snap && snapItems(overlay).map((it) => <SnapMarkers key={'snap' + it.id} item={it} snap={overlay.snap!} />)}
      <OrbitControls makeDefault />
    </Canvas>
  )
}
