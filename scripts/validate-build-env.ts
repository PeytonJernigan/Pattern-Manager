const isNetlifyBuild = process.env.NETLIFY === 'true'

if (isNetlifyBuild) {
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const
  const missing = required.filter((name) => !process.env[name]?.trim())
  if (missing.length) {
    const context = process.env.CONTEXT || 'unknown'
    throw new Error(
      `Refusing to build an unprotected Netlify ${context} deployment. Missing: ${missing.join(', ')}. `
      + 'Set variables for this deploy context, or disable that context until a separate Supabase project is configured.',
    )
  }
}

