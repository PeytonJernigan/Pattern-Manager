import { BookOpen, Heart, ImageOff, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Pattern } from '@/lib/types'

interface PatternCardProps {
  pattern: Pattern
  onToggleFavorite?: (patternId: string) => void
  compact?: boolean
}

export function PatternCard({ pattern, onToggleFavorite, compact = false }: PatternCardProps) {
  const [imageError, setImageError] = useState(false)
  const favorite = Boolean(pattern.favorite)
  useEffect(() => setImageError(false), [pattern.thumbnailPath])

  return (
    <article className={`pattern-card ${compact ? 'pattern-card--compact' : ''}`}>
      <Link className="pattern-card__image" to={`/patterns/${pattern.id}`} aria-label={`View ${pattern.title}`}>
        {pattern.thumbnailPath && !imageError ? (
          <img src={pattern.thumbnailPath} alt="" loading="lazy" onError={() => setImageError(true)} />
        ) : (
          <span className="image-fallback" aria-hidden="true">
            <ImageOff size={30} />
          </span>
        )}
        <span className={`craft-chip craft-chip--${pattern.craft.toLowerCase()}`}>{pattern.craft}</span>
        {pattern.freeStatus && <span className="access-chip">{pattern.freeStatus === 'Yes' ? 'Free' : pattern.freeStatus}</span>}
      </Link>

      <div className="pattern-card__content">
        <div className="pattern-card__title-row">
          <div>
            <p>{[pattern.itemType, pattern.skillLevel].filter(Boolean).join(' · ') || pattern.category || 'Pattern'}</p>
            <h2>
              <Link to={`/patterns/${pattern.id}`}>{pattern.title}</Link>
            </h2>
          </div>
          {onToggleFavorite && (
            <button
              className={`favorite-button ${favorite ? 'is-favorite' : ''}`}
              type="button"
              aria-label={favorite ? `Remove ${pattern.title} from favorites` : `Add ${pattern.title} to favorites`}
              aria-pressed={favorite}
              onClick={() => onToggleFavorite(pattern.id)}
            >
              <Heart size={19} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          )}
        </div>

        {!compact && (
          <dl className="pattern-card__facts">
            <div>
              <dt>Sizes</dt>
              <dd>{pattern.sizeSummary || 'See pattern'}</dd>
            </div>
            <div>
              <dt>Yarn</dt>
              <dd>{pattern.yarnWeight || 'Not stated'}</dd>
            </div>
          </dl>
        )}

        <div className="pattern-card__footer">
          <span>{pattern.designer || pattern.publisher || 'Designer not stated'}</span>
          <div>
            <Link className="text-link" to={`/patterns/${pattern.id}`}>
              <BookOpen size={16} aria-hidden="true" /> Details
            </Link>
            <Link className="icon-link" to={`/projects/new?pattern=${pattern.id}`} aria-label={`Start a project with ${pattern.title}`}>
              <Plus size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  )
}
