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

import { IsDateTime } from './date_time'
import { IsDate } from './date'
import { IsDuration } from './duration'
import { IsEmail } from './email'
import { IsHostname } from './hostname'
import { IsIdnEmail } from './idn_email'
import { IsIdnHostname } from './idn_hostname'
import { IsIPv4 } from './ipv4'
import { IsIPv6 } from './ipv6'
import { IsIriReference } from './iri_reference'
import { IsIri } from './iri'
import { IsJsonPointerUriFragment } from './json_pointer_uri_fragment'
import { IsJsonPointer } from './json_pointer'
import { IsRegex } from './regex'
import { IsRelativeJsonPointer } from './relative_json_pointer'
import { IsTime } from './time'
import { IsUriReference } from './uri_reference'
import { IsUriTemplate } from './uri_template'
import { IsUri } from './uri'
import { IsUrl } from './url'
import { IsUuid } from './uuid'

// ------------------------------------------------------------------
// FormatCheckFunction
// ------------------------------------------------------------------
export type TFormatCheckFunction = (value: string) => boolean

// ------------------------------------------------------------------
// Formats
// ------------------------------------------------------------------
const formats = new Map<string, TFormatCheckFunction>()

// ------------------------------------------------------------------
// Clear
// ------------------------------------------------------------------
/** Clears all entries */
export function Clear(): void {
  formats.clear()
}

// ------------------------------------------------------------------
// Entries
// ------------------------------------------------------------------
/** Returns format entries in this registry */
export function Entries(): [string, TFormatCheckFunction][] {
  return [...formats.entries()]
}

// ------------------------------------------------------------------
// Set
// ------------------------------------------------------------------
/** Sets a format */
export function Set(format: string, check: TFormatCheckFunction): void {
  formats.set(format, check)
}

// ------------------------------------------------------------------
// Has
// ------------------------------------------------------------------
/** Returns true if the registry has this format */
export function Has(format: string): boolean {
  return formats.has(format)
}

// ------------------------------------------------------------------
// Get
// ------------------------------------------------------------------
/** Gets a format or undefined if not exists */
export function Get(format: string): TFormatCheckFunction | undefined {
  return formats.get(format)
}
// ------------------------------------------------------------------
// Test
// ------------------------------------------------------------------
/** Tests a value against a format, if the format is not registered, true */
export function Test(format: string, value: string): boolean {
  return formats.get(format)?.(value) ?? true
}

// ------------------------------------------------------------------
// Reset
// ------------------------------------------------------------------
/** Resets all formats to defaults */
export function Reset(): void {
  Clear()
  formats.set('date-time', IsDateTime)
  formats.set('date', IsDate)
  formats.set('duration', IsDuration)
  formats.set('email', IsEmail)
  formats.set('hostname', IsHostname)
  formats.set('idn-email', IsIdnEmail)
  formats.set('idn-hostname', IsIdnHostname)
  formats.set('ipv4', IsIPv4)
  formats.set('ipv6', IsIPv6)
  formats.set('iri-reference', IsIriReference)
  formats.set('iri', IsIri)
  formats.set('json-pointer-uri-fragment', IsJsonPointerUriFragment)
  formats.set('json-pointer', IsJsonPointer)
  formats.set('regex', IsRegex)
  formats.set('relative-json-pointer', IsRelativeJsonPointer)
  formats.set('time', IsTime)
  formats.set('uri-reference', IsUriReference)
  formats.set('uri-template', IsUriTemplate)
  formats.set('uri', IsUri)
  formats.set('url', IsUrl)
  formats.set('uuid', IsUuid)
}
Reset()
