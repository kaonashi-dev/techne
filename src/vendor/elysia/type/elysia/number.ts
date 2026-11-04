import { Number } from '../../../typebox/type/index'
import type { TNumber, TNumberOptions } from '../../../typebox/index'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

const emptyNumber = Object.freeze(Number())
export function NumberType(options?: TNumberOptions): TNumber {
	if (!options || isEmpty(options)) return emptyNumber

	const schema = { ...options, type: 'number', '~kind': 'Number' }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
