import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, unauthorized, error } = useAuth()
  const location = useLocation()
  if (loading) return <div className="app-loading" role="status"><span className="spinner" />Opening your private library…</div>
  if (error) return <main className="centered-state" role="alert"><h1>We could not verify this sign-in</h1><p>{error}</p><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Try again</button></main>
  if (unauthorized) return <Navigate to="/unauthorized" replace />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}
