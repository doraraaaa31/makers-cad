import { AXIS_NAME, type SnapMode } from './custom'

export interface SnapState {
  mode: SnapMode
  picks: { partId: string; s: [number, number, number] }[]
  axis: number
  dist: number
}

const MODES: { mode: SnapMode; label: string; noun: string }[] = [
  { mode: 'point', label: '点→点', noun: '点' },
  { mode: 'edge', label: '線→線', noun: '線（辺）' },
  { mode: 'offset', label: '線→距離', noun: '線（辺）' },
  { mode: 'face', label: '面に貼る', noun: '面' },
]

/** 位置合わせ：点から点／線から線／線から何mm。クリックで基準を選んで、選択中のパーツを動かす */
export function SnapPanel({ state, canStart, canFace, axes, onStart, onCancel, onChange, onApply }: {
  state: SnapState | null
  canStart: boolean
  canFace: boolean // 選択中のパーツが文字・画像（向きを変えられる）か
  axes: number[] // 「線→距離」で選べる軸
  onStart: (m: SnapMode) => void
  onCancel: () => void
  onChange: (patch: Partial<SnapState>) => void
  onApply: () => void
}) {
  const cur = MODES.find((m) => m.mode === state?.mode)
  return (
    <div className="snap">
      <label className="elabel">位置合わせ（選択中のパーツを動かします）</label>
      <div className="emode">
        {MODES.map((m) => (
          <button key={m.mode} className={state?.mode === m.mode ? 'on' : ''}
            disabled={(!canStart && !state) || (m.mode === 'face' && !canFace && state?.mode !== 'face')}
            title={m.mode === 'face' ? '文字や画像を、ほかのパーツの面に貼り付けます（文字・画像を選んでいるとき）' : ''}
            onClick={() => onStart(m.mode)}>{m.label}</button>
        ))}
      </div>
      {state && cur && (
        <div className="snapguide">
          {state.mode === 'face' && <p>貼り付け先の<b>面の中心</b>をクリック（オレンジの目印）。文字・画像がその面に向きを合わせて置かれます</p>}
          {state.mode !== 'face' && state.picks.length === 0 && <p>① 動かすパーツの<b>{cur.noun}</b>をクリック（オレンジの目印）</p>}
          {state.mode !== 'face' && state.picks.length === 1 && <p>② 合わせ先の<b>{cur.noun}</b>をクリック（ほかのパーツ、または原点・座標軸）</p>}
          {state.picks.length === 2 && (
            <div className="snapform">
              <p>③ 合わせ先の線から、どの向きに何mm離しますか？</p>
              <div className="snaprow">
                {axes.map((k) => (
                  <label key={k}><input type="radio" name="snapaxis" checked={state.axis === k} onChange={() => onChange({ axis: k })} />{AXIS_NAME[k]}方向</label>
                ))}
                <input type="number" step={0.5} value={state.dist} onChange={(e) => onChange({ dist: +e.target.value || 0 })} />
                <span className="unit">mm</span>
              </div>
              <p className="note">マイナスにすると逆向きに離れます。0 なら線が重なります。</p>
              <button className="primary" onClick={onApply}>この位置に動かす</button>
            </div>
          )}
          <button className="snapcancel" onClick={onCancel}>やめる</button>
        </div>
      )}
      {!state && !canStart && <p className="note">先にパーツを選んでください。</p>}
    </div>
  )
}
