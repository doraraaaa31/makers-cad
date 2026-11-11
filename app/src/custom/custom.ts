// 画面上で作る「自作形状」：基本パーツ（直方体・円柱・円錐台・球）を「足す／くり抜く」で組み合わせる。
// 幾何演算は replicad の fuse / cut を使う（自前実装はしない）。
import { draw, drawCircle, drawRoundedRectangle, makeSphere, type Shape3D } from 'replicad'
import { textSolid } from './text'
import { reliefSolid, type ReliefImage } from './relief'
import type { Generator, ParamDef, Params } from '../generators/types'

export type PartType = 'box' | 'cylinder' | 'cone' | 'sphere' | 'text' | 'image'

/** テキストの字形に使うフォント名（worker で loadFont したときの名前） */
export const FONT_FAMILY = 'mplus1p'
export type PartOp = 'add' | 'cut'

export interface Part {
  id: string
  type: PartType
  op: PartOp
  values: Record<string, number> // フィールド名 → 値
  text?: string // type が 'text' のときの文字列
  image?: ReliefImage // type が 'image' のときの画像（明るさの格子）
  pattern?: boolean // 模様（格子状に繰り返し配置）を使うか。使うと繰り返しの数・間隔のスライダーが増える
  color?: string // プレビューでの色（未指定なら共通の色）。STL/STEP には含まれない
}
export interface CustomShape {
  id: string // 'custom:xxxx'
  name: string
  parts: Part[]
}

export const TYPE_LABEL: Record<PartType, string> = {
  box: '直方体',
  cylinder: '円柱',
  cone: '円錐台',
  sphere: '球',
  text: 'テキスト',
  image: '画像（レリーフ）',
}
export const OP_LABEL: Record<PartOp, string> = { add: '足す', cut: 'くり抜く' }

interface Field { key: string; label: string; min: number; max: number; step: number; default: number; unit?: string }

const POS: Field[] = [
  { key: 'x', label: '位置 X（中心）', min: -200, max: 200, step: 1, default: 0 },
  { key: 'y', label: '位置 Y（中心）', min: -200, max: 200, step: 1, default: 0 },
  { key: 'z', label: '位置 Z（底面）', min: -100, max: 300, step: 1, default: 0 },
]
const size = (key: string, label: string, def: number, min = 0.5): Field => ({ key, label, min, max: 300, step: 0.5, default: def })

export const FIELDS: Record<PartType, Field[]> = {
  box: [size('w', '幅 W', 40), size('d', '奥行 D', 30), size('h', '高さ H', 20),
    { key: 'round', label: '角の丸み（縦の辺）', min: 0, max: 50, step: 0.5, default: 0 }, ...POS],
  cylinder: [size('dia', '直径', 30), size('h', '高さ H', 20), ...POS],
  cone: [size('dBot', '下の直径', 40), size('dTop', '上の直径', 20, 0), size('h', '高さ H', 20), ...POS],
  sphere: [size('dia', '直径', 30), ...POS],
  // テキスト：size=文字の大きさ（フォントサイズ）、h=厚み（くり抜くときは彫る深さ）。XY平面の上向きに置く
  // 画像：w=幅（奥行は画像の縦横比）、h=凹凸の高さ、base=土台の厚み、levels=明るさの段数、invert=1で明暗を反転
  image: [
    size('w', '幅', 40, 5),
    { key: 'h', label: '凹凸の高さ', min: 0.2, max: 30, step: 0.1, default: 3 },
    { key: 'base', label: '土台の厚み', min: 0.4, max: 10, step: 0.2, default: 1 },
    { key: 'levels', label: '明るさの段数', min: 2, max: 8, step: 1, default: 4, unit: '段' },
    { key: 'invert', label: '明暗を反転（0=しない 1=する）', min: 0, max: 1, step: 1, default: 0, unit: '' },
    ...POS,
  ],
  text: [size('size', '文字の大きさ', 10, 2), { key: 'h', label: '厚み／深さ', min: 0.2, max: 50, step: 0.1, default: 1 }, ...POS],
}

/** 模様（格子状の繰り返し）：最初の1個を基準に、+X / +Y 方向へ並べる。間隔は中心から中心まで */
export const PATTERN_FIELDS: Field[] = [
  { key: 'repX', label: '模様：横（X）の個数', min: 1, max: 20, step: 1, default: 3, unit: '個' },
  { key: 'repY', label: '模様：縦（Y）の個数', min: 1, max: 20, step: 1, default: 2, unit: '個' },
  { key: 'pitchX', label: '模様：横（X）の間隔', min: 0.5, max: 300, step: 0.5, default: 20 },
  { key: 'pitchY', label: '模様：縦（Y）の間隔', min: 0.5, max: 300, step: 0.5, default: 20 },
]
export const PATTERN_MAX = 100 // 個数の上限（横×縦）。多すぎると生成に時間がかかる

