import type { Params } from '../generators/types'
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

function call(kind: 'mesh' | 'stl' | 'step', id: string, params: Params): Promise<any> {
  const reqId = ++seq
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    worker.postMessage({ reqId, kind, id, params })
  })
}

export const buildMesh = async (id: string, p: Params): Promise<ReplicadMesh> => (await call('mesh', id, p)).mesh
export const buildBlob = async (kind: 'stl' | 'step', id: string, p: Params): Promise<Blob> => (await call(kind, id, p)).blob
