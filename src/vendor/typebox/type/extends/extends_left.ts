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

// deno-fmt-ignore-file

import { type TExtendsAny, ExtendsAny } from './any'
import { type TExtendsArray, ExtendsArray } from './array'
import { type TExtendsBigInt, ExtendsBigInt } from './bigint'
import { type TExtendsBoolean, ExtendsBoolean } from './boolean'
import { type TExtendsConstructor, ExtendsConstructor } from './constructor'
import { type TExtendsDependent, ExtendsDependent } from './dependent'
import { type TExtendsEnum, ExtendsEnum } from './enum'
import { type TExtendsFunction, ExtendsFunction } from './function'
import { type TExtendsInteger, ExtendsInteger } from './integer'
import { type TExtendsIntersect, ExtendsIntersect } from './intersect'
import { type TExtendsLiteral, ExtendsLiteral } from './literal'
import { type TExtendsNever, ExtendsNever } from './never'
import { type TExtendsNull, ExtendsNull } from './null'
import { type TExtendsNumber, ExtendsNumber } from './number'
import { type TExtendsObject, ExtendsObject } from './object'
import { type TExtendsRecord, ExtendsRecord } from './record'
import { type TExtendsString, ExtendsString } from './string'
import { type TExtendsSymbol, ExtendsSymbol } from './symbol'
import { type TExtendsTemplateLiteral, ExtendsTemplateLiteral } from './template_literal'
import { type TExtendsTuple, ExtendsTuple  } from './tuple'
import { type TExtendsUndefined, ExtendsUndefined } from './undefined'
import { type TExtendsUnion, ExtendsUnion } from './union'
import { type TExtendsUnknown, ExtendsUnknown } from './unknown'
import { type TExtendsVoid, ExtendsVoid } from './void'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
import { type TAny, IsAny } from '../types/any'
import { type TArray, IsArray } from '../types/array'
import { type TBigInt, IsBigInt } from '../types/bigint'
import { type TBoolean, IsBoolean  } from '../types/boolean'
import { type TConstructor, IsConstructor } from '../types/constructor'
import { type TDependent, IsDependent } from '../types/dependent'
import { type TEnum, type TEnumValue, IsEnum } from '../types/enum'
import { type TFunction, IsFunction } from '../types/function'
import { type TInteger, IsInteger } from '../types/integer'
import { type TIntersect, IsIntersect } from '../types/intersect'
import { type TLiteral, IsLiteral } from '../types/literal'
import { type TNever, IsNever } from '../types/never'
import { type TNull, IsNull } from '../types/null'
import { type TNumber, IsNumber } from '../types/number'
import { type TObject, IsObject } from '../types/object'
import { type TRecord, IsRecord, RecordPattern, RecordValue } from '../types/record'
import { type TSchema } from '../types/schema'
import { type TString, IsString } from '../types/string'
import { type TSymbol, IsSymbol } from '../types/symbol'
import { type TTemplateLiteral, IsTemplateLiteral } from '../types/template_literal'
import { type TTuple, IsTuple } from '../types/tuple'
import { type TUndefined, IsUndefined } from '../types/undefined'
import { type TUnknown, IsUnknown } from '../types/unknown'
import { type TProperties } from '../types/properties'
import { type TUnion, IsUnion } from '../types/union'
import { type TVoid, IsVoid } from '../types/void'

import * as Result from './result'