export const uid = () => Math.random().toString(36).slice(2, 8)

export function newPart(type: PartType, op: PartOp = 'add', keep?: Record<string, number>, text = 'テキスト', image?: ReliefImage): Part {
  const values: Record<string, number> = {}
  for (const f of FIELDS[type]) values[f.key] = keep && ['x', 'y', 'z'].includes(f.key) && f.key in keep ? keep[f.key] : f.default
  if (type === 'text') return { id: uid(), type, op, values, text }
  if (type === 'image') return { id: uid(), type, op, values, image }
  return { id: uid(), type, op, values }
}

export const paramKey = (part: Part, field: string) => `${part.id}_${field}`

/** 自作形状 → スライダー定義 */
export function customParams(def: CustomShape): ParamDef[] {
  return def.parts.flatMap((part, i) =>
    [...FIELDS[part.type], ...(part.pattern ? PATTERN_FIELDS : [])].map((f) => ({
      key: paramKey(part, f.key),
      label: f.label,
      min: f.min, max: f.max, step: f.step,
      default: part.values[f.key] ?? f.default,
      unit: f.unit ?? 'mm',
      group: `パーツ${i + 1}：${TYPE_LABEL[part.type]}（${OP_LABEL[part.op]}）`,
    })),
  )
}

function buildOne(part: Part, p: Params): Shape3D {
  const v = (k: string) => p[paramKey(part, k)] ?? part.values[k]
  const [x, y, z] = [v('x'), v('y'), v('z')]
  switch (part.type) {
    case 'box':
      return (drawRoundedRectangle(v('w'), v('d'), Math.max(0, Math.min(v('round') ?? 0, v('w') / 2 - 0.01, v('d') / 2 - 0.01))).sketchOnPlane('XY', z).extrude(v('h')) as Shape3D).translate(x, y, 0)
    case 'cylinder':
      return (drawCircle(v('dia') / 2).sketchOnPlane('XY', z).extrude(v('h')) as Shape3D).translate(x, y, 0)
    case 'cone': {
      const rb = v('dBot') / 2
      const rt = v('dTop') / 2
      const h = v('h')
      const pen = draw([0, 0]).lineTo([rb, 0]).lineTo([rt, h])
      if (rt > 0) pen.lineTo([0, h])
      return (pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]) as Shape3D).translate(x, y, z)
    }
    case 'sphere': {
      const r = v('dia') / 2
      return makeSphere(r).translate(x, y, z + r)
    }
    case 'text':
      // 文字の輪郭を（フォントが読み込まれた状態で）立体にする。中心を (x, y) に合わせる
      return textSolid(part.text?.trim() ? part.text : ' ', v('size'), x, y, z, v('h'))
    case 'image':
      if (!part.image) throw new Error('画像パーツに画像が選ばれていません')
      return reliefSolid(part.image, v('w'), v('h'), v('base'), Math.round(v('levels')), Math.round(v('invert')) === 1, x, y, z)
  }
}

/** パーツ1つ分の立体。模様が有効なら、最初の1個を +X / +Y 方向に繰り返し並べて結合する */
function buildPart(part: Part, p: Params): Shape3D {
  const one = buildOne(part, p)
  if (!part.pattern) return one
  const v = (k: string) => p[paramKey(part, k)] ?? part.values[k] ?? PATTERN_FIELDS.find((f) => f.key === k)!.default
  const nx = Math.round(v('repX'))
  const ny = Math.round(v('repY'))
  if (nx * ny > PATTERN_MAX) throw new Error(`模様の個数が多すぎます（横×縦で ${PATTERN_MAX} 個まで。いまは ${nx * ny} 個）`)
  // replicad の結合は入力の形を消費するので、並べるたびに複製を使う
  let out = one.clone()
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (i === 0 && j === 0) continue
      out = out.fuse(one.clone().translate(i * v('pitchX'), j * v('pitchY'), 0)) as Shape3D
    }
  }
  return out
}

/** 模様を有効にする。間隔の初期値は、パーツの大きさに少し余白を足した値 */
export function withPattern(part: Part, on: boolean): Part {
  if (!on) return { ...part, pattern: false }
  const box = partBox({ ...part, pattern: false }, {})
  const values = { ...part.values }
  const defs: Record<string, number> = {
    repX: 3, repY: 2,
    pitchX: Math.min(300, Math.ceil(box.size[0] + 2)),
    pitchY: Math.min(300, Math.ceil(box.size[1] + 2)),
  }
  for (const f of PATTERN_FIELDS) if (values[f.key] === undefined) values[f.key] = defs[f.key]
  return { ...part, pattern: true, values }
}

