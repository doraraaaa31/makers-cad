import { useEffect, useRef, useState } from 'react'
import type { ReplicadMesh } from 'replicad-threejs-helper'
import { generators, getGenerator } from './generators'
import type { Params } from './generators/types'
import { buildBlob, buildMesh } from './kernel/client'
import { Viewer } from './Viewer'
import './App.css'

const defaults = (id: string): Params =>
  Object.fromEntries(getGenerator(id).params.map((d) => [d.key, d.default]))

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function App() {
  const [genId, setGenId] = useState(generators[0].id)
  const [params, setParams] = useState<Params>(() => defaults(genId))
  const [mesh, setMesh] = useState<ReplicadMesh | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const gen = getGenerator(genId)
  const latest = useRef(0)

  // パラメータが変わったら少し待ってから再生成（連続操作はまとめる）
  useEffect(() => {
    const my = ++latest.current
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const m = await buildMesh(genId, params)
        if (my !== latest.current) return
        setMesh(m)
        setError(null)
      } catch (e) {
        if (my === latest.current) setError((e as Error).message)
      } finally {
        if (my === latest.current) setBusy(false)
      }
    }, 120)
    return () => clearTimeout(t)
  }, [genId, params])

  const exportAs = async (kind: 'stl' | 'step') => {
    try {
      const blob = await buildBlob(kind, genId, params)
      download(blob, `${gen.fileName(params)}.${kind}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="app">
      <aside className="panel">
        <h1>Maker's CAD</h1>
        <select className="gensel" value={genId} onChange={(e) => {
          setGenId(e.target.value)
          setParams(defaults(e.target.value))
          setMesh(null)
          setError(null)
        }}>
          {generators.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <p className="sub">単位: mm</p>
        {gen.params.map((d) => (
          <div className="row" key={d.key}>
            <label>{d.label}</label>
            <input type="range" min={d.min} max={d.max} step={d.step} value={params[d.key]}
              onChange={(e) => setParams({ ...params, [d.key]: +e.target.value })} />
            <input type="number" min={d.min} max={d.max} step={d.step} value={params[d.key]}
              onChange={(e) => {
                const v = Math.min(d.max, Math.max(d.min, +e.target.value))
                if (!Number.isNaN(v)) setParams({ ...params, [d.key]: v })
              }} />
            <span className="unit">{d.unit}</span>
          </div>
        ))}
        <div className="actions">
          <button onClick={() => exportAs('stl')} disabled={busy || !!error}>STL を書き出す</button>
          <button onClick={() => exportAs('step')} disabled={busy || !!error}>STEP を書き出す</button>
        </div>
        <p className="file">{gen.fileName(params)}.stl</p>
        {error && <p className="err">生成エラー: {error}</p>}
      </aside>
      <main className="view">
        <Viewer mesh={mesh} />
        {busy && <div className="badge">{mesh ? '再生成中…' : 'CADカーネル読み込み中…'}</div>}
      </main>
    </div>
  )
}
