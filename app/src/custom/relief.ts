// 画像の明るさで高さを変える「レリーフ」。
// 画像を粗い格子にして明るさを数段階に分け、各段階の領域の輪郭（格子の辺をたどる）を求め、
// 土台の上に段ごとに押し出して replicad の fuse / cut で結合する（階段状の層。印刷向きで、密閉ソリッドになる）。
import { BlueprintSketcher, Drawing, drawRoundedRectangle, type Shape3D } from 'replicad'

/** 取り込んだ画像：明るさ 0〜255 の格子。data は上の行から順に並べる */
export interface ReliefImage {
  w: number
  h: number
  data: number[]
  name?: string
}

type Pt = [number, number]
type Grid = boolean[][] // [行（0=下）][列]

const filled = (g: Grid, r: number, c: number) => r >= 0 && c >= 0 && r < g.length && c < g[0].length && g[r][c]

/** 斜めにだけ接している 2×2 を埋めて、輪郭が1点で接する（非多様体になる）形をなくす */
function removeDiagonals(g: Grid) {
  let changed = true
  while (changed) {
    changed = false
    for (let r = 0; r < g.length - 1; r++) {
      for (let c = 0; c < g[0].length - 1; c++) {
        const a = g[r][c], b = g[r][c + 1], d = g[r + 1][c], e = g[r + 1][c + 1]
        if (a && e && !b && !d) { g[r][c + 1] = true; changed = true }
        else if (b && d && !a && !e) { g[r][c] = true; changed = true }
      }
    }
  }
}

/** 塗られた領域の輪郭を、閉じた折れ線（格子の頂点）として返す。外側は反時計回り、穴は時計回り */
function traceLoops(g: Grid): Pt[][] {
  const next = new Map<string, Pt>()
  const key = (p: Pt) => p[0] + ',' + p[1]
  const add = (a: Pt, b: Pt) => next.set(key(a), b)
  const H = g.length, W = g[0].length
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!g[r][c]) continue
      if (!filled(g, r - 1, c)) add([c, r], [c + 1, r])
      if (!filled(g, r, c + 1)) add([c + 1, r], [c + 1, r + 1])
      if (!filled(g, r + 1, c)) add([c + 1, r + 1], [c, r + 1])
      if (!filled(g, r, c - 1)) add([c, r + 1], [c, r])
    }
  }
  const loops: Pt[][] = []
  const seen = new Set<string>()
  for (const [k, to] of next) {
    if (seen.has(k)) continue
    const [sx, sy] = k.split(',').map(Number)
    const loop: Pt[] = []
    let cur: Pt = [sx, sy]
    let nxt: Pt | undefined = to
    while (nxt && !seen.has(key(cur))) {
      seen.add(key(cur))
      loop.push(cur)
      cur = nxt
      nxt = next.get(key(cur))
    }
    // 一直線上の頂点を省いて、辺の数を減らす
    const simp = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length]
      return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0
    })
    if (simp.length >= 4) loops.push(simp)
  }
  return loops
}

const area = (l: Pt[]) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + (p[0] * q[1] - q[0] * p[1]) }, 0) / 2
const inside = (pt: Pt, l: Pt[]) => {
  let ins = false
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const [xi, yi] = l[i], [xj, yj] = l[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins
  }
  return ins
}

function polygon(l: Pt[], f: (p: Pt) => Pt): Drawing {
  const sk = new BlueprintSketcher()
  sk.movePointerTo(f(l[0]))
  for (const p of l.slice(1)) sk.lineTo(f(p))
  return new Drawing(sk.close())
}

/** 領域 g を、輪郭（穴つき）ごとの 2D 図形のリストにする */
function regionDrawings(g: Grid, f: (p: Pt) => Pt): Drawing[] {
  const loops = traceLoops(g)
  const outers = loops.filter((l) => area(l) > 0)
  const holes = loops.filter((l) => area(l) < 0)
  const drawings = outers.map((o) => ({ o, area: area(o), d: polygon(o, f) }))
  for (const h of holes) {
    // その穴を囲む外側のうち、いちばん小さいものに属させる
    const owners = drawings.filter((x) => inside(h[0], x.o)).sort((a, b) => a.area - b.area)
    if (owners[0]) owners[0].d = owners[0].d.cut(polygon(h, f))
  }
  return drawings.map((x) => x.d)
}

/** 明るさ → 段階（0〜levels）。明るいほど段が高い（invert なら逆） */
export function toLevels(img: ReliefImage, levels: number, invert: boolean): number[][] {
  const out: number[][] = []
  for (let r = 0; r < img.h; r++) {
    const row: number[] = []
    for (let c = 0; c < img.w; c++) {
      const v = img.data[(img.h - 1 - r) * img.w + c] / 255 // r=0 が下の行
      row.push(Math.round((invert ? 1 - v : v) * levels))
    }
    out.push(row)
  }
  return out
}

/**
 * 画像のレリーフ立体。幅 w(mm)、奥行は画像の縦横比から決める。中心を (x, y) に置き、底面は z。
 * 土台（厚み base）の上に、凹凸の高さ relief を levels 段に分けて積む。
 */
export function reliefSolid(
  img: ReliefImage, w: number, relief: number, base: number, levels: number, invert: boolean,
  x: number, y: number, z: number,
): Shape3D {
  const cell = w / img.w
  const d = cell * img.h
  const f = (p: Pt): Pt => [x - w / 2 + p[0] * cell, y - d / 2 + p[1] * cell]
  const lv = toLevels(img, levels, invert)

  let solid = drawRoundedRectangle(w, d, 0).translate(x, y).sketchOnPlane('XY', z).extrude(base) as Shape3D

  // 高い段から順に処理し、上の段の領域が必ず下の段に含まれるようにする（宙に浮く層を作らない）
  const step = relief / levels
  let upper: Grid | null = null
  const regions: Grid[] = []
  for (let L = levels; L >= 1; L--) {
    const g: Grid = lv.map((row, r) => row.map((v, c) => v >= L || (upper?.[r][c] ?? false)))
    removeDiagonals(g)
    regions[L] = g
    upper = g
  }
  for (let L = 1; L <= levels; L++) {
    const g = regions[L]
    if (!g.some((row) => row.some(Boolean))) continue
    for (const dr of regionDrawings(g, f)) {
      solid = solid.fuse(dr.sketchOnPlane('XY', z + base + (L - 1) * step).extrude(step) as Shape3D) as Shape3D
    }
  }
  return solid
}
