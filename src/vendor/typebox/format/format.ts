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

export * from './_registry'

export { IsDateTime } from './date_time'
export { IsDate } from './date'
export { IsDuration } from './duration'
export { IsEmail } from './email'
export { IsHostname } from './hostname'
export { IsIdnEmail } from './idn_email'
export { IsIdnHostname } from './idn_hostname'
export { IsIPv4 } from './ipv4'
export { IsIPv6 } from './ipv6'
export { IsIriReference } from './iri_reference'
export { IsIri } from './iri'
export { IsJsonPointerUriFragment } from './json_pointer_uri_fragment'
export { IsJsonPointer } from './json_pointer'
export { IsRegex } from './regex'
export { IsRelativeJsonPointer } from './relative_json_pointer'
export { IsTime } from './time'
export { IsUriReference } from './uri_reference'
export { IsUriTemplate } from './uri_template'
export { IsUri } from './uri'
export { IsUrl } from './url'
export { IsUuid } from './uuid'