export function buildCustom(def: CustomShape, p: Params): Shape3D {
  let body: Shape3D | null = null
  for (const part of def.parts) {
    const shape = buildPart(part, p)
    if (part.op === 'add') body = body ? (body.fuse(shape) as Shape3D) : shape
    else if (body) body = body.cut(shape) as Shape3D
  }
  if (!body) throw new Error('「足す」パーツが1つ以上必要です')
  return body
}

/**
 * プレビュー用：パーツごとに別々の形を作る（色分け表示のため）。
 * 「足す」パーツ i は、そのあとの「くり抜く」パーツだけで削る（先に行われたくり抜きの影響は受けない）。
 * 書き出す立体（buildCustom）とは別物で、内部で重なる面は描かれるが、見た目はほぼ同じになる。
 */
export function buildPartShapes(def: CustomShape, p: Params): { id: string; shape: Shape3D }[] {
  const out: { id: string; shape: Shape3D }[] = []
  def.parts.forEach((part, i) => {
    if (part.op !== 'add') return
    let shape = buildPart(part, p)
    for (const later of def.parts.slice(i + 1)) if (later.op === 'cut') shape = shape.cut(buildPart(later, p)) as Shape3D
    out.push({ id: part.id, shape })
  })
  if (!out.length) throw new Error('「足す」パーツが1つ以上必要です')
  return out
}

export function makeCustomGenerator(def: CustomShape): Generator {
  return {
    id: def.id,
    name: `${def.name}（自作）`,
    params: customParams(def),
    buildModel: (p) => buildCustom(def, p),
    fileName: (p) => {
      const first = def.parts[0]
      const dims = FIELDS[first.type].filter((f) => !['x', 'y', 'z', 'round', 'base', 'levels', 'invert'].includes(f.key))
        .map((f) => p[paramKey(first, f.key)] ?? first.values[f.key]).join('x')
      return `${def.name.replace(/[\/:*?"<>|\s]+/g, '_')}_${dims}`
    },
  }
}

const KEY = 'makers-cad:custom-shapes'
export const loadCustoms = (): CustomShape[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}
export const saveCustoms = (list: CustomShape[]) => localStorage.setItem(KEY, JSON.stringify(list))

// ---- 3Dビューでのドラッグ編集用：パーツを囲む枠（バウンディングボックス）との相互変換 ----

export interface PartBox {
  center: [number, number, number]
  size: [number, number, number]
}

/** 文字列の幅の目安：全角は1em、半角は約0.55em。実際の字形とは少し違うので、枠の目安としてだけ使う */
export const estimateTextWidth = (text: string, size: number) =>
  Math.max(size * 0.5, [...text].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x80 ? 0.55 : 1) * size, 0))

const val = (part: Part, p: Params, k: string) => p[paramKey(part, k)] ?? part.values[k]

/** パーツの現在の寸法から、それを囲む枠の中心とサイズを求める（Z が上） */
export function partBox(part: Part, p: Params): PartBox {
  const v = (k: string) => val(part, p, k)
  const [x, y, z] = [v('x'), v('y'), v('z')]
  switch (part.type) {
    case 'box':
      return { center: [x, y, z + v('h') / 2], size: [v('w'), v('d'), v('h')] }
    case 'cylinder':
      return { center: [x, y, z + v('h') / 2], size: [v('dia'), v('dia'), v('h')] }
    case 'cone': {
      const m = Math.max(v('dBot'), v('dTop'))
      return { center: [x, y, z + v('h') / 2], size: [m, m, v('h')] }
    }
    case 'sphere':
      return { center: [x, y, z + v('dia') / 2], size: [v('dia'), v('dia'), v('dia')] }
    case 'text':
      return { center: [x, y, z + v('h') / 2], size: [estimateTextWidth(part.text ?? '', v('size')), v('size'), v('h')] }
    case 'image': {
      const img = part.image
      const depth = img ? (v('w') * img.h) / img.w : v('w')
      const hh = v('base') + v('h')
      return { center: [x, y, z + hh / 2], size: [v('w'), depth, hh] }
    }
  }
}

const snap = (n: number, step: number) => Math.round(n / step) * step
const clampField = (type: PartType, key: string, n: number) => {
  const f = FIELDS[type].find((f) => f.key === key)!
  return Math.min(f.max, Math.max(f.min, n))
}

/**
 * ドラッグ結果（枠の新しい中心と倍率）を、パーツの寸法・位置のパラメータ差分に変換する。
 * 拡大縮小は枠の中心を固定して行う。丸い形（円柱・円錐台・球）は、1よりも大きく動かした軸の倍率を採用する。
 */
