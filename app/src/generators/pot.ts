import { draw, drawCircle, type Shape3D } from 'replicad'
import type { Generator, Params } from './types'

/** (半径, 高さ) の点列を閉じた断面にして Z 軸まわりに回転 → 回転体ソリッド */
function revolveProfile(pts: [number, number][]): Shape3D {
  const pen = draw(pts[0])
  for (const p of pts.slice(1)) pen.lineTo(p)
  return pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]) as Shape3D
}

/** 植木鉢：円錐台＋肉抜き＋水抜き穴（＋受け皿を横に並べる） */
export function buildPot(p: Params): Shape3D {
  const { topD, botD, H, wall, floor, holes, holeD, saucer } = p
  const rt = topD / 2
  const rb = botD / 2
  const ib = Math.max(0.5, rb - wall) // 内側の底半径
  const it = Math.max(0.5, rt - wall) // 内側の上半径

  // 外壁と内壁を1本の断面にして回転（上面は開口）
  let pot = revolveProfile([
    [0, 0], [rb, 0], [rt, H], [it, H], [ib, floor], [0, floor],
  ])

  // 水抜き穴：1個なら中央、2個以上なら底面の円周上に等間隔
  const n = Math.round(holes)
  if (n > 0) {
    const hr = Math.min(holeD / 2, Math.max(0.5, ib - 1))
    const ring = n === 1 ? 0 : Math.max(0, ib - hr - 1.5)
    // 穴を2D図形として合成してから1回だけ押し出し、1回の cut で抜く（個別 cut より大幅に速い）
    let tool = drawCircle(hr).translate(ring, 0)
    for (let i = 1; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      tool = tool.fuse(drawCircle(hr).translate(ring * Math.cos(a), ring * Math.sin(a)))
    }
    pot = pot.cut(tool.sketchOnPlane('XY', -1).extrude(floor + 2) as Shape3D) as Shape3D
  }

  // 受け皿：別パーツとして鉢の横に配置（互いに接しないので各々が密閉ソリッド）
  if (Math.round(saucer) === 1) {
    const sr = Math.max(rt, rb) + 8 // 皿の内半径
    const sh = 12
    const st = Math.max(wall, 1.6)
    const dish = revolveProfile([
      [0, 0], [sr + st, 0], [sr + st + 4, sh], [sr + 4, sh], [sr, st], [0, st],
    ]).translate(rt + sr + st + 14, 0, 0)
    pot = pot.fuse(dish) as Shape3D
  }
  return pot
}

export const generator: Generator = {
  id: 'pot',
  name: '植木鉢',
  params: [
    { key: 'topD', label: '上口径', min: 30, max: 300, step: 1, default: 100, unit: 'mm' },
    { key: 'botD', label: '底径', min: 20, max: 250, step: 1, default: 70, unit: 'mm' },
    { key: 'H', label: '高さ', min: 20, max: 300, step: 1, default: 90, unit: 'mm' },
    { key: 'wall', label: '壁厚', min: 1, max: 8, step: 0.2, default: 2.4, unit: 'mm' },
    { key: 'floor', label: '底厚', min: 1, max: 10, step: 0.2, default: 3, unit: 'mm' },
    { key: 'holes', label: '水抜き穴の数', min: 0, max: 8, step: 1, default: 3, unit: '個' },
    { key: 'holeD', label: '水抜き穴の径', min: 2, max: 20, step: 0.5, default: 6, unit: 'mm' },
    { key: 'saucer', label: '受け皿（0=なし 1=あり）', min: 0, max: 1, step: 1, default: 0, unit: '' },
  ],
  buildModel: buildPot,
  fileName: (p) => `pot_${p.topD}x${p.botD}x${p.H}`,
}
