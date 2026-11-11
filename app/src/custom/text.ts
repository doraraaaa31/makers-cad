// テキストの字形（輪郭）を、重なりのない 2D 図形（Drawing）にする。
// 可変フォントの日本語字形は、画ごとの輪郭が重なって含まれていることがある。replicad の drawText はそれを
// そのまま面にしてしまい、壊れた立体になるため、輪郭を自分で読み出し、
// 「外側の輪郭どうしを結合 → 穴の輪郭をくり抜く」を replicad の fuse / cut で行って重なりを解消する。
import { BlueprintSketcher, Drawing, type Shape3D } from 'replicad'

interface Cmd { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
export interface TextFont {
  getPath(text: string, x: number, y: number, fontSize: number): { commands: Cmd[] }
}

let font: TextFont | null = null
export const setTextFont = (f: TextFont) => { font = f }

interface Contour { cmds: Cmd[]; area: number }

// フォントの座標は y が下向き。CAD の y 上向きに合わせて符号を反転して扱う
const P = (x = 0, y = 0): [number, number] => [x, -y]

function areaOf(cmds: Cmd[]): number {
  const pts: [number, number][] = []
  for (const c of cmds) {
    if (c.x1 !== undefined) pts.push(P(c.x1, c.y1))
    if (c.x2 !== undefined) pts.push(P(c.x2, c.y2))
    if (c.x !== undefined) pts.push(P(c.x, c.y))
  }
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

function toContours(commands: Cmd[]): Contour[] {
  const out: Contour[] = []
  let cur: Cmd[] = []
  const flush = () => {
    if (cur.length > 2) out.push({ cmds: cur, area: areaOf(cur) })
    cur = []
  }
  for (const c of commands) {
    if (c.type === 'M') { flush(); cur = [c] }
    else if (c.type === 'Z') flush()
    else cur.push(c)
  }
  flush()
  return out.filter((c) => Math.abs(c.area) > 1e-6)
}

function contourToDrawing(c: Contour): Drawing {
  // replicad 自身の文字描画（drawText）と同じペン（BlueprintSketcher）を使う。
  // draw() のペンは、曲線のあとに直線を引くと内部の曲線が解放済みになりエラーになる
  const [first, ...rest] = c.cmds
  const sk = new BlueprintSketcher()
  let last = P(first.x, first.y)
  sk.movePointerTo(last)
  for (const cmd of rest) {
    const end = P(cmd.x, cmd.y)
    if (Math.abs(end[0] - last[0]) < 1e-9 && Math.abs(end[1] - last[1]) < 1e-9) continue // 同じ点への移動は飛ばす
    if (cmd.type === 'L') sk.lineTo(end)
    else if (cmd.type === 'Q') sk.quadraticBezierCurveTo(end, P(cmd.x1, cmd.y1))
    else if (cmd.type === 'C') sk.cubicBezierCurveTo(end, P(cmd.x1, cmd.y1), P(cmd.x2, cmd.y2))
    last = end
  }
  return new Drawing(sk.close())
}

/** 文字列の輪郭を読み出す（外側の輪郭と、穴の輪郭に分ける） */
function textContours(text: string, size: number) {
  if (!font) throw new Error('フォントが読み込まれていません')
  const contours = toContours(font.getPath(text, 0, 0, size).commands)
  if (!contours.length) throw new Error('この文字は、フォントに字形がありません')
  // いちばん大きい輪郭を「外側」とみなし、同じ向きを外側、逆向きを穴とする
  const outerSign = Math.sign(contours.reduce((m, c) => (Math.abs(c.area) > Math.abs(m.area) ? c : m)).area)
  return {
    outers: contours.filter((c) => Math.sign(c.area) === outerSign),
    holes: contours.filter((c) => Math.sign(c.area) !== outerSign),
  }
}

/**
 * 文字列を、底面 z・厚み h の立体にする（字形の中心を (x, y) に合わせる）。
 * 外側の輪郭どうしを結合し、穴の輪郭をくり抜いてから押し出す（replicad の 2D の fuse / cut）。
 */
export function textSolid(text: string, size: number, x: number, y: number, z: number, h: number): Shape3D {
  const { outers, holes } = textContours(text, size)
  let shape = outers.map(contourToDrawing).reduce((a, b) => a.fuse(b))
  for (const c of holes) shape = shape.cut(contourToDrawing(c))
  const [cx, cy] = shape.boundingBox.center
  return shape.translate(x - cx, y - cy).sketchOnPlane('XY', z).extrude(h) as Shape3D
}
