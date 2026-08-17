import { ArrowRight, CalendarDays, Eye, ImageOff, Lock, Play, Rows3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { CreativeProject } from '@/lib/types'
import { StatusBadge } from './StatusBadge'

function readableDate(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`))
}

interface ProjectCardProps {
  project: CreativeProject
  feature?: boolean
}

export function ProjectCard({ project, feature = false }: ProjectCardProps) {
  const [imageError, setImageError] = useState(false)
  const cover = project.coverPath || project.pattern?.thumbnailPath
  useEffect(() => setImageError(false), [cover])

  return (
    <article className={`project-card ${feature ? 'project-card--feature' : ''}`}>
      <Link className="project-card__image" to={`/projects/${project.id}`} aria-label={`Open ${project.title}`}>
        {cover && !imageError ? (
          <img src={cover} alt="" loading="lazy" onError={() => setImageError(true)} />
        ) : (
          <span className="image-fallback" aria-hidden="true">
            <ImageOff size={30} />
          </span>
        )}
        <StatusBadge status={project.status} />
      </Link>

      <div className="project-card__body">
        <div className="project-card__heading">
          <div>
            <p>{project.pattern?.title || project.craft}</p>
            <h2>
              <Link to={`/projects/${project.id}`}>{project.title}</Link>
            </h2>
          </div>
          <span className="visibility-icon" title={project.visibility === 'private' ? 'Private project' : 'Shared with household'}>
            {project.visibility === 'private' ? <Lock size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            <span className="sr-only">{project.visibility === 'private' ? 'Private project' : 'Shared with household'}</span>
          </span>
        </div>

        <div className="progress-block">
          <div>
            <span>Progress</span>
            <strong>{Math.round(project.progress)}%</strong>
          </div>
          <div className="progress-track" role="progressbar" aria-label={`${project.title} progress`} aria-valuenow={project.progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.max(0, Math.min(100, project.progress))}%` }} />
          </div>
        </div>

        <div className="project-card__meta">
          {project.currentSection && (
            <span>
              <Rows3 size={15} aria-hidden="true" /> {project.currentSection}
            </span>
          )}
          {project.targetDate && (
            <span>
              <CalendarDays size={15} aria-hidden="true" /> Due {readableDate(project.targetDate)}
            </span>
          )}
        </div>

        <div className="project-card__actions">
          {project.pattern?.primaryFileId && project.status === 'in_progress' ? (
            <Link className="button button--primary button--small" to={`/projects/${project.id}/reader`}>
              <Play size={16} fill="currentColor" aria-hidden="true" /> Continue pattern
            </Link>
          ) : (
            <Link className="button button--secondary button--small" to={`/projects/${project.id}`}>
              Open project <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
