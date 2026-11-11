import type { Params } from '../generators/types'
import type { CustomShape } from '../custom/custom'
import type { ReplicadMesh } from 'replicad-threejs-helper'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
let seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

worker.onmessage = (e) => {
  const m = e.data
  const p = pending.get(m.reqId)
  if (!p) return
  pending.delete(m.reqId)
  m.ok ? p.resolve(m) : p.reject(new Error(m.error))
}

function call(kind: 'mesh' | 'stl' | 'step', id: string, params: Params, custom?: CustomShape): Promise<any> {
  const reqId = ++seq
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    worker.postMessage({ reqId, kind, id, params, custom })
  })
}

export interface PreviewMesh { id: string; mesh: ReplicadMesh }
export const buildMesh = async (id: string, p: Params, custom?: CustomShape): Promise<PreviewMesh[]> => (await call('mesh', id, p, custom)).meshes
export const buildBlob = async (kind: 'stl' | 'step', id: string, p: Params, custom?: CustomShape): Promise<Blob> => (await call(kind, id, p, custom)).blob
