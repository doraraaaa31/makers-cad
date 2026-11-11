import type { ReliefImage } from './relief'

/** 画像ファイルを読み、レリーフ用の明るさの格子（長辺 maxSide マス以内）にする。透明部分は白として扱う */
export async function readReliefImage(file: File, maxSide = 40): Promise<ReliefImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    // decode() は、ページが非表示のときに終わらないことがあるので、load / error イベントで待つ
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('画像を読み込めません'))
      img.src = url
    })
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(2, Math.round(img.naturalWidth * k))
    const h = Math.max(2, Math.round(img.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const px = ctx.getImageData(0, 0, w, h).data
    const data: number[] = []
    for (let i = 0; i < w * h; i++) {
      // 人の目の感じ方に合わせた明るさ（0〜255）
      data.push(Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]))
    }
    return { w, h, data, name: file.name }
  } finally {
    URL.revokeObjectURL(url)
  }
}