export function transformPart(part: Part, p: Params, center: [number, number, number], scale: [number, number, number]): Params {
  const v = (k: string) => val(part, p, k)
  const [sx, sy, sz] = scale
  const far = (...xs: number[]) => xs.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1)
  // 倍率が1（=寸法を変えていない）なら、現在の値をそのまま保つ（移動だけで寸法が丸められないように）
  const dim = (k: string, f: number) => (f === 1 ? v(k) : clampField(part.type, k, snap(v(k) * f, 0.5)))

  const next: Params = {}
  switch (part.type) {
    case 'box':
      next.w = dim('w', sx); next.d = dim('d', sy); next.h = dim('h', sz)
      break
    case 'cylinder':
      next.dia = dim('dia', far(sx, sy)); next.h = dim('h', sz)
      break
    case 'cone': {
      const f = far(sx, sy)
      next.dBot = dim('dBot', f); next.dTop = dim('dTop', f); next.h = dim('h', sz)
      break
    }
    case 'sphere':
      next.dia = dim('dia', far(sx, sy, sz))
      break
    case 'text':
      next.size = dim('size', far(sx, sy)); next.h = dim('h', sz)
      break
    case 'image':
      next.w = dim('w', far(sx, sy)); next.h = dim('h', sz)
      break
  }
  // 新しい寸法で枠を求め直し、中心を保ったまま底面の Z を決める
  const tmp: Part = { ...part, values: { ...part.values, ...next } }
  const size = partBox({ ...tmp, values: { ...tmp.values, x: 0, y: 0, z: 0 } }, {}).size
  const r2 = (n: number) => Math.round(n * 100) / 100
  const out: Params = { x: r2(center[0]), y: r2(center[1]), z: r2(center[2] - size[2] / 2) }
  out.x = clampField(part.type, 'x', out.x)
  out.y = clampField(part.type, 'y', out.y)
  out.z = clampField(part.type, 'z', out.z)
  return Object.fromEntries(Object.entries({ ...next, ...out }).map(([k, n]) => [paramKey(part, k), n]))
}


// ---- 位置合わせ（点→点 / 線→線 / 線→距離）----
// 各パーツの枠（バウンディングボックス）上の「点」と「辺」を基準に、パーツを平行移動する。

export type Vec3 = [number, number, number]
export type SnapMode = 'point' | 'edge' | 'offset'
export const AXIS_NAME = ['X', 'Y', 'Z']

/** 合わせ先に使える「原点と座標軸」。大きさ0の枠として扱う */
export const WORLD_ID = 'world'
export const WORLD_BOX: PartBox = { center: [0, 0, 0], size: [0, 0, 0] }

/**
 * 枠上の基準は s = [sx, sy, sz]（各 -1 / 0 / +1）で表す。
 *   点：全部（角 = ±1が3つ、辺の中点 = 0が1つ、面の中心 = 0が2つ、中心 = 0が3つ）
 *   辺：0 がちょうど1つ。その 0 の軸が辺の向き
 */
export const anchorPos = (box: PartBox, s: Vec3): Vec3 =>
  [0, 1, 2].map((i) => box.center[i] + (s[i] * box.size[i]) / 2) as Vec3
export const isEdgeAnchor = (s: Vec3) => s.filter((v) => v === 0).length === 1
export const edgeAxis = (s: Vec3) => s.findIndex((v) => v === 0)

/** 「線→距離」で距離を測れる軸（2本の辺の向きのどちらでもない軸） */
export const offsetAxes = (aAxis: number, bAxis: number) => [0, 1, 2].filter((k) => k !== aAxis && k !== bAxis)

/**
 * 動かす側の基準 pa を、合わせ先の基準 pb に合わせるための平行移動量を返す。
 *  point : 2点を一致させる
 *  edge  : 2本の線を重ねる（同じ向きなら向きと直角の2軸、違う向きなら交わるように残りの1軸だけ動かす）
 *  offset: 指定した軸方向に、合わせ先の線から dist mm 離れた位置へ（他の軸は動かさない）
 */
export function snapDelta(mode: SnapMode, pa: Vec3, aAxis: number, pb: Vec3, bAxis: number, axis = 0, dist = 0): Vec3 {
  const d: Vec3 = [0, 0, 0]
  if (mode === 'point') {
    for (let i = 0; i < 3; i++) d[i] = pb[i] - pa[i]
  } else if (mode === 'edge') {
    if (aAxis === bAxis) {
      for (let i = 0; i < 3; i++) if (i !== aAxis) d[i] = pb[i] - pa[i]
    } else {
      const t = 3 - aAxis - bAxis
      d[t] = pb[t] - pa[t]
    }
  } else {
    d[axis] = pb[axis] + dist - pa[axis]
  }
  return d
}
