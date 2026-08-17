import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, BookOpen, Save } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppData } from '@/lib/data'

export default function PatternFormPage() {
  const { patternId } = useParams()
  const editing = Boolean(patternId)
  const { getPattern, createPattern, updatePattern } = useAppData()
  const existing = patternId ? getPattern(patternId) : undefined
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '', craft: 'Crochet', category: '', itemType: '', itemSubtype: '', designer: '', publisher: '',
    description: '', sourceUrl: '', skillLevel: '', yarnWeight: '', sizeSummary: '', freeStatus: 'Unknown', accessStatus: 'Unknown', tags: '',
  })

  useEffect(() => {
    if (!existing) return
    setForm({ title: existing.title, craft: existing.craft, category: existing.category ?? '', itemType: existing.itemType ?? '', itemSubtype: existing.itemSubtype ?? '',
      designer: existing.designer ?? '', publisher: existing.publisher ?? '', description: existing.description ?? '', sourceUrl: existing.sourceUrl ?? '',
      skillLevel: existing.skillLevel ?? '', yarnWeight: existing.yarnWeight ?? '', sizeSummary: existing.sizeSummary ?? '', freeStatus: existing.freeStatus ?? 'Unknown',
      accessStatus: existing.accessStatus ?? 'Unknown', tags: existing.tags.join(', ') })
  }, [existing])

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      if (existing) {
        await updatePattern(existing.id, { title: form.title.trim(), craft: form.craft, category: form.category || null, itemType: form.itemType || null,
          itemSubtype: form.itemSubtype || null, designer: form.designer || null, publisher: form.publisher || null, description: form.description || null,
          sourceUrl: form.sourceUrl || null, skillLevel: form.skillLevel || null, yarnWeight: form.yarnWeight || null, sizeSummary: form.sizeSummary || null,
          freeStatus: form.freeStatus, accessStatus: form.accessStatus, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) })
        navigate(`/patterns/${existing.id}`)
      } else {
        const pattern = await createPattern({ title: form.title.trim(), craft: form.craft, category: form.category || null, itemType: form.itemType || null, description: form.description || null, sourceUrl: form.sourceUrl || null })
        await updatePattern(pattern.id, { itemSubtype: form.itemSubtype || null, designer: form.designer || null, publisher: form.publisher || null,
          skillLevel: form.skillLevel || null, yarnWeight: form.yarnWeight || null, sizeSummary: form.sizeSummary || null, freeStatus: form.freeStatus,
          accessStatus: form.accessStatus, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) })
        navigate(`/patterns/${pattern.id}`)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The pattern could not be saved.') }
    finally { setBusy(false) }
  }

  if (editing && !existing) return <main className="page"><h1>Pattern not found</h1><Link to="/patterns">Back to the library</Link></main>

  return <main className="page form-page">
    <Link className="back-link" to={existing ? `/patterns/${existing.id}` : '/patterns'}><ArrowLeft />Back</Link>
    <header><span className="form-page__icon"><BookOpen /></span><div><p className="eyebrow">{editing ? 'Update catalog record' : 'Add to the shared library'}</p><h1>{editing ? `Edit ${existing?.title}` : 'Add a pattern'}</h1><p>Store enough detail to find it later. A private PDF can be attached from the saved pattern page.</p></div></header>
    <form className="editor-form" onSubmit={submit}>
      <section className="form-section"><h2>Basics</h2><div className="form-grid">
        <label className="span-2">Pattern title<input required value={form.title} onChange={(e) => set('title', e.target.value)} /></label>
        <label>Craft<select value={form.craft} onChange={(e) => set('craft', e.target.value)}><option>Crochet</option><option>Knit</option><option>Sewing</option><option>Embroidery</option><option>Quilting</option><option>Art</option><option>DIY</option><option>Other</option></select></label>
        <label>Category<input value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Garments, home, toys…" /></label>
        <label>Item type<input value={form.itemType} onChange={(e) => set('itemType', e.target.value)} placeholder="Cardigan" /></label>
        <label>Subtype<input value={form.itemSubtype} onChange={(e) => set('itemSubtype', e.target.value)} placeholder="Longline cardigan" /></label>
      </div></section>
      <section className="form-section"><h2>Credits and source</h2><div className="form-grid">
        <label>Designer<input value={form.designer} onChange={(e) => set('designer', e.target.value)} /></label><label>Publisher<input value={form.publisher} onChange={(e) => set('publisher', e.target.value)} /></label>
        <label className="span-2">Public source URL<input type="url" value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="https://…" /></label>
        <label>Free pattern?<select value={form.freeStatus} onChange={(e) => set('freeStatus', e.target.value)}><option>Yes</option><option>No</option><option>Conditional</option><option>Historically Free</option><option>Unknown</option></select></label>
        <label>Availability<select value={form.accessStatus} onChange={(e) => set('accessStatus', e.target.value)}><option>Available</option><option>Unavailable</option><option>Purchased</option><option>Membership</option><option>Unknown</option></select></label>
      </div></section>
      <section className="form-section"><h2>Making details</h2><div className="form-grid">
        <label>Skill level<input value={form.skillLevel} onChange={(e) => set('skillLevel', e.target.value)} /></label><label>Yarn weight<input value={form.yarnWeight} onChange={(e) => set('yarnWeight', e.target.value)} /></label>
        <label className="span-2">Sizes<input value={form.sizeSummary} onChange={(e) => set('sizeSummary', e.target.value)} placeholder="XS–5XL; include every published size" /></label>
        <label className="span-2">Search tags<input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="lace, spring, top-down, gifts" /><small>Separate tags with commas.</small></label>
        <label className="span-2">Description<textarea rows={8} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Describe the object, construction, fit, use, texture, and notable details." /></label>
      </div></section>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      <footer className="form-actions"><Link className="button" to={existing ? `/patterns/${existing.id}` : '/patterns'}>Cancel</Link><button className="button button--primary" disabled={busy} type="submit"><Save />{busy ? 'Saving…' : 'Save pattern'}</button></footer>
    </form>
  </main>
}
