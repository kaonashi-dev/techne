/*--------------------------------------------------------------------------

TypeBox

The MIT License (MIT)

Copyright (c) 2017-2026 Haydn Paterson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---------------------------------------------------------------------------*/

// ------------------------------------------------------------------
// Engine: Public
// ------------------------------------------------------------------
export { Instantiate, type TInstantiate } from './instantiate'

// ------------------------------------------------------------------
// Engine: Internals
// ------------------------------------------------------------------
export * from './conditional/index'
export * from './constructor_parameters/index'
export * from './cyclic/index'
export * from './enum/index'
export * from './evaluate/index'
export * from './exclude/index'
export * from './extract/index'
export * from './helpers/index'
export * from './indexed/index'
export * from './instance_type/index'
export * from './interface/index'
export * from './intrinsics/index'
export * from './keyof/index'
export * from './mapped/index'
export * from './module/index'
export * from './non_nullable/index'
export * from './object/index'
export * from './omit/index'
export * from './parameters/index'
export * from './patterns/index'
export * from './partial/index'
export * from './pick/index'
export * from './priority/index'
export * from './readonly_object/index'
export * from './record/index'
export * from './ref/index'
export * from './required/index'
export * from './return_type/index'
export * from './template_literal/index'
export * from './with/index'
