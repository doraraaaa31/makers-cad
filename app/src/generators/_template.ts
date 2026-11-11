// 新しい部品の雛形。このファイルを「部品名.ts」にコピーして中身を書き換えるだけで、
// UI のドロップダウンに自動で追加される（index.ts の編集は不要）。
//   例: cp _template.ts holder.ts
import { drawRoundedRectangle, type Shape3D } from 'replicad'
import type { Generator, Params } from './types'

// 形を作る関数。replicad の fuse / cut / fillet / shell だけで組み立てる（自前のブーリアン禁止）。
// Z が上、単位は mm。
function buildModel(p: Params): Shape3D {
  const { W, D, H, radius } = p
  return drawRoundedRectangle(W, D, radius).sketchOnPlane('XY').extrude(H) as Shape3D
}

export const generator: Generator = {
  id: 'template', // 他と重複しない英数字
  name: '雛形（ブロック）', // ドロップダウンに出る名前
  // スライダーの定義。key が buildModel の p.<key> に対応する
  params: [
    { key: 'W', label: '幅 W', min: 10, max: 200, step: 1, default: 50, unit: 'mm' },
    { key: 'D', label: '奥行 D', min: 10, max: 200, step: 1, default: 30, unit: 'mm' },
    { key: 'H', label: '高さ H', min: 5, max: 100, step: 1, default: 20, unit: 'mm' },
    { key: 'radius', label: '角の丸み', min: 0, max: 10, step: 0.5, default: 2, unit: 'mm' },
  ],
  buildModel,
  fileName: (p) => `block_${p.W}x${p.D}x${p.H}`, // 拡張子なし
}
