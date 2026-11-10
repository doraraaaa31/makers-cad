import { boxGenerator } from './box'
import { potGenerator } from './pot'
import type { Generator } from './types'

export const generators: Generator[] = [boxGenerator, potGenerator]
export const getGenerator = (id: string) => generators.find((g) => g.id === id)!
