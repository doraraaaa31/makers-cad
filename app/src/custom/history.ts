import { useEffect, useRef, useState } from 'react'

const QUIET_MS = 350 // 操作が止まってから、これだけ経ったら1つの履歴にまとめる
const MAX = 100 // 履歴の上限

/**
 * 編集内容の「元に戻す／やり直す」。
 * current が null のときは編集中ではないので履歴を空にする。
 * 変化は、操作が止まってから 1 つの履歴にまとめる（スライダーを動かし続けても、元に戻す 1 回で 1 操作ぶん戻る）。
 * restore には、戻した時点の内容が渡される。
 */
export function useEditHistory<T>(current: T | null, restore: (value: T) => void) {
  const stack = useRef<{ key: string; value: T }[]>([])
  const index = useRef(-1)
  const timer = useRef<number | undefined>(undefined)
  const currentRef = useRef(current)
  currentRef.current = current
  const [info, setInfo] = useState({ canUndo: false, canRedo: false })

  const sync = () =>
    setInfo({ canUndo: index.current > 0, canRedo: index.current < stack.current.length - 1 })

  const commit = (value: T) => {
    const key = JSON.stringify(value)
    if (stack.current[index.current]?.key === key) return // 変化なし（戻した直後など）
    stack.current = stack.current.slice(0, index.current + 1) // やり直しの先は捨てる
    stack.current.push({ key, value })
    if (stack.current.length > MAX) stack.current.shift()
    index.current = stack.current.length - 1
    sync()
  }

  const key = current === null ? null : JSON.stringify(current)
  useEffect(() => {
    window.clearTimeout(timer.current)
    if (currentRef.current === null) {
      stack.current = []
      index.current = -1
      sync()
      return
    }
    if (index.current < 0) {
      commit(currentRef.current) // 編集を始めた時点の状態
      return
    }
    timer.current = window.setTimeout(() => currentRef.current !== null && commit(currentRef.current), QUIET_MS)
    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  /** まだ記録されていない最新の変更を、先に履歴へ入れる */
  const flush = () => {
    window.clearTimeout(timer.current)
    if (currentRef.current !== null) commit(currentRef.current)
  }

  const go = (to: number) => {
    if (to < 0 || to >= stack.current.length) return
    index.current = to
    sync()
    restore(stack.current[to].value)
  }

  return {
    canUndo: info.canUndo,
    canRedo: info.canRedo,
    undo: () => { flush(); go(index.current - 1) },
    redo: () => { flush(); go(index.current + 1) },
  }
}
