import { useEffect, useState, type FormEvent } from 'react'
import { BookOpen, CalendarDays, Check, Edit3, NotebookPen, Play, Plus, Rows3, Spool, Timer, Trash2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useAppData } from '@/lib/data'
import type { ProjectNote, ProjectTask } from '@/lib/types'
import { relativeDate } from '@/lib/utils'

export default function ProjectDetailPage() {
  const { projectId } = useParams()
  const { getProject, updateProject, listProjectTasks, createProjectTask, toggleProjectTask, deleteProjectTask, listProjectNotes, createProjectNote } = useAppData()
  const project = projectId ? getProject(projectId) : undefined
  const [saving, setSaving] = useState(false)
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [notes, setNotes] = useState<ProjectNote[]>([])
  const [taskTitle, setTaskTitle] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    let active = true
    Promise.all([listProjectTasks(project.id), listProjectNotes(project.id)]).then(([nextTasks, nextNotes]) => {
      if (active) { setTasks(nextTasks); setNotes(nextNotes) }
    }).catch((reason: unknown) => { if (active) setMessage(reason instanceof Error ? reason.message : 'Project details could not be loaded.') })
    return () => { active = false }
  }, [listProjectNotes, listProjectTasks, project])

  if (!project) return <main className="page"><div className="empty-state"><h1>Project not found</h1><Link to="/projects">Return to projects</Link></div></main>
  const hasReader = Boolean(project.pattern?.primaryFileId)
  const updateProgress = async (progress: number) => { setSaving(true); await updateProject(project.id, { progress }); setSaving(false) }

  const addTask = async (event: FormEvent) => {
    event.preventDefault(); if (!taskTitle.trim()) return
    const task = await createProjectTask(project.id, taskTitle.trim()); setTasks((current) => [...current, task]); setTaskTitle('')
  }
  const toggleTask = async (task: ProjectTask) => {
    const next = await toggleProjectTask(task); setTasks((current) => current.map((item) => item.id === task.id ? next : item))
  }
  const removeTask = async (task: ProjectTask) => {
    await deleteProjectTask(task); setTasks((current) => current.filter((item) => item.id !== task.id))
  }
  const addNote = async (event: FormEvent) => {
    event.preventDefault(); if (!noteBody.trim()) return
    const note = await createProjectNote(project.id, noteBody.trim()); setNotes((current) => [note, ...current]); setNoteBody('')
  }

  return <main className="page project-detail">
    <nav className="breadcrumbs"><Link to="/projects">Projects</Link><span>/</span><span>{project.title}</span></nav>
    <header className="project-hero"><div className="project-cover"><Spool /></div><div><div className="badge-row"><span className={`status-chip status-chip--${project.status}`}>{project.status.replace('_', ' ')}</span><span className="badge">{project.craft}</span><span className="badge">{project.visibility}</span></div><h1>{project.title}</h1><p>{project.pattern ? <>Based on <Link to={`/patterns/${project.pattern.id}`}>{project.pattern.title}</Link></> : 'A standalone creative project'}</p><div className="action-row">{hasReader ? <Link className="button button--primary" to={`/projects/${project.id}/reader`}><Play />Continue pattern</Link> : project.pattern ? <Link className="button button--primary" to={`/patterns/${project.pattern.id}`}><BookOpen />Attach PDF</Link> : null}<Link className="button" to={`/projects/${project.id}/edit`}><Edit3 />Edit project</Link></div></div></header>
    {message && <p className="form-message" role="alert">{message}</p>}
    <section className="project-progress content-card"><div className="section-heading"><div><p className="eyebrow">Overall progress</p><h2>{project.progress}% complete</h2></div><span>{saving ? 'Saving…' : 'Saved'}</span></div><input aria-label="Project progress" type="range" min="0" max="100" value={project.progress} onChange={(event) => void updateProgress(Number(event.target.value))} /><div className="progress-track"><span style={{ width: `${project.progress}%` }} /></div></section>
    <section className="detail-grid">
      <article className="content-card"><h2><Rows3 />Current place</h2><p className="big-callout">{project.currentSection || 'Choose a section in the reader'}</p><p>Named row and repeat counters stay with this project, even if the pattern is reused.</p>{hasReader && <Link className="text-link" to={`/projects/${project.id}/reader`}>Open counters and marks</Link>}</article>
      <article className="content-card"><h2><CalendarDays />Plan</h2><dl className="metadata-list"><div><dt>Started</dt><dd>{project.startDate || 'Not set'}</dd></div><div><dt>Target</dt><dd>{project.targetDate || 'No deadline'}</dd></div><div><dt>Size</dt><dd>{project.sizeLabel || 'Not selected'}</dd></div><div><dt>Colorway</dt><dd>{project.colorway || 'Not recorded'}</dd></div></dl></article>
      <article className="content-card project-checklist"><h2><Check />Next steps</h2><form className="inline-add" onSubmit={addTask}><input aria-label="New task" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Add a next step…" /><button type="submit" aria-label="Add task"><Plus /></button></form>{tasks.length ? <ul>{tasks.map((task) => <li key={task.id} className={task.completed ? 'is-complete' : ''}><button className="task-toggle" type="button" onClick={() => void toggleTask(task)} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}><Check /></button><span>{task.title}</span><button className="task-delete" type="button" onClick={() => void removeTask(task)} aria-label={`Delete ${task.title}`}><Trash2 /></button></li>)}</ul> : <p className="empty-copy">Add materials, sections, finishing, blocking, or any other step.</p>}</article>
      <article className="content-card project-journal"><h2><NotebookPen />Project journal</h2><form onSubmit={addNote}><textarea aria-label="New journal entry" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} rows={3} placeholder="Record a decision, adjustment, idea, or link…" /><button className="button button--secondary" type="submit"><Plus />Add entry</button></form>{notes.length ? <ol>{notes.slice(0, 6).map((note) => <li key={note.id}><p>{note.body}</p><time dateTime={note.createdAt}>{relativeDate(note.createdAt)}</time></li>)}</ol> : project.notes ? <p>{project.notes}</p> : <p className="empty-copy">Journal entries become a searchable history of this project.</p>}</article>
      <article className="content-card content-card--wide"><h2><Timer />Activity</h2><p>Progress, counter changes, checklist work, journal entries, annotations, and completion milestones remain connected to this project.</p></article>
    </section>
  </main>
}
