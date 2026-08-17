import {
  Archive,
  ChevronDown,
  CircleCheck,
  Columns3,
  FolderKanban,
  Grid2X2,
  List,
  Plus,
  Search,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { EmptyState, LoadingGrid, PageHeader, ProjectCard, SearchField, StatusBadge } from '@/components/common'
import { useAppData } from '@/lib/data'
import type { CreativeProject, ProjectStatus } from '@/lib/types'

type ProjectView = 'grid' | 'board' | 'list'

const statusOptions: Array<{ value: '' | ProjectStatus; label: string }> = [
  { value: '', label: 'All projects' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'planned', label: 'Planned' },
  { value: 'idea', label: 'Ideas' },
  { value: 'paused', label: 'Paused' },
  { value: 'complete', label: 'Complete' },
  { value: 'archived', label: 'Archived' },
]

const boardColumns: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'idea', label: 'Ideas' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'complete', label: 'Complete' },
]

function matches(project: CreativeProject, query: string) {
  if (!query.trim()) return true
  const haystack = [project.title, project.craft, project.pattern?.title, project.currentSection, project.sizeLabel, project.colorway]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
  return query.toLocaleLowerCase().split(/\s+/).every((token) => haystack.includes(token))
}

export function ProjectsPage() {
  const { projects, loading } = useAppData()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState<'' | ProjectStatus>((params.get('status') as ProjectStatus | null) ?? '')
  const [craft, setCraft] = useState(params.get('craft') ?? '')
  const [visibility, setVisibility] = useState(params.get('visibility') ?? '')
  const [view, setView] = useState<ProjectView>('grid')

  const craftOptions = useMemo(
    () => [...new Set(projects.map((project) => project.craft).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [projects],
  )

  const visibleProjects = useMemo(
    () => projects.filter((project) =>
      matches(project, query) &&
      (!status || project.status === status) &&
      (!craft || project.craft === craft) &&
      (!visibility || project.visibility === visibility),
    ),
    [projects, query, status, craft, visibility],
  )

  const counts = useMemo(() => ({
    active: projects.filter((project) => project.status === 'in_progress').length,
    planned: projects.filter((project) => project.status === 'planned').length,
    complete: projects.filter((project) => project.status === 'complete').length,
  }), [projects])

  function syncParams(next: { query?: string; status?: '' | ProjectStatus; craft?: string; visibility?: string }) {
    const values = { query, status, craft, visibility, ...next }
    const updated = new URLSearchParams()
    if (values.query) updated.set('q', values.query)
    if (values.status) updated.set('status', values.status)
    if (values.craft) updated.set('craft', values.craft)
    if (values.visibility) updated.set('visibility', values.visibility)
    setParams(updated, { replace: true })
  }

  function resetFilters() {
    setQuery('')
    setStatus('')
    setCraft('')
    setVisibility('')
    setParams({}, { replace: true })
  }

  return (
    <div className="page projects-page">
      <PageHeader
        eyebrow="Every idea, in one place"
        title="Creative projects"
        description="Plan what comes next, track what is in progress, and keep every note, task, and milestone with the work."
        actions={<Link className="button button--primary" to="/projects/new"><Plus size={18} aria-hidden="true" /> New project</Link>}
      />

      <section className="project-summary" aria-label="Project summary">
        <button type="button" className={!status ? 'is-active' : ''} onClick={() => { setStatus(''); syncParams({ status: '' }) }}>
          <FolderKanban size={20} aria-hidden="true" />
          <span><strong>{projects.length}</strong><small>All projects</small></span>
        </button>
        <button type="button" className={status === 'in_progress' ? 'is-active' : ''} onClick={() => { setStatus('in_progress'); syncParams({ status: 'in_progress' }) }}>
          <span className="summary-dot summary-dot--coral" aria-hidden="true" />
          <span><strong>{counts.active}</strong><small>In progress</small></span>
        </button>
        <button type="button" className={status === 'planned' ? 'is-active' : ''} onClick={() => { setStatus('planned'); syncParams({ status: 'planned' }) }}>
          <span className="summary-dot summary-dot--gold" aria-hidden="true" />
          <span><strong>{counts.planned}</strong><small>Planned</small></span>
        </button>
        <button type="button" className={status === 'complete' ? 'is-active' : ''} onClick={() => { setStatus('complete'); syncParams({ status: 'complete' }) }}>
          <CircleCheck size={20} aria-hidden="true" />
          <span><strong>{counts.complete}</strong><small>Finished</small></span>
        </button>
      </section>

      <section className="project-controls" aria-label="Project search and filters">
        <SearchField
          value={query}
          onChange={(event) => { setQuery(event.target.value); syncParams({ query: event.target.value }) }}
          onClear={() => { setQuery(''); syncParams({ query: '' }) }}
          placeholder="Search projects, patterns, colors…"
          label="Search projects"
        />
        <label className="control-select">
          <span className="sr-only">Project status</span>
          <select value={status} onChange={(event) => { const next = event.target.value as '' | ProjectStatus; setStatus(next); syncParams({ status: next }) }}>
            {statusOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </label>
        <label className="control-select">
          <span className="sr-only">Project craft</span>
          <select value={craft} onChange={(event) => { setCraft(event.target.value); syncParams({ craft: event.target.value }) }}>
            <option value="">All crafts</option>
            {craftOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </label>
        <label className="control-select">
          <span className="sr-only">Project visibility</span>
          <select value={visibility} onChange={(event) => { setVisibility(event.target.value); syncParams({ visibility: event.target.value }) }}>
            <option value="">All visibility</option>
            <option value="household">Shared</option>
            <option value="private">Private</option>
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </label>
        <div className="view-switch" aria-label="Project view">
          <button type="button" className={view === 'grid' ? 'is-active' : ''} aria-label="Gallery view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={18} aria-hidden="true" /></button>
          <button type="button" className={view === 'board' ? 'is-active' : ''} aria-label="Board view" aria-pressed={view === 'board'} onClick={() => setView('board')}><Columns3 size={18} aria-hidden="true" /></button>
          <button type="button" className={view === 'list' ? 'is-active' : ''} aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={19} aria-hidden="true" /></button>
        </div>
      </section>

      <div className="project-results-heading">
        <p role="status" aria-live="polite"><strong>{visibleProjects.length}</strong> {visibleProjects.length === 1 ? 'project' : 'projects'}</p>
        {(query || status || craft || visibility) && <button className="text-button" type="button" onClick={resetFilters}>Clear filters</button>}
      </div>

      {loading ? (
        <LoadingGrid count={6} />
      ) : visibleProjects.length === 0 ? (
        projects.length ? (
          <EmptyState icon={Search} title="No projects match those filters" description="Try another search or clear the current filters." action={<button className="button button--primary" type="button" onClick={resetFilters}>Show all projects</button>} />
        ) : (
          <EmptyState icon={FolderKanban} title="Make a place for your next idea" description="Start from a library pattern or create a flexible blank project for any kind of creative work." action={<Link className="button button--primary" to="/projects/new"><Plus size={18} aria-hidden="true" /> Create first project</Link>} />
        )
      ) : view === 'grid' ? (
        <div className="project-grid">
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </div>
      ) : view === 'list' ? (
        <div className="project-list" role="list">
          {visibleProjects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`} className="project-list__row" role="listitem">
              <span className="project-list__icon" aria-hidden="true"><FolderKanban size={18} /></span>
              <span className="project-list__title"><strong>{project.title}</strong><small>{project.pattern?.title || project.craft}</small></span>
              <StatusBadge status={project.status} />
              <span className="project-list__progress"><span><i style={{ width: `${project.progress}%` }} /></span><strong>{Math.round(project.progress)}%</strong></span>
              <span className="project-list__visibility">{project.visibility === 'household' ? 'Shared' : 'Private'}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="project-board">
          {boardColumns.map((column) => {
            const columnProjects = visibleProjects.filter((project) => project.status === column.value)
            return (
              <section key={column.value} className="project-board__column" aria-labelledby={`board-${column.value}`}>
                <header><h2 id={`board-${column.value}`}>{column.label}</h2><span>{columnProjects.length}</span></header>
                <div>
                  {columnProjects.map((project) => (
                    <Link key={project.id} to={`/projects/${project.id}`} className="board-card">
                      <span className="board-card__craft">{project.craft}</span>
                      <strong>{project.title}</strong>
                      <small>{project.pattern?.title || project.currentSection || 'Creative project'}</small>
                      <span className="board-card__progress"><i style={{ width: `${project.progress}%` }} /></span>
                      <span>{Math.round(project.progress)}%</span>
                    </Link>
                  ))}
                  {columnProjects.length === 0 && <p className="board-empty">Nothing here yet</p>}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {status === 'archived' && visibleProjects.length > 0 && (
        <aside className="archive-note"><Archive size={18} aria-hidden="true" /><span>Archived projects stay safely out of the way and can be restored at any time.</span></aside>
      )}
    </div>
  )
}

export default ProjectsPage
