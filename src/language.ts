/// <reference path="./strudel.d.ts" />
// Side-effect module: loads Strudel's pattern language, the packages that put methods on Pattern, in order. Its
// declarations (strudel.d.ts) list those methods, including tonal's (.scale, .transpose, .voicing), so import this
// before building patterns with them. initStrudel() does; plain Node (tests) can import it on its own:
//
//   import 'rn-strudel/language';
//   import { n } from '@strudel/core';
//   n('0 2 4').scale('C:major');
//
// On React Native, 'rn-strudel/environment' still comes first.

import '@strudel/core';
import '@strudel/mini';
import '@strudel/tonal';

export {};
