import { createClient } from '@supabase/supabase-js'
import { appConfig } from './config'

export const supabase = appConfig.demoMode
  ? null
  : createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'pattern-manager-auth',
      },
      global: {
        headers: { 'x-client-info': 'pattern-manager-web/1.0' },
      },
    })

export function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured for this environment.')
  return supabase
}
