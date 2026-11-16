/// <reference path="./strudel.d.ts" />
// Side-effect module: sets up Strudel's pattern language the way the Strudel REPL has it, as soon as it's imported:
//  - loads the packages that put methods on Pattern, in order: core, mini, tonal (.scale, .transpose, .voicing). Their
//    declarations (strudel.d.ts) list those methods.
//  - makes plain strings parse as mini-notation (miniAllStrings), so s('bd*4') is four events, not one sound named
//    "bd*4". A pattern takes its strings as it's built, so a module that builds patterns as it loads needs this first.
//
// initStrudel() imports it. Import it yourself before building patterns earlier than that, or in plain Node (tests):
//
//   import 'rn-strudel/language';
//   import { n } from '@strudel/core';
//   n('0 2 4').scale('C:major');
//
// On React Native, 'rn-strudel/environment' still comes first.

import '@strudel/core';
import { miniAllStrings } from '@strudel/mini';
import '@strudel/tonal';

miniAllStrings();

export {};
