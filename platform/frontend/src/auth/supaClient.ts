// The Supabase client used ONLY for Microsoft SSO sign-in.
//
// Its one job is the handshake: send the user to Entra (signInWithSSO) and
// catch the session that lands back in the URL. The moment that session is
// exchanged for the builder's own cookie (/api/auth/sso-login), the app runs
// on the cookie as it always has — this client is not used for data.
//
// Created lazily from /api/auth/config values, so with SSO off the library
// never initializes and the app behaves exactly as before.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface AuthConfig {
  sso: boolean
  sso_domain: string
  supabase_url: string
  publishable_key: string
  password_login: boolean
}

let client: SupabaseClient | null = null

export function getSupa(cfg: AuthConfig): SupabaseClient {
  if (!client) {
    client = createClient(cfg.supabase_url, cfg.publishable_key, {
      auth: {
        // Builder-specific key so this session never collides with any other
        // Supabase-backed app the person has open (e.g. CreativeOPS).
        storageKey: 'creative-builder-auth',
        persistSession: true,
        autoRefreshToken: false, // the platform cookie owns the session
        detectSessionInUrl: true, // catches the tokens Entra redirects back with
      },
    })
  }
  return client
}