// ----------------------------------------------------------------------------
// ExtendsLeft
// ----------------------------------------------------------------------------
export type TExtendsLeft<Inferred extends TProperties, Left extends TSchema, Right extends TSchema> = (
  Left extends TAny ? TExtendsAny<Inferred, Left, Right> :
  Left extends TArray<infer Items extends TSchema> ? TExtendsArray<Inferred, Left, Items, Right> :
  Left extends TBigInt ? TExtendsBigInt<Inferred, Left, Right> :
  Left extends TBoolean ? TExtendsBoolean<Inferred, Left, Right> :
  Left extends TConstructor<infer Parameters extends TSchema[], infer InstanceType extends TSchema> ? TExtendsConstructor<Inferred, Parameters, InstanceType, Right> :
  Left extends TDependent<infer If extends TSchema, infer Then extends TSchema, infer Else extends TSchema> ? TExtendsDependent<Inferred, If, Then, Else, Right> :
  Left extends TEnum<infer Values extends TEnumValue[]> ? TExtendsEnum<Inferred, Values, Right> :
  Left extends TFunction<infer Parameters extends TSchema[], infer ReturnType extends TSchema> ? TExtendsFunction<Inferred, Parameters, ReturnType, Right> :
  Left extends TInteger ? TExtendsInteger<Inferred, Left, Right> :
  Left extends TIntersect<infer Types extends TSchema[]> ? TExtendsIntersect<Inferred, Types, Right> :
  Left extends TLiteral ? TExtendsLiteral<Inferred, Left, Right> :
  Left extends TNever ? TExtendsNever<Inferred, Left, Right> :
  Left extends TNull ? TExtendsNull<Inferred, Left, Right> :
  Left extends TNumber ? TExtendsNumber<Inferred, Left, Right> :
  Left extends TObject<infer Properties extends TProperties> ? TExtendsObject<Inferred, Properties, Right> :
  Left extends TRecord<infer Pattern extends string, infer Value extends TSchema> ? TExtendsRecord<Inferred, Pattern, Value, Right> :
  Left extends TString ? TExtendsString<Inferred, Left, Right> :
  Left extends TSymbol ? TExtendsSymbol<Inferred, Left, Right> :
  Left extends TTemplateLiteral<infer Pattern extends string> ? TExtendsTemplateLiteral<Inferred, Pattern, Right> :
  Left extends TTuple<infer Types extends TSchema[]> ? TExtendsTuple<Inferred, Types, Right> :
  Left extends TUndefined ? TExtendsUndefined<Inferred, Left, Right> :
  Left extends TUnion<infer Types extends TSchema[]> ? TExtendsUnion<Inferred, Types, Right> :
  Left extends TUnknown ? TExtendsUnknown<Inferred, Left, Right> :
  Left extends TVoid ? TExtendsVoid<Inferred, Left, Right> :
  Result.TExtendsFalse
)
export function ExtendsLeft<Inferred extends TProperties, Left extends TSchema, Right extends TSchema>
  (inferred: Inferred, left: Left, right: Right): 
    TExtendsLeft<Inferred, Left, Right> {
  return (
    IsAny(left) ? ExtendsAny(inferred, left, right) :
    IsArray(left) ? ExtendsArray(inferred, left, left.items, right) :
    IsBigInt(left) ? ExtendsBigInt(inferred, left, right) :
    IsBoolean(left) ? ExtendsBoolean(inferred, left, right) :
    IsConstructor(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) :
    IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) :
    IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) :
    IsFunction(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) :
    IsInteger(left) ? ExtendsInteger(inferred, left, right) :
    IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) :
    IsLiteral(left) ? ExtendsLiteral(inferred, left, right) :
    IsNever(left) ? ExtendsNever(inferred, left, right) :
    IsNull(left) ? ExtendsNull(inferred, left, right) :
    IsNumber(left) ? ExtendsNumber(inferred, left, right) :
    IsObject(left) ? ExtendsObject(inferred, left.properties, right) :
    IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) :
    IsString(left) ? ExtendsString(inferred, left, right) :
    IsSymbol(left) ? ExtendsSymbol(inferred, left, right) :
    IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) :
    IsTuple(left) ? ExtendsTuple(inferred, left.items, right) :
    IsUndefined(left) ? ExtendsUndefined(inferred, left, right) :
    IsUnion(left) ? ExtendsUnion(inferred, left.anyOf, right) :
    IsUnknown(left) ? ExtendsUnknown(inferred, left, right) :
    IsVoid(left) ? ExtendsVoid(inferred, left, right) :
    Result.ExtendsFalse()
  ) as never
}