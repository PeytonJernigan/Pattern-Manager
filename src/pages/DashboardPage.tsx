import {
  ArrowRight,
  BookOpen,
  Check,
  FolderKanban,
  ListChecks,
  Palette,
  Play,
  Plus,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { EmptyState, LoadingGrid, PageHeader, PatternCard, ProjectCard } from '@/components/common'
import { useAppData } from '@/lib/data'

function firstName(displayName?: string) {
  return displayName?.trim().split(/\s+/)[0] || 'Maker'
}

export function DashboardPage() {
  const { user, dashboard, loading, toggleFavorite } = useAppData()
  const activeProjects = dashboard?.activeProjects ?? []
  const featuredProject = activeProjects[0]
  const remainingProjects = activeProjects.slice(1, 4)
  const recentPatterns = dashboard?.recentPatterns ?? []
  const nextTasks = dashboard?.nextTasks ?? []
  const totals = dashboard?.totals ?? { patterns: 0, crochet: 0, knit: 0, projects: 0, completed: 0 }

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="Your creative home"
        title={`Welcome back, ${firstName(user?.displayName)}`}
        description="Pick up where you left off, or find a fresh project for your queue."
        actions={
          <Link className="button button--primary" to="/projects/new">
            <Plus size={18} aria-hidden="true" /> New project
          </Link>
        }
      />

      {loading ? (
        <LoadingGrid count={3} />
      ) : featuredProject ? (
        <section className="continue-section" aria-labelledby="continue-title">
          <div className="section-heading section-heading--inline">
            <div>
              <p className="eyebrow">In your hands now</p>
              <h2 id="continue-title">Continue making</h2>
            </div>
            <Link className="text-link" to="/projects">
              All projects <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className="continue-layout">
            <ProjectCard project={featuredProject} feature />
            <div className="continue-panel">
              <div className="continue-panel__top">
                <span className="continue-icon" aria-hidden="true">
                  <Sparkles size={22} />
                </span>
                <div>
                  <p>Ready when you are</p>
                  <h3>{featuredProject.currentSection || 'Keep making progress'}</h3>
                </div>
              </div>
              <p className="continue-panel__copy">
                Your page, counters, notes, and marks are saved with this project so you can resume on any device.
              </p>
              <div className="continue-progress">
                <span style={{ width: `${Math.max(0, Math.min(100, featuredProject.progress))}%` }} />
              </div>
              <strong>{Math.round(featuredProject.progress)}% complete</strong>
              {featuredProject.pattern?.primaryFileId ? (
                <Link className="button button--sun button--wide" to={`/projects/${featuredProject.id}/reader`}>
                  <Play size={18} fill="currentColor" aria-hidden="true" /> Continue pattern
                </Link>
              ) : (
                <Link className="button button--sun button--wide" to={`/projects/${featuredProject.id}`}>
                  Open project <ArrowRight size={18} aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>

          {remainingProjects.length > 0 && (
            <div className="mini-project-strip">
              {remainingProjects.map((project) => (
                <Link key={project.id} to={`/projects/${project.id}`}>
                  <span className="mini-project-strip__icon" aria-hidden="true">
                    <Palette size={19} />
                  </span>
                  <span>
                    <small>{project.craft}</small>
                    <strong>{project.title}</strong>
                  </span>
                  <span>{Math.round(project.progress)}%</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : (
        <EmptyState
          icon={Palette}
          title="Start your first creative project"
          description="Choose a pattern from the library or begin with a blank project. Your notes, progress, and files will stay together."
          action={
            <div className="button-row">
              <Link className="button button--primary" to="/patterns">
                Browse patterns
              </Link>
              <Link className="button button--secondary" to="/projects/new">
                Blank project
              </Link>
            </div>
          }
        />
      )}

      <section className="dashboard-metrics" aria-label="Library summary">
        <Link to="/patterns">
          <BookOpen size={20} aria-hidden="true" />
          <span>
            <strong>{totals.patterns.toLocaleString()}</strong>
            <small>patterns</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link to="/patterns?craft=Crochet">
          <span className="metric-symbol" aria-hidden="true">C</span>
          <span>
            <strong>{totals.crochet.toLocaleString()}</strong>
            <small>crochet</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link to="/patterns?craft=Knit">
          <span className="metric-symbol metric-symbol--sage" aria-hidden="true">K</span>
          <span>
            <strong>{totals.knit.toLocaleString()}</strong>
            <small>knit</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link to="/projects?status=complete">
          <Check size={20} aria-hidden="true" />
          <span>
            <strong>{totals.completed.toLocaleString()}</strong>
            <small>finished</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <div className="dashboard-columns">
        <section className="dashboard-section" aria-labelledby="recent-patterns-title">
          <div className="section-heading section-heading--inline">
            <div>
              <p className="eyebrow">Fresh inspiration</p>
              <h2 id="recent-patterns-title">Recently added</h2>
            </div>
            <Link className="text-link" to="/patterns?sort=recent">
              See library <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {loading ? (
            <LoadingGrid count={2} />
          ) : recentPatterns.length ? (
            <div className="recent-pattern-grid">
              {recentPatterns.slice(0, 4).map((pattern) => (
                <PatternCard key={pattern.id} pattern={pattern} compact onToggleFavorite={(id) => void toggleFavorite(id)} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={BookOpen} title="No recent patterns" description="New additions to the shared library will appear here." />
          )}
        </section>

        <section className="dashboard-section task-section" aria-labelledby="next-tasks-title">
          <div className="section-heading section-heading--inline">
            <div>
              <p className="eyebrow">Small next steps</p>
              <h2 id="next-tasks-title">Coming up</h2>
            </div>
            <Link className="text-link" to="/projects">
              Projects <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {nextTasks.length ? (
            <ul className="task-list">
              {nextTasks.slice(0, 6).map((task) => (
                <li key={task.id}>
                  <span className="task-check" aria-hidden="true" />
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.projectTitle}</small>
                  </span>
                  {task.dueDate && <time dateTime={task.dueDate}>{new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="all-caught-up">
              <span aria-hidden="true"><ListChecks size={24} /></span>
              <div>
                <h3>All caught up</h3>
                <p>Add a next step to a project when you are ready.</p>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="quick-start" aria-labelledby="quick-start-title">
        <div>
          <p className="eyebrow">Capture the spark</p>
          <h2 id="quick-start-title">What would you like to make?</h2>
          <p>Begin with something from your library or start a completely new creative idea.</p>
        </div>
        <div className="quick-start__actions">
          <Link to="/patterns"><BookOpen size={20} aria-hidden="true" /><span><strong>Choose a pattern</strong><small>Browse the shared collection</small></span></Link>
          <Link to="/projects/new"><FolderKanban size={20} aria-hidden="true" /><span><strong>Blank project</strong><small>Track any creative work</small></span></Link>
        </div>
      </section>
    </div>
  )
}

export default DashboardPage
