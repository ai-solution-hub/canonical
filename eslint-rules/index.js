'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS plugin entry */

const noUncheckedSupabaseError = require('./no-unchecked-supabase-error');
const noSilentPromiseCatch = require('./no-silent-promise-catch');
const noUnvalidatedRouteInput = require('./no-unvalidated-route-input');
const noSupabaseRecordCast = require('./no-supabase-record-cast');
const noUnloggedTerminalCatch = require('./no-unlogged-terminal-catch');

module.exports = {
  rules: {
    'no-unchecked-supabase-error': noUncheckedSupabaseError,
    'no-silent-promise-catch': noSilentPromiseCatch,
    'no-unvalidated-route-input': noUnvalidatedRouteInput,
    'no-supabase-record-cast': noSupabaseRecordCast,
    'no-unlogged-terminal-catch': noUnloggedTerminalCatch,
  },
};
