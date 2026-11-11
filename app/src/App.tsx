import { useEffect, useRef, useState } from 'react'
import { generators as builtins } from './generators'
import type { Generator, Params } from './generators/types'
import { CustomEditor } from './custom/CustomEditor'
import { SnapPanel, type SnapState } from './custom/SnapPanel'
import {
  anchorPos, customParams, edgeAxis, loadCustoms, makeCustomGenerator, newPart, offsetAxes, paramKey, partBox,
  saveCustoms, snapDelta, transformPart, uid, WORLD_BOX, WORLD_ID,
  type CustomShape, type SnapMode, type Vec3,
} from './custom/custom'
import { buildBlob, buildMesh, type PreviewMesh } from './kernel/client'
import { Viewer, type Overlay } from './Viewer'
import './App.css'

const SWATCHES = ['#e8734a', '#4a90e8', '#4caf6a', '#f2c744', '#d9d9d9', '#555555', '#b06ae8', '#ff8fb1']
const COLOR_KEY = 'makers-cad:color'

const defaultsOf = (g: Generator): Params => Object.fromEntries(g.params.map((d) => [d.key, d.default]))

/** 構造を変えたあとのパラメータ：残るキーは現在値を引き継ぎ、新しいキーは初期値 */
const syncParams = (def: CustomShape, prev: Params): Params =>
  Object.fromEntries(customParams(def).map((d) => [d.key, prev[d.key] ?? d.default]))

