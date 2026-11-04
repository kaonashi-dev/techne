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
// Engine
// ------------------------------------------------------------------
export { Instantiate, type TInstantiate } from './type/engine/instantiate'

// ------------------------------------------------------------------
// Extends
// ------------------------------------------------------------------
export { Extends, ExtendsResult, type TExtends } from './type/extends/index'

// ------------------------------------------------------------------
// Script
// ------------------------------------------------------------------
export { Script, type TScript } from './type/script/index'

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------
export { Capitalize, type TCapitalize, type TCapitalizeDeferred } from './type/action/capitalize'
export { Conditional, type TConditional, type TConditionalDeferred } from './type/action/conditional'
export { ConstructorParameters, type TConstructorParameters, type TConstructorParametersDeferred } from './type/action/constructor_parameters'
export { Evaluate, type TEvaluate, type TEvaluateDeferred } from './type/action/evaluate'
export { Exclude, type TExclude, type TExcludeDeferred } from './type/action/exclude'
export { Extract, type TExtract, type TExtractDeferred } from './type/action/extract'
export { Index, type TIndex, type TIndexDeferred } from './type/action/index'
export { InstanceType, type TInstanceType, type TInstanceTypeDeferred } from './type/action/instance_type'
export { Interface, type TInterface, type TInterfaceDeferred } from './type/action/interface'
export { KeyOf, type TKeyOf, type TKeyOfDeferred } from './type/action/keyof'
export { Lowercase, type TLowercase, type TLowercaseDeferred } from './type/action/lowercase'
export { Mapped, type TMapped, type TMappedDeferred } from './type/action/mapped'
export { Module, type TModule, type TModuleDeferred } from './type/action/module'
export { NonNullable, type TNonNullable, type TNonNullableDeferred } from './type/action/non_nullable'
export { Omit, type TOmit, type TOmitDeferred } from './type/action/omit'
export { Parameters, type TParameters, type TParametersDeferred } from './type/action/parameters'
export { Partial, type TPartial, type TPartialDeferred } from './type/action/partial'
export { Pick, type TPick, type TPickDeferred } from './type/action/pick'
export { ReadonlyObject, ReadonlyType, type TReadonlyObject, type TReadonlyObjectDeferred } from './type/action/readonly_object'
export { Required, type TRequired, type TRequiredDeferred } from './type/action/required'
export { ReturnType, type TReturnType, type TReturnTypeDeferred } from './type/action/return_type'
export { type TUncapitalize, type TUncapitalizeDeferred, Uncapitalize } from './type/action/uncapitalize'
export { type TUppercase, type TUppercaseDeferred, Uppercase } from './type/action/uppercase'
export { type TWith, With } from './type/action/with'

// ------------------------------------------------------------------
// Extension
// ------------------------------------------------------------------
export { Codec, Decode, DecodeBuilder, Encode, EncodeBuilder, IsCodec, type TCodec } from './type/types/_codec'
export { Immutable, IsImmutable, type TImmutable } from './type/types/_immutable'
export { IsOptional, Optional, type TOptional } from './type/types/_optional'
export { IsReadonly, Readonly, type TReadonly } from './type/types/_readonly'
export { IsRefine, Refine, type TRefine, type TRefineCheckCallback, type TRefineErrorCallback, type TRefinement } from './type/types/_refine'

// ------------------------------------------------------------------
// Standard
// ------------------------------------------------------------------
export { Any, IsAny, type TAny } from './type/types/any'
export { Array, IsArray, type TArray } from './type/types/array'
export { BigInt, IsBigInt, type TBigInt } from './type/types/bigint'
export { Boolean, IsBoolean, type TBoolean } from './type/types/boolean'
export { Call, IsCall, type TCall } from './type/types/call'
export { Constructor, IsConstructor, type TConstructor } from './type/types/constructor'
export { Cyclic, IsCyclic, type TCyclic } from './type/types/cyclic'
export { Enum, IsEnum, IsEnumValue, type TEnum, type TEnumValue } from './type/types/enum'
export { Function, IsFunction, type TFunction } from './type/types/function'
export { Generic, IsGeneric, type TGeneric } from './type/types/generic'
export { Identifier, IsIdentifier, type TIdentifier } from './type/types/identifier'
export { Dependent, IsDependent, type TDependent } from './type/types/dependent'
export { Infer, IsInfer, type TInfer } from './type/types/infer'
export { Integer, IsInteger, type TInteger } from './type/types/integer'
export { Intersect, IsIntersect, type TIntersect } from './type/types/intersect'
export { IsLiteral, Literal, type TLiteral, type TLiteralValue } from './type/types/literal'
export { IsNever, Never, type TNever } from './type/types/never'
export { IsNull, Null, type TNull } from './type/types/null'
export { IsNumber, Number, type TNumber } from './type/types/number'
export { IsObject, Object, type TObject } from './type/types/object'
export { IsParameter, Parameter, type TParameter } from './type/types/parameter'
export { type TProperties, type TRequiredArray } from './type/types/properties'
export { IsRecord, Record, RecordKey, RecordPattern, RecordValue, type TRecord, type TRecordKey, type TRecordPattern, type TRecordValue } from './type/types/record'
export { IsRef, Ref, type TRef } from './type/types/ref'
export { IsRest, Rest, type TRest } from './type/types/rest'
export { IsKind, IsSchema, type TArrayOptions, type TFormat, type TIntersectOptions, type TNumberOptions, type TObjectOptions, type TSchema, type TSchemaOptions, type TStringOptions, type TTupleOptions } from './type/types/schema'
export { type Static, type StaticDecode, type StaticEncode, type StaticParse } from './type/types/static'
export { IsString, String, type TString } from './type/types/string'
export { IsSymbol, Symbol, type TSymbol } from './type/types/symbol'
export { IsTemplateLiteral, TemplateLiteral, type TTemplateLiteral } from './type/types/template_literal'
export { IsThis, This, type TThis } from './type/types/this'
export { IsTuple, type TTuple, Tuple } from './type/types/tuple'
export { IsUndefined, type TUndefined, Undefined } from './type/types/undefined'
export { IsUnion, type TUnion, Union } from './type/types/union'
export { IsUnknown, type TUnknown, Unknown } from './type/types/unknown'
export { IsUnsafe, type TUnsafe, Unsafe } from './type/types/unsafe'
export { IsVoid, type TVoid, Void } from './type/types/void'
