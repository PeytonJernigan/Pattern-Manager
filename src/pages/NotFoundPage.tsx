import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return <main className="page not-found"><Compass /><p className="eyebrow">404</p><h1>That page wandered off.</h1><p>The pattern or project may have moved, or the address may be incomplete.</p><Link className="button button--primary" to="/">Return home</Link></main>
}
