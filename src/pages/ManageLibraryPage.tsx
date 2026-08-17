import { BookOpenCheck, Database, FileUp, KeyRound, ShieldCheck, TerminalSquare } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppData } from '@/lib/data'

export default function ManageLibraryPage() {
  const { user, dashboard } = useAppData()
  if (user?.role !== 'owner') return <main className="page"><h1>Owner access required</h1><p>Only the library owner can run a bulk catalog import.</p><Link to="/">Return home</Link></main>
  return <main className="page manage-page">
    <header className="page-header"><div><p className="eyebrow">Private administration</p><h1>Manage library data</h1><p>Add individual records in the app, or run the protected local importer for a full catalog refresh.</p></div><Link className="button button--primary" to="/patterns/new"><FileUp />Add one pattern</Link></header>
    <section className="dashboard-metrics" aria-label="Current database totals"><div><Database /><span><strong>{dashboard.totals.patterns}</strong><small>patterns available</small></span></div><div><BookOpenCheck /><span><strong>{dashboard.totals.crochet}</strong><small>crochet</small></span></div><div><BookOpenCheck /><span><strong>{dashboard.totals.knit}</strong><small>knit</small></span></div></section>
    <div className="manage-grid">
      <article className="content-card"><span className="feature-icon"><ShieldCheck /></span><h2>Safe bulk import</h2><p>The catalog importer runs only on your own computer. It uploads files directly to private storage and never sends a service key to Netlify or the browser.</p><ul className="check-list"><li>Dry-run is the default</li><li>Stable PAT IDs are preserved</li><li>PDFs are deduplicated by checksum</li><li>Reruns resume without replacing personal edits</li></ul></article>
      <article className="content-card"><span className="feature-icon"><TerminalSquare /></span><h2>After Supabase is connected</h2><ol className="numbered-list"><li>Invite the two household accounts.</li><li>Copy the household ID from the setup query.</li><li>Run the importer locally with <strong>--dry-run</strong>.</li><li>Review its outside-the-repository report.</li><li>Run again with <strong>--apply --resume</strong>.</li></ol><p className="muted">The complete command is in the repository setup guide.</p></article>
      <article className="content-card content-card--wide"><div className="section-heading"><div><h2><KeyRound />Why this is not a browser upload</h2><p>The catalog contains hundreds of files and private filesystem paths. Keeping the administrative credential in a one-time local tool prevents anyone inspecting the public website from gaining elevated database access.</p></div></div></article>
    </div>
  </main>
}
