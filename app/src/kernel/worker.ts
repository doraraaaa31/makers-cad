import opencascade from 'replicad-opencascadejs'
import opencascadeWasm from 'replicad-opencascadejs/wasm?url'
import { setOC } from 'replicad'
import { getGenerator } from '../generators'
import type { Params } from '../generators/types'

// replicad 公式サンプル(replicad-studio)と同様: locateFile で wasm の URL を渡して初期化
const ready = (async () => {
  const OC = await (opencascade as any)({ locateFile: () => opencascadeWasm })
  setOC(OC)
})()

function build(id: string, params: Params) {
  return getGenerator(id).buildModel(params)
}

export interface BuildRequest {
  reqId: number
  kind: 'mesh' | 'stl' | 'step'
  id: string
  params: Params
}

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const { reqId, kind, id, params } = e.data
  try {
    await ready
    const shape = build(id, params)
    if (kind === 'mesh') {
      const faces = shape.mesh({ tolerance: 0.1, angularTolerance: 0.2 })
      const edges = shape.meshEdges({ tolerance: 0.1, angularTolerance: 0.2 })
      self.postMessage({ reqId, kind, ok: true, mesh: { faces, edges } })
    } else {
      const blob = kind === 'stl' ? shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.1 }) : shape.blobSTEP()
      self.postMessage({ reqId, kind, ok: true, blob })
    }
  } catch (err) {
    self.postMessage({ reqId, kind, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
