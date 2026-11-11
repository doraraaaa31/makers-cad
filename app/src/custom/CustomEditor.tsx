import { Fragment, useEffect, useRef } from 'react'
import { canRotate, newPart, OP_LABEL, ORIENTATIONS, orientationPatch, TYPE_LABEL, withPattern, type CustomShape, type PartOp, type PartType } from './custom'
import { readReliefImage } from './imageFile'
import type { ReliefImage } from './relief'

const TYPES = Object.keys(TYPE_LABEL) as PartType[]
const OPS = Object.keys(OP_LABEL) as PartOp[]

/** 取り込んだ画像（明るさの格子）の小さなプレビュー */
function ImageThumb({ img }: { img: ReliefImage }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = img.w
    cv.height = img.h
    const ctx = cv.getContext('2d')!
    const id = ctx.createImageData(img.w, img.h)
    img.data.forEach((v, i) => {
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v
      id.data[i * 4 + 3] = 255
    })
    ctx.putImageData(id, 0, 0)
  }, [img])
  return <canvas ref={ref} className="ethumb" />
}

/** 自作形状の構造（パーツの種類・足す/くり抜く・追加/削除）を編集する。寸法は下のスライダーで調整。 */
export function CustomEditor({ draft, onChange, onSave, onCancel, selectedId, onSelect, mode, onMode, defaultColor, onSetParams, canUndo, canRedo, onUndo, onRedo }: {
  draft: CustomShape
  onChange: (d: CustomShape) => void
  onSave: () => void
  onCancel: () => void
  selectedId: string | null
  onSelect: (id: string) => void
  mode: 'translate' | 'scale'
  onMode: (m: 'translate' | 'scale') => void
  defaultColor: string // 共通のプレビュー色（パーツの色が未指定のときに使う）
  onSetParams: (patch: Record<string, number>) => void // スライダーの値（パラメータ）を直接設定する
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  const setPart = (i: number, patch: Partial<CustomShape['parts'][number]>) =>
    onChange({ ...draft, parts: draft.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  const addImageInput = useRef<HTMLInputElement>(null)
  const addImage = async (file?: File) => {
    if (!file) return
    try {
      const image = await readReliefImage(file)
      onChange({ ...draft, parts: [...draft.parts, newPart('image', 'add', undefined, undefined, image)] })
    } catch {
      window.alert('この画像を読み込めませんでした。PNG / JPEG / GIF / WebP / SVG を選んでください。')
    }
  }
  const changeImage = async (i: number, file?: File) => {
    if (!file) return
    try {
      setPart(i, { image: await readReliefImage(file) })
    } catch {
      window.alert('この画像を読み込めませんでした。')
    }
  }

  return (
    <div className="editor">
      <div className="ehist">
        <button onClick={onUndo} disabled={!canUndo} title="元に戻す（Ctrl+Z）">↶ 元に戻す</button>
        <button onClick={onRedo} disabled={!canRedo} title="やり直す（Ctrl+Y）">↷ やり直す</button>
      </div>
      <label className="elabel">形状の名前</label>
      <input className="ename" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />

      <label className="elabel">パーツ（上から順に組み合わせます）</label>
      {draft.parts.map((part, i) => (
        <Fragment key={part.id}>
          <div className={'epart' + (part.id === selectedId ? ' sel' : '')}>
            <button className="enum" title="3Dビューで選択" onClick={() => onSelect(part.id)}>{i + 1}</button>
            <select value={part.type} disabled={part.type === 'image'} title={part.type === 'image' ? '画像パーツは種類を変えられません' : ''}
              onChange={(e) => {
                const t = e.target.value as PartType
                const np = newPart(t, part.op, part.values)
                setPart(i, { type: t, values: np.values, text: t === 'text' ? (part.text ?? np.text) : part.text })
              }}>
              {/* 画像パーツは画像が必要なので、あとから種類を切り替える候補には出さない（追加ボタンから作る） */}
              {TYPES.filter((t) => t !== 'image' || part.type === 'image').map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <select value={part.op} disabled={i === 0} title={i === 0 ? '最初のパーツは「足す」固定' : ''}
              onChange={(e) => setPart(i, { op: e.target.value as PartOp })}>
              {OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
            </select>
            <input type="color" className="pcolor" value={part.color ?? defaultColor}
              title={part.color ? 'このパーツの色（プレビューのみ）' : '色を選ぶ（いまは共通の色）'}
              onChange={(e) => setPart(i, { color: e.target.value })} />
            {part.color && (
              <button className="pcolorreset" title="共通の色に戻す" aria-label="共通の色に戻す"
                onClick={() => setPart(i, { color: undefined })}>↺</button>
            )}
            <button className={'epat' + (part.pattern ? ' on' : '')} title="模様（格子状に繰り返し並べる）" aria-label="模様の切り替え"
              aria-pressed={!!part.pattern} onClick={() => onChange({ ...draft, parts: draft.parts.map((q, j) => (j === i ? withPattern(q, !q.pattern) : q)) })}>▦</button>
            <button className="del" disabled={draft.parts.length <= 1} aria-label="このパーツを削除"
              onClick={() => onChange({ ...draft, parts: draft.parts.filter((_, j) => j !== i) })}>✕</button>
          </div>
          {canRotate(part) && (
            <div className="eorient">
              <span>向き：</span>
              {ORIENTATIONS.map((o) => (
                <button key={o.label} title={`${o.label}向きにする（面の外向きの法線: ${o.normal.join(', ')}）`}
                  onClick={() => onSetParams(orientationPatch(part, o.rot))}>{o.label}</button>
              ))}
            </div>
          )}
          {part.type === 'text' && (
            <input className="etext" value={part.text ?? ''} placeholder="表示する文字（日本語OK）" aria-label={`パーツ${i + 1}の文字`}
              onChange={(e) => setPart(i, { text: e.target.value })} />
          )}
          {part.type === 'image' && part.image && (
            <div className="eimage">
              <ImageThumb img={part.image} />
              <span className="eimgname" title={part.image.name}>{part.image.name ?? '画像'}（{part.image.w}×{part.image.h}マス）</span>
              <label className="eimgchange">画像を変更
                <input type="file" accept="image/*" hidden onChange={(e) => { changeImage(i, e.target.files?.[0]); e.target.value = '' }} />
              </label>
            </div>
          )}
        </Fragment>
      ))}
      <div className="eadd">
        <span>＋ 追加：</span>
        {TYPES.map((t) =>
          t === 'image' ? (
            <button key={t} onClick={() => addImageInput.current?.click()}>{TYPE_LABEL[t]}…</button>
          ) : (
            <button key={t} onClick={() => onChange({ ...draft, parts: [...draft.parts, newPart(t, 'add')] })}>{TYPE_LABEL[t]}</button>
          ),
        )}
        <input ref={addImageInput} type="file" accept="image/*" hidden
          onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <label className="elabel">3Dビューでのドラッグ操作</label>
      <div className="emode">
        <button className={mode === 'translate' ? 'on' : ''} onClick={() => onMode('translate')}>移動</button>
        <button className={mode === 'scale' ? 'on' : ''} onClick={() => onMode('scale')}>拡大縮小</button>
      </div>
      <div className="eactions">
        <button className="primary" onClick={onSave} disabled={!draft.name.trim()}>保存</button>
        <button onClick={onCancel}>キャンセル</button>
      </div>
    </div>
  )
}
