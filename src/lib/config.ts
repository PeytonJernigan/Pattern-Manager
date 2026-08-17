const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim() ?? ''

export const appConfig = {
  appName: import.meta.env.VITE_APP_NAME?.trim() || "Jadyn's Pattern Manager",
  supabaseUrl,
  supabaseAnonKey,
  demoMode: import.meta.env.VITE_DEMO_MODE === 'true' || !supabaseUrl || !supabaseAnonKey,
  maxUploadMb: Number(import.meta.env.VITE_MAX_UPLOAD_MB || 125),
  sentryDsn: import.meta.env.VITE_SENTRY_DSN?.trim() || null,
}

export function assertProductionConfiguration() {
  if (import.meta.env.PROD && appConfig.demoMode && import.meta.env.VITE_ALLOW_PRODUCTION_DEMO !== 'true') {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Netlify.')
  }
}
