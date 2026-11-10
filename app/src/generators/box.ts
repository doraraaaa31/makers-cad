import { drawRoundedRectangle, type Shape3D } from 'replicad'
import type { Generator, Params } from './types'

/** 角丸の長方形を、底面 z0 から高さ h だけ押し出す（中心は XY 原点） */
function slab(w: number, d: number, r: number, z0: number, h: number): Shape3D {
  const rr = Math.max(0, Math.min(r, w / 2 - 0.01, d / 2 - 0.01))
  return drawRoundedRectangle(w, d, rr).sketchOnPlane('XY', z0).extrude(h) as Shape3D
}

/** 収納ボックス：上面開口、仕切り壁つき、単一ソリッド */
export function buildBox(p: Params): Shape3D {
  const { W, D, H, wall, floor, divX, divY, radius } = p

  const outer = slab(W, D, radius, 0, H)
  // 内側は壁厚ぶん小さく。角丸半径も壁厚ぶん減らして壁厚を一定に保つ
  const cavity = slab(W - 2 * wall, D - 2 * wall, radius - wall, floor, H - floor + 1)
  let body = outer.cut(cavity)

  const innerW = W - 2 * wall
  const innerD = D - 2 * wall
  const t = wall // 仕切り壁の厚み
  const h = H - floor + 0.5 // 底に少しめり込ませて確実に融合させる

  // 縦仕切り（X方向に等間隔、Y方向に伸びる壁）
  const nx = Math.round(divX)
  for (let i = 1; i <= nx; i++) {
    const x = -innerW / 2 + (innerW * i) / (nx + 1)
    const rib = slab(t, innerD + 0.5, 0, floor - 0.5, h).translate(x, 0, 0)
    body = body.fuse(rib)
  }
  // 横仕切り（Y方向に等間隔、X方向に伸びる壁）
  const ny = Math.round(divY)
  for (let i = 1; i <= ny; i++) {
    const y = -innerD / 2 + (innerD * i) / (ny + 1)
    const rib = slab(innerW + 0.5, t, 0, floor - 0.5, h).translate(0, y, 0)
    body = body.fuse(rib)
  }
  return body
}

export const boxGenerator: Generator = {
  id: 'box',
  name: '収納ボックス',
  params: [
    { key: 'W', label: '幅 W', min: 30, max: 300, step: 1, default: 120, unit: 'mm' },
    { key: 'D', label: '奥行 D', min: 30, max: 300, step: 1, default: 80, unit: 'mm' },
    { key: 'H', label: '高さ H', min: 10, max: 200, step: 1, default: 40, unit: 'mm' },
    { key: 'wall', label: '壁厚', min: 0.8, max: 6, step: 0.2, default: 2, unit: 'mm' },
    { key: 'floor', label: '底厚', min: 0.8, max: 8, step: 0.2, default: 2, unit: 'mm' },
    { key: 'divX', label: '仕切り数（縦）', min: 0, max: 8, step: 1, default: 1, unit: '本' },
    { key: 'divY', label: '仕切り数（横）', min: 0, max: 8, step: 1, default: 0, unit: '本' },
    { key: 'radius', label: '角の丸み', min: 0, max: 30, step: 0.5, default: 4, unit: 'mm' },
  ],
  buildModel: buildBox,
  fileName: (p) => `box_${p.W}x${p.D}x${p.H}`,
}
