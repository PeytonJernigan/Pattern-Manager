import { LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/lib/auth'

export default function UnauthorizedPage() {
  const { signOut } = useAuth()
  const [message, setMessage] = useState<string | null>(null)
  const leave = async () => {
    const error = await signOut()
    if (error) setMessage('Sign-out failed. Check your connection and try again.')
  }
  return <main className="centered-state"><LockKeyhole /><h1>This account is not a household member</h1><p>The database correctly denied access. Sign in with one of the two invited accounts.</p>{message && <p role="alert">{message}</p>}<button className="button button--primary" type="button" onClick={() => void leave()}>Return to sign in</button></main>
}
