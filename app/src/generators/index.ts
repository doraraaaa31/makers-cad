import type { Generator } from './types'

// このフォルダの *.ts のうち、`export const generator: Generator` を持つファイルを自動登録する。
// （index.ts / types.ts / 先頭が _ のファイルは対象外。新しい部品は _template.ts をコピーして作る）
const modules = import.meta.glob<{ generator: Generator }>(
  ['./*.ts', '!./index.ts', '!./types.ts', '!./_*.ts'],
  { eager: true },
)

export const generators: Generator[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path].generator)
  .filter(Boolean)

export const getGenerator = (id: string) => generators.find((g) => g.id === id)!
