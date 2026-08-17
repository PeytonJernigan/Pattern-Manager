import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, FolderKanban, Save } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAppData } from '@/lib/data'
import type { CreativeProject, ProjectStatus, ProjectVisibility } from '@/lib/types'

export default function ProjectFormPage() {
  const { projectId } = useParams()
  const [search] = useSearchParams()
  const { patterns, getProject, createProject, updateProject, preferences } = useAppData()
  const existing = projectId ? getProject(projectId) : undefined
  const editing = Boolean(projectId)
  const selectedPattern = patterns.find((pattern) => pattern.id === search.get('pattern'))
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ title: selectedPattern ? `My ${selectedPattern.title}` : '', craft: selectedPattern?.craft ?? preferences.defaultCraft ?? 'Crochet',
    patternId: selectedPattern?.id ?? '', status: 'planned' as ProjectStatus, visibility: preferences.defaultProjectVisibility as ProjectVisibility,
    progress: 0, currentSection: '', sizeLabel: '', colorway: '', startDate: '', targetDate: '', notes: '' })

  useEffect(() => {
    if (!existing) return
    setForm({ title: existing.title, craft: existing.craft, patternId: existing.patternId ?? '', status: existing.status, visibility: existing.visibility,
      progress: existing.progress, currentSection: existing.currentSection ?? '', sizeLabel: existing.sizeLabel ?? '', colorway: existing.colorway ?? '',
      startDate: existing.startDate ?? '', targetDate: existing.targetDate ?? '', notes: existing.notes ?? '' })
  }, [existing])
  const set = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      if (existing) {
        const updates: Partial<CreativeProject> = { title: form.title.trim(), craft: form.craft, patternId: form.patternId || null,
          status: form.status, visibility: form.visibility, progress: form.progress, currentSection: form.currentSection || null,
          sizeLabel: form.sizeLabel || null, colorway: form.colorway || null, startDate: form.startDate || null, targetDate: form.targetDate || null, notes: form.notes || null }
        await updateProject(existing.id, updates); navigate(`/projects/${existing.id}`)
      } else {
        const project = await createProject({ title: form.title.trim(), craft: form.craft, patternId: form.patternId || null, visibility: form.visibility, status: form.status, notes: form.notes || null })
        await updateProject(project.id, { progress: form.progress, currentSection: form.currentSection || null, sizeLabel: form.sizeLabel || null,
          colorway: form.colorway || null, startDate: form.startDate || null, targetDate: form.targetDate || null })
        navigate(`/projects/${project.id}`)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The project could not be saved.') }
    finally { setBusy(false) }
  }
  if (editing && !existing) return <main className="page"><h1>Project not found</h1><Link to="/projects">Back to projects</Link></main>

  return <main className="page form-page">
    <Link className="back-link" to={existing ? `/projects/${existing.id}` : '/projects'}><ArrowLeft />Back</Link>
    <header><span className="form-page__icon"><FolderKanban /></span><div><p className="eyebrow">Creative project tracker</p><h1>{editing ? `Edit ${existing?.title}` : 'Start a project'}</h1><p>Link a pattern or track any creative work on its own.</p></div></header>
    <form className="editor-form" onSubmit={submit}>
      <section className="form-section"><h2>Project</h2><div className="form-grid">
        <label className="span-2">Project name<input required value={form.title} onChange={(e) => set('title', e.target.value)} /></label>
        <label>Craft or project type<select value={form.craft} onChange={(e) => set('craft', e.target.value)}><option>Crochet</option><option>Knit</option><option>Sewing</option><option>Embroidery</option><option>Quilting</option><option>Art</option><option>DIY</option><option>Other</option></select></label>
        <label>Linked pattern<select value={form.patternId} onChange={(e) => { set('patternId', e.target.value); const pattern = patterns.find((item) => item.id === e.target.value); if (pattern) set('craft', pattern.craft) }}><option value="">No linked pattern</option>{patterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.title}</option>)}</select></label>
        <label>Status<select value={form.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}><option value="idea">Idea</option><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="paused">Paused</option><option value="complete">Complete</option><option value="abandoned">Abandoned</option><option value="archived">Archived</option></select></label>
        <label>Visibility<select value={form.visibility} onChange={(e) => set('visibility', e.target.value as ProjectVisibility)}><option value="household">Shared with household</option><option value="private">Private to me</option></select></label>
      </div></section>
      <section className="form-section"><h2>Progress and plan</h2><div className="form-grid">
        <label className="span-2 range-control">Progress <span>{form.progress}%</span><input type="range" min="0" max="100" value={form.progress} onChange={(e) => set('progress', Number(e.target.value))} /></label>
        <label>Current section<input value={form.currentSection} onChange={(e) => set('currentSection', e.target.value)} placeholder="Sleeve, row 42, finishing…" /></label>
        <label>Size<input value={form.sizeLabel} onChange={(e) => set('sizeLabel', e.target.value)} /></label>
        <label>Colorway / materials<input value={form.colorway} onChange={(e) => set('colorway', e.target.value)} /></label>
        <label>Start date<input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
        <label>Target date<input type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} /></label>
        <label className="span-2">Project notes<textarea rows={8} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Materials, changes, links, reminders, or anything else…" /></label>
      </div></section>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      <footer className="form-actions"><Link className="button" to={existing ? `/projects/${existing.id}` : '/projects'}>Cancel</Link><button className="button button--primary" disabled={busy} type="submit"><Save />{busy ? 'Saving…' : 'Save project'}</button></footer>
    </form>
  </main>
}
