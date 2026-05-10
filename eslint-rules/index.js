'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS plugin entry */

const noUncheckedSupabaseError = require('./no-unchecked-supabase-error');
const noSilentPromiseCatch = require('./no-silent-promise-catch');
const noUnvalidatedRouteInput = require('./no-unvalidated-route-input');

module.exports = {
  rules: {
    'no-unchecked-supabase-error': noUncheckedSupabaseError,
    'no-silent-promise-catch': noSilentPromiseCatch,
    'no-unvalidated-route-input': noUnvalidatedRouteInput,
  },
};
