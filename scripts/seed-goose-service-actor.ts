#!/usr/bin/env bun
/**
 * Seeds the dedicated goose headless service-actor (ID-71.26 G2).
 *
 * The goose pilot (run-pilot.sh) password-grants a SHORT-LIVED Supabase OAuth
 * bearer for THIS user, then calls the remote KH MCP server with
 * `X-MCP-Actor: headless` — the `editor` role earns propose-writes (drafts),
 * publication stays human-gated (B-INV-6). This is the SAME provisioning path
 * as scripts/seed-e2e-users.ts (auth.admin.createUser → user_roles upsert).
 *
 * TARGET = whatever NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL points at. For the
 * staging-first pilot that is the Platform STAGING DB (rbwqew, the .env.local
 * default). At G6 adopt, re-run against the Platform PROD DB (zjqbr) with that
 * project's URL + service-role key.
 *
 * Env required: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Args: --email <addr> (default goose-pilot@aisolutionhub.co.uk)
 *       --password <pw> (default: generated; printed ONCE so the operator can
 *                        set GOOSE_SERVICE_ACTOR_PASSWORD in Coolify).
 *       --dry-run
 *
 * Idempotent: existing user is detected and left unchanged (password NOT reset);
 * the `editor` role is upserted every run. On an existing user with no --password,
 * the script cannot surface a usable password — re-run with --password or reset
 * in the Supabase UI.
 */
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { parseArgs } from 'util';
import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs';

function loadEnv(): void {
  let dir = process.cwd();
  while (dir !== '/') {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          const eq = t.indexOf('=');
          if (eq === -1) continue;
          const k = t.slice(0, eq).trim();
          let v = t.slice(eq + 1).trim();
          if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
          ) {
            v = v.slice(1, -1);
          }
          if (!(k in process.env)) process.env[k] = v;
        }
      }
    }
    dir = path.dirname(dir);
  }
}

loadEnv();

const { values } = parseArgs({
  options: {
    email: { type: 'string', default: 'goose-pilot@aisolutionhub.co.uk' },
    password: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    '❌ Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

const email = values.email!;
// Coolify-safe generated password (no shell/JSON-special chars): hex + symbols.
const password =
  values.password ?? `Gp_${randomBytes(24).toString('base64url')}`;
const dryRun = values['dry-run'] ?? false;

const supabase = createScriptClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findByEmail(addr: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const found = data.users.find((u) => u.email === addr);
  return found ? { id: found.id } : null;
}

async function main(): Promise<void> {
  console.log(
    `\n🪿 goose service-actor → ${url}\n   email: ${email}${dryRun ? '\n   (dry-run)' : ''}\n`,
  );

  const existing = await findByEmail(email);
  let userId: string;
  let created = false;

  if (existing) {
    userId = existing.id;
    console.log(
      '➖ user already exists — leaving auth row + password unchanged',
    );
  } else if (dryRun) {
    console.log('✨ would create user (dry-run)');
    return;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'Goose Headless Pilot',
        display_name: 'Goose Headless Pilot',
        seeded_by: 'scripts/seed-goose-service-actor.ts',
        service_actor: true,
      },
    });
    if (error || !data.user)
      throw new Error(`createUser failed: ${error?.message ?? 'no user'}`);
    userId = data.user.id;
    created = true;
    console.log('✨ created auth user');
  }

  if (!dryRun) {
    const { error: roleErr } = await supabase
      .from('user_roles')
      .upsert({ user_id: userId, role: 'editor' }, { onConflict: 'user_id' });
    if (roleErr)
      throw new Error(`user_roles upsert failed: ${roleErr.message}`);
    console.log('✅ editor role upserted');
  }

  console.log('\n── Coolify env for the kh-goose-pilot app ──');
  console.log(`GOOSE_SERVICE_ACTOR_EMAIL=${email}`);
  if (created) {
    console.log(`GOOSE_SERVICE_ACTOR_PASSWORD=${password}`);
    console.log(
      '   ↳ printed ONCE — set it in Coolify now; it is not stored anywhere else.',
    );
  } else if (values.password) {
    console.log(
      `GOOSE_SERVICE_ACTOR_PASSWORD=${password}  (you supplied this; unchanged on the existing user)`,
    );
  } else {
    console.log(
      'GOOSE_SERVICE_ACTOR_PASSWORD=<unknown — existing user; re-run with --password to set a known one>',
    );
  }
  console.log(`\n(user id: ${userId})\n`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
