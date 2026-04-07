'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS plugin entry */

const noUncheckedSupabaseError = require('./no-unchecked-supabase-error');

module.exports = {
  rules: {
    'no-unchecked-supabase-error': noUncheckedSupabaseError,
  },
};
