import type { Shape3D } from 'replicad'

export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit: string // 'mm' | '個' | ''
  group?: string // UIで見出しとして表示するグループ名（任意）
}

export type Params = Record<string, number>

export interface Generator {
  id: string
  name: string
  params: ParamDef[]
  buildModel: (p: Params) => Shape3D
  fileName: (p: Params) => string // 拡張子なし
}
