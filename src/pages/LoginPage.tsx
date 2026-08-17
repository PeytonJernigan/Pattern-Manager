import { useState, type FormEvent } from 'react'
import { BookOpenCheck, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { appConfig } from '@/lib/config'

export default function LoginPage() {
  const { user, signIn, sendMagicLink, demoMode, error: authError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'magic'>('magic')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  if (user) return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null)
    const error = mode === 'password' ? await signIn(email, password) : await sendMagicLink(email)
    setBusy(false)
    if (error) setMessage(error.message)
    else if (mode === 'magic') setMessage('Check your email for the private sign-in link.')
    else navigate((location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/')
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand-mark"><BookOpenCheck aria-hidden="true" /></div>
        <p className="eyebrow">A private creative workbench</p>
        <h1>{appConfig.appName}</h1>
        <p>Keep every pattern, project, row count, note, and “stopped here” marker in one calm place.</p>
        <ul><li><ShieldCheck />Invite-only household access</li><li><BookOpenCheck />Private PDFs with project-specific marks</li><li><KeyRound />Settings that follow each maker</li></ul>
      </section>
      <section className="login-card" aria-labelledby="login-heading">
        <div><p className="eyebrow">Welcome back</p><h2 id="login-heading">Open the library</h2><p>Only the two invited household accounts can continue.</p></div>
        {demoMode && <div className="demo-banner"><strong>Preview mode</strong><span>Supabase is not connected yet. Sign in opens local demo data only.</span></div>}
        <form onSubmit={submit}>
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          {mode === 'password' && <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          {(message || authError) && <p className="form-message" role="status">{message || authError}</p>}
          <button className="button button--primary" disabled={busy} type="submit">{busy ? 'Checking…' : mode === 'password' ? 'Sign in' : 'Email my sign-in link'}</button>
        </form>
        <button className="text-button" type="button" onClick={() => { setMode((value) => value === 'password' ? 'magic' : 'password'); setMessage(null) }}><Mail aria-hidden="true" />{mode === 'password' ? 'Use an email link instead' : 'Use my password instead'}</button>
      </section>
    </main>
  )
}