/** スライダーの現在値を、自作形状のパーツの値として取り込む */
const bakeValues = (def: CustomShape, params: Params): CustomShape => ({
  ...def,
  parts: def.parts.map((p) => ({
    ...p,
    values: Object.fromEntries(Object.keys(p.values).map((k) => [k, params[paramKey(p, k)] ?? p.values[k]])),
  })),
})

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function App() {
  const [customs, setCustoms] = useState<CustomShape[]>(loadCustoms)
  const [draft, setDraft] = useState<CustomShape | null>(null) // 編集中の自作形状
  const [notice, setNotice] = useState<string | null>(null) // 保存などの完了通知
  const [selectedId, setSelectedId] = useState<string | null>(null) // 3Dビューで選択中のパーツ
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'scale'>('translate')
  const [snapState, setSnapState] = useState<SnapState | null>(null) // 位置合わせ（点→点 など）の進行状態
  const [genId, setGenId] = useState(builtins[0].id)
  const [params, setParams] = useState<Params>(() => defaultsOf(builtins[0]))
  const [meshes, setMeshes] = useState<PreviewMesh[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const [color, setColor] = useState(() => localStorage.getItem(COLOR_KEY) ?? SWATCHES[0])
  useEffect(() => localStorage.setItem(COLOR_KEY, color), [color])

  // 組み込み部品 + 自作形状（編集中はドラフトを優先）
  const customDefs = draft && !customs.some((c) => c.id === draft.id)
    ? [...customs, draft]
    : customs.map((c) => (draft && c.id === draft.id ? draft : c))
  const generators: Generator[] = [...builtins, ...customDefs.map(makeCustomGenerator)]
  const gen = generators.find((g) => g.id === genId) ?? generators[0]
  const customDef = customDefs.find((c) => c.id === gen.id)
  // パーツごとの色（自作形状のみ）。未指定のパーツは共通の色
  const partColors: Record<string, string> = Object.fromEntries(
    (customDef?.parts ?? []).filter((p) => p.color).map((p) => [p.id, p.color!]),
  )
  const structKey = customDef ? JSON.stringify(customDef.parts.map((p) => [p.id, p.type, p.op])) : ''

  // パラメータが変わったら少し待ってから再生成（連続操作はまとめる）
  useEffect(() => {
    const my = ++latest.current
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const m = await buildMesh(gen.id, params, customDef)
        if (my !== latest.current) return
        setMeshes(m)
        setError(null)
      } catch (e) {
        if (my === latest.current) setError((e as Error).message)
      } finally {
        if (my === latest.current) setBusy(false)
      }
    }, 120)
    return () => clearTimeout(t)
    // customDef は structKey（構造）と params（寸法）で変化を捉える
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen.id, params, structKey])

  const exportAs = async (kind: 'stl' | 'step') => {
    try {
      const blob = await buildBlob(kind, gen.id, params, customDef)
      download(blob, `${gen.fileName(params)}.${kind}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const goBuiltin = () => {
    setGenId(builtins[0].id)
    setParams(defaultsOf(builtins[0]))
    setMeshes(null)
    setError(null)
  }
  // ---- 位置合わせ（点→点 / 線→線 / 線→距離）：3Dビューで基準をクリックして、選択中のパーツを動かす ----
  const movingPart = draft?.parts.find((p) => p.id === selectedId)
  const boxOf = (id: string) => (id === WORLD_ID ? WORLD_BOX : partBox(draft!.parts.find((p) => p.id === id)!, params))
  const startSnap = (mode: SnapMode) => setSnapState({ mode, picks: [], axis: 0, dist: 0 })
  const applySnap = (st: SnapState) => {
    if (!draft || !movingPart || st.picks.length < 2) return
    const [a, b] = st.picks
    const boxA = boxOf(a.partId)
    const point = st.mode === 'point'
    const d = snapDelta(
      st.mode, anchorPos(boxA, a.s), point ? 0 : edgeAxis(a.s), anchorPos(boxOf(b.partId), b.s), point ? 0 : edgeAxis(b.s), st.axis, st.dist,
    )
    const center: Vec3 = [boxA.center[0] + d[0], boxA.center[1] + d[1], boxA.center[2] + d[2]]
    setParams((prev) => ({ ...prev, ...transformPart(movingPart, prev, center, [1, 1, 1]) }))
    setSnapState(null)
  }
  const pickSnap = (partId: string, s: Vec3) => {
    if (!snapState) return
    if (snapState.picks.length === 0) {
      if (partId === selectedId) setSnapState({ ...snapState, picks: [{ partId, s }] }) // ① 動かす側の基準
      return
    }
    if (snapState.picks.length === 1 && partId !== selectedId) {
      // ② 合わせ先の基準
      const next: SnapState = { ...snapState, picks: [...snapState.picks, { partId, s }] }
      if (snapState.mode === 'offset') {
        next.axis = offsetAxes(edgeAxis(next.picks[0].s), edgeAxis(s))[0]
        setSnapState(next) // 距離を入力してもらう
      } else applySnap(next)
    }
  }
  useEffect(() => {
    if (!snapState) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSnapState(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [snapState])

  // 3Dビュー上のドラッグ結果を寸法・位置に反映する
  const overlay: Overlay | undefined = draft
    ? {
        snap: snapState && selectedId
          ? {
              mode: snapState.mode,
              targetIds:
                snapState.picks.length === 0 ? [selectedId]
                : snapState.picks.length === 1 ? [selectedId, ...draft.parts.filter((p) => p.id !== selectedId).map((p) => p.id), WORLD_ID]
                : [],
              hideUnpicked: snapState.picks.length > 0 ? [selectedId] : [],
              picked: snapState.picks,
              onPick: pickSnap,
            }
          : undefined,
        items: draft.parts.map((p) => ({ id: p.id, op: p.op, ...partBox(p, params) })),
        selectedId,
        mode: gizmoMode,
        onSelect: setSelectedId,
        onTransform: (id, center, scale) => {
          const part = draft.parts.find((p) => p.id === id)
          if (part) setParams((prev) => ({ ...prev, ...transformPart(part, prev, center, scale) }))
        },
      }
    : undefined

  const startNew = () => {
    // 既存と重複しない初期名（形状1, 形状2, …）
    let n = customs.length + 1
    while (customs.some((c) => c.name === `形状${n}`)) n++
    const d: CustomShape = { id: `custom:${uid()}`, name: `形状${n}`, parts: [newPart('box')] }
    setNotice(null)
    setSnapState(null)
    setSelectedId(d.parts[0].id)
    setDraft(d)
    setGenId(d.id)
    setParams(syncParams(d, {}))
    setMeshes(null)
    setError(null)
  }
  const startEdit = (c: CustomShape) => {
    setSelectedId(c.parts[0].id)
    setDraft(bakeValues(c, params)) // 現在のスライダー値を取り込んだ状態で編集に入る
  }
  const changeDraft = (d: CustomShape) => {
    // 選択中のパーツが無くなったら先頭を選び直す。パーツが増えたら新しいパーツを選択する
    if (d.parts.length > (draft?.parts.length ?? 0)) setSelectedId(d.parts[d.parts.length - 1].id)
    else if (!d.parts.some((p) => p.id === selectedId)) setSelectedId(d.parts[0].id)
    setDraft(d)
    setParams((prev) => syncParams(d, prev))
  }
  const saveDraft = () => {
    if (!draft) return
    setSnapState(null)
    const saved = bakeValues(draft, params)
    const list = customs.some((c) => c.id === saved.id)
      ? customs.map((c) => (c.id === saved.id ? saved : c))
      : [...customs, saved]
    setCustoms(list)
    saveCustoms(list)
    setDraft(null)
    setParams(syncParams(saved, {}))
    setNotice(`「${saved.name}」を保存しました。上のドロップダウンから選べます。`)
  }
  const cancelDraft = () => {
    const orig = customs.find((c) => c.id === draft?.id)
    setSnapState(null)
    setDraft(null)
    if (orig) setParams(syncParams(orig, {}))
    else goBuiltin()
  }
  const deleteCustom = (c: CustomShape) => {
    if (!window.confirm(`「${c.name}」を削除しますか？（元に戻せません）`)) return
    const list = customs.filter((x) => x.id !== c.id)
    setCustoms(list)
    saveCustoms(list)
    goBuiltin()
  }

  return (
    <div className="app">
      <aside className="panel">
        <h1>Maker's CAD</h1>
        <select className="gensel" value={gen.id} disabled={!!draft} onChange={(e) => {
          const g = generators.find((x) => x.id === e.target.value)!
          setGenId(g.id)
          setNotice(null)
          setParams(defaultsOf(g))
          setMeshes(null)
          setError(null)
        }}>
          {generators.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {notice && <p className="notice" role="status">{notice}</p>}
        <div className="custombar">
          {!draft && <button onClick={startNew}>＋ 新しい形状を作る</button>}
          {!draft && customDef && <button onClick={() => startEdit(customDef)}>編集</button>}
          {!draft && customDef && <button onClick={() => deleteCustom(customDef)}>削除</button>}
        </div>
        {draft && (
          <CustomEditor draft={draft} onChange={changeDraft} onSave={saveDraft} onCancel={cancelDraft}
            selectedId={selectedId} onSelect={(id) => { if (!snapState) setSelectedId(id) }} mode={gizmoMode} onMode={setGizmoMode} defaultColor={color} />
        )}
        {draft && (
          <SnapPanel state={snapState} canStart={!!movingPart} axes={snapState ? offsetAxes(
            snapState.picks[0] ? edgeAxis(snapState.picks[0].s) : -1, snapState.picks[1] ? edgeAxis(snapState.picks[1].s) : -1) : []}
            onStart={startSnap} onCancel={() => setSnapState(null)}
            onChange={(patch) => setSnapState((st) => (st ? { ...st, ...patch } : st))}
            onApply={() => snapState && applySnap(snapState)} />
        )}
        {draft && <p className="note">3Dビューの枠（青=足す／赤=くり抜く）をクリックして選び、矢印や四角をドラッグして動かせます。重なっているときは、同じ場所を続けてクリックすると次のパーツに切り替わります（左の番号でも選べます）。細かい数値は下のスライダーで調整できます。「保存」で一覧に残ります。</p>}
        <p className="sub">単位: mm</p>
        {gen.params.map((d, i) => (
          <div className="row" key={d.key}>
            {d.group && d.group !== gen.params[i - 1]?.group && <h3 className="grp">{d.group}</h3>}
            <label>{d.label}</label>
            <input type="range" min={d.min} max={d.max} step={d.step} value={params[d.key] ?? d.default}
              onChange={(e) => setParams({ ...params, [d.key]: +e.target.value })} />
            <input type="number" min={d.min} max={d.max} step={d.step} value={params[d.key] ?? d.default}
              onChange={(e) => {
                const v = Math.min(d.max, Math.max(d.min, +e.target.value))
                if (!Number.isNaN(v)) setParams({ ...params, [d.key]: v })
              }} />
            <span className="unit">{d.unit}</span>
          </div>
        ))}
        <div className="colorrow">
          <label>プレビューの色</label>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button key={c} className={'sw' + (c === color ? ' on' : '')} style={{ background: c }}
                onClick={() => setColor(c)} aria-label={c} />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="色を選ぶ" />
          </div>
          <p className="note">※ 色は画面表示のみです。STL / STEP には含まれません。</p>
        </div>
        <div className="actions">
          <button onClick={() => exportAs('stl')} disabled={busy || !!error}>STL を書き出す</button>
          <button onClick={() => exportAs('step')} disabled={busy || !!error}>STEP を書き出す</button>
        </div>
        <p className="file">{gen.fileName(params)}.stl</p>
        {error && <p className="err">生成エラー: {error}</p>}
      </aside>
      <main className="view">
        <Viewer meshes={meshes ?? []} color={color} colors={partColors} overlay={overlay} />
        {busy && <div className="badge">{meshes ? '再生成中…' : 'CADカーネル読み込み中…'}</div>}
      </main>
    </div>
  )
}
