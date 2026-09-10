import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client, and the rule that it may be absent.
 *
 * Supabase is the system of record: the Ministry list, the station master, the
 * officers, the plan and the audit log all live there. But the application has
 * to build and run before a project exists, on a machine with no credentials,
 * and a clone that cannot start is a clone nobody can review.
 *
 * So `supabase` is null when the environment is not configured, and every
 * caller must handle that. The fallbacks are not degraded modes bolted on -
 * they are the paths that already existed:
 *
 *   identity   -> the localStorage session, which gates the interface
 *   plan       -> public/data/plan.json, the artefact the engine writes
 *
 * That is also why the plan is read at BUILD time rather than per request. It
 * changes when a planner re-solves, not when a page is opened, so prerendering
 * it costs nothing in freshness and means a cold database cannot take the
 * planner down. Identity, approval and audit are read live, because a stale
 * approval status is worse than no approval status.
 *
 * ANON KEY. The publishable key is designed to sit in client code; it grants
 * nothing on its own because every table is RLS-enabled and every policy tests
 * auth.uid(). The service-role key bypasses RLS and must never appear here,
 * in the repository, or in anything sent to a browser.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        //  The sign-in page is a normal form, not a magic-link callback.
        detectSessionInUrl: false,
      },
    })
  : null;
