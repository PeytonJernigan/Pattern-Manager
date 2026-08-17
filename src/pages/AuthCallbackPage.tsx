import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export default function AuthCallbackPage() {
  const { user, loading, unauthorized } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (loading) return
    if (unauthorized) navigate('/unauthorized', { replace: true })
    else navigate(user ? '/' : '/login', { replace: true })
  }, [loading, navigate, unauthorized, user])
  return <main className="app-loading" role="status"><span className="spinner" />Finishing private sign-in…</main>
}
