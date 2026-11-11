import opencascade from 'replicad-opencascadejs'
import opencascadeWasm from 'replicad-opencascadejs/wasm?url'
import { loadFont, setOC } from 'replicad'
import fontUrl from '../assets/MPLUS1p-Regular.ttf?url'
import { getGenerator } from '../generators'
import type { Params } from '../generators/types'
import { buildCustom, buildPartShapes, FONT_FAMILY, type CustomShape } from '../custom/custom'
import { setTextFont } from '../custom/text'

// replicad 公式サンプル(replicad-studio)と同様: locateFile で wasm の URL を渡して初期化
const ready = (async () => {
  const OC = await (opencascade as any)({ locateFile: () => opencascadeWasm })
  setOC(OC)
})()

// テキストパーツがあるときだけ、日本語対応フォント（M PLUS 1p, OFL）を読み込む（約1.7MB。初回のみ）
let fontReady: Promise<void> | null = null
function ensureFont() {
  fontReady ??= (async () => {
    const res = await fetch(fontUrl)
    if (!res.ok) throw new Error('フォントの読み込みに失敗しました')
    setTextFont((await loadFont(await res.arrayBuffer(), FONT_FAMILY)) as any)
  })().catch((err) => {
    fontReady = null // 次回やり直せるようにする
    throw err
  })
  return fontReady
}

function build(id: string, params: Params, custom?: CustomShape) {
  return custom ? buildCustom(custom, params) : getGenerator(id).buildModel(params)
}

export interface BuildRequest {
  reqId: number
  kind: 'mesh' | 'stl' | 'step'
  id: string
  params: Params
  custom?: CustomShape // 画面上で作った自作形状（組み込み部品のときは無し）
}

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const { reqId, kind, id, params, custom } = e.data
  try {
    await ready
    if (custom?.parts.some((p) => p.type === 'text')) await ensureFont()
    if (kind === 'mesh') {
      // プレビュー：自作形状はパーツごとに（色分けのため）、組み込みの形状は1つ
      const items = custom ? buildPartShapes(custom, params) : [{ id: 'main', shape: build(id, params) }]
      const meshes = items.map(({ id: partId, shape }) => ({
        id: partId,
        mesh: {
          faces: shape.mesh({ tolerance: 0.1, angularTolerance: 0.2 }),
          edges: shape.meshEdges({ tolerance: 0.1, angularTolerance: 0.2 }),
        },
      }))
      self.postMessage({ reqId, kind, ok: true, meshes })
    } else {
      const shape = build(id, params, custom)
      const blob = kind === 'stl' ? shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.1 }) : shape.blobSTEP()
      self.postMessage({ reqId, kind, ok: true, blob })
    }
  } catch (err) {
    self.postMessage({ reqId, kind, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
