import { BookOpen, Check, ChevronDown, Grid2X2, Heart, List, Plus, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { EmptyState, LoadingGrid, PageHeader, PatternCard, SearchField } from '@/components/common'
import { useAppData } from '@/lib/data'
import type { PatternFilters } from '@/lib/types'

function normalized(value: unknown) {
  return String(value ?? '').toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '')
}

function distinct(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
}

function metadataSearchText(value: unknown): string {
  const output: string[] = []
  let characters = 0
  const visit = (item: unknown, depth: number) => {
    if (depth > 7 || characters > 12_000) return
    if (typeof item === 'string' || typeof item === 'number') { const text = String(item); output.push(text); characters += text.length + 1 }
    else if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1))
    else if (item && typeof item === 'object') Object.values(item as Record<string, unknown>).forEach((child) => visit(child, depth + 1))
  }
  visit(value, 0)
  return output.join(' ')
}

export function PatternLibraryPage() {
  const { patterns, preferences, loading, updatePreferences, toggleFavorite } = useAppData()
  const [params, setParams] = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<PatternFilters>(() => ({
    search: params.get('q') ?? '',
    craft: params.get('craft') ?? preferences?.defaultCraft ?? '',
    category: params.get('category') ?? '',
    skill: params.get('skill') ?? '',
    yarnWeight: params.get('yarn') ?? '',
    favoriteOnly: params.get('favorites') === 'true',
    sort: (params.get('sort') as PatternFilters['sort']) || 'title',
  }))

  useEffect(() => {
    if (params.get('focus') === 'search') searchRef.current?.focus()
  }, [params])

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useEffect(() => {
    const next = new URLSearchParams()
    if (filters.search) next.set('q', filters.search)
    if (filters.craft) next.set('craft', filters.craft)
    if (filters.category) next.set('category', filters.category)
    if (filters.skill) next.set('skill', filters.skill)
    if (filters.yarnWeight) next.set('yarn', filters.yarnWeight)
    if (filters.favoriteOnly) next.set('favorites', 'true')
    if (filters.sort !== 'title') next.set('sort', filters.sort)
    setParams(next, { replace: true })
  }, [filters, setParams])

  const options = useMemo(() => ({
    categories: distinct(patterns.map((pattern) => pattern.category)),
    skills: distinct(patterns.map((pattern) => pattern.skillLevel)),
    yarnWeights: distinct(patterns.map((pattern) => pattern.yarnWeight)),
  }), [patterns])

  const metadataIndex = useMemo(() => new Map(patterns.map((pattern) => [pattern.id, normalized(metadataSearchText(pattern.metadata))])), [patterns])

  const visiblePatterns = useMemo(() => {
    const tokens = normalized(filters.search).split(/\s+/).filter(Boolean)
    const filtered = patterns.filter((pattern) => {
      const haystack = normalized([
        pattern.title,
        pattern.craft,
        pattern.category,
        pattern.itemType,
        pattern.itemSubtype,
        pattern.designer,
        pattern.publisher,
        pattern.skillLevel,
        pattern.yarnWeight,
        pattern.sizeSummary,
        pattern.tags.join(' '),
        metadataIndex.get(pattern.id),
      ].join(' '))
      return (
        tokens.every((token) => haystack.includes(token)) &&
        (!filters.craft || pattern.craft === filters.craft) &&
        (!filters.category || pattern.category === filters.category) &&
        (!filters.skill || pattern.skillLevel === filters.skill) &&
        (!filters.yarnWeight || pattern.yarnWeight === filters.yarnWeight) &&
        (!filters.favoriteOnly || pattern.favorite)
      )
    })

    return [...filtered].sort((a, b) => {
      if (filters.sort === 'recent') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (filters.sort === 'skill') return (a.skillLevel ?? '').localeCompare(b.skillLevel ?? '') || a.title.localeCompare(b.title)
      return a.title.localeCompare(b.title)
    })
  }, [patterns, filters, metadataIndex])

  const activeCount = [filters.craft, filters.category, filters.skill, filters.yarnWeight, filters.favoriteOnly].filter(Boolean).length
  const view = preferences?.libraryView ?? 'grid'
  const density = preferences?.libraryDensity ?? 'comfortable'

  function updateFilter<Key extends keyof PatternFilters>(key: Key, value: PatternFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function clearFilters() {
    setFilters({ search: '', craft: '', category: '', skill: '', yarnWeight: '', favoriteOnly: false, sort: 'title' })
  }

  return (
    <div className="page library-page">
      <PageHeader
        eyebrow="Shared collection"
        title="Pattern library"
        description="Search the full collection, compare materials and sizing, or start a project from any pattern."
        actions={
          <Link className="button button--primary" to="/patterns/new">
            <Plus size={18} aria-hidden="true" /> Add pattern
          </Link>
        }
      />

      <section className="library-controls" aria-label="Pattern search and filters">
        <div className="library-search-row">
          <SearchField
            inputRef={searchRef}
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            onClear={() => updateFilter('search', '')}
            placeholder="Search cardigans, baby gifts, cables, designers…"
            label="Search patterns"
          />
          <button
            className={`button button--secondary filter-button ${activeCount ? 'has-filters' : ''}`}
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="pattern-filter-panel"
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <SlidersHorizontal size={18} aria-hidden="true" /> Filters
            {activeCount > 0 && <span>{activeCount}</span>}
          </button>
        </div>

        <div className="craft-tabs" aria-label="Filter by craft">
          {['', 'Crochet', 'Knit'].map((craft) => (
            <button
              key={craft || 'all'}
              type="button"
              className={filters.craft === craft ? 'is-active' : ''}
              aria-pressed={filters.craft === craft}
              onClick={() => updateFilter('craft', craft)}
            >
              {craft || 'All patterns'}
              <span>{craft ? patterns.filter((pattern) => pattern.craft === craft).length : patterns.length}</span>
            </button>
          ))}
          <button
            type="button"
            className={filters.favoriteOnly ? 'is-active' : ''}
            aria-pressed={filters.favoriteOnly}
            onClick={() => updateFilter('favoriteOnly', !filters.favoriteOnly)}
          >
            <Heart size={16} fill={filters.favoriteOnly ? 'currentColor' : 'none'} aria-hidden="true" /> Saved
          </button>
        </div>

        <div className={`filter-panel ${filtersOpen ? 'is-open' : ''}`} id="pattern-filter-panel">
          <label>
            <span>Category</span>
            <select value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}>
              <option value="">All categories</option>
              {options.categories.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </label>
          <label>
            <span>Skill level</span>
            <select value={filters.skill} onChange={(event) => updateFilter('skill', event.target.value)}>
              <option value="">All skill levels</option>
              {options.skills.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </label>
          <label>
            <span>Yarn weight</span>
            <select value={filters.yarnWeight} onChange={(event) => updateFilter('yarnWeight', event.target.value)}>
              <option value="">All yarn weights</option>
              {options.yarnWeights.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </label>
          <button className="text-button" type="button" onClick={clearFilters} disabled={!activeCount && !filters.search}>
            <X size={16} aria-hidden="true" /> Clear filters
          </button>
        </div>

        <div className="library-toolbar">
          <p role="status" aria-live="polite">
            <strong>{visiblePatterns.length.toLocaleString()}</strong> {visiblePatterns.length === 1 ? 'pattern' : 'patterns'}
            {filters.search && <span> for “{filters.search}”</span>}
          </p>
          <div>
            <label className="sort-select">
              <span className="sr-only">Sort patterns</span>
              <select value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value as PatternFilters['sort'])}>
                <option value="title">Title A–Z</option>
                <option value="recent">Recently added</option>
                <option value="skill">Skill level</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
            <div className="view-switch" aria-label="Pattern view">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                className={view === 'grid' ? 'is-active' : ''}
                onClick={() => void updatePreferences({ libraryView: 'grid' })}
              >
                <Grid2X2 size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === 'list'}
                className={view === 'list' ? 'is-active' : ''}
                onClick={() => void updatePreferences({ libraryView: 'list' })}
              >
                <List size={19} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <LoadingGrid count={8} />
      ) : visiblePatterns.length ? (
        <div className={`pattern-library-grid pattern-library-grid--${view} pattern-library-grid--${density}`}>
          {visiblePatterns.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} compact={view === 'list' || density === 'compact'} onToggleFavorite={(id) => void toggleFavorite(id)} />
          ))}
        </div>
      ) : patterns.length ? (
        <EmptyState
          icon={BookOpen}
          title="No patterns match those filters"
          description="Try a broader search or clear one of the filters above."
          action={<button className="button button--primary" type="button" onClick={clearFilters}>Show everything</button>}
        />
      ) : (
        <EmptyState
          icon={BookOpen}
          title="Your pattern library is ready to grow"
          description="Add a PDF, source link, or catalog record to start the shared collection."
          action={<Link className="button button--primary" to="/patterns/new"><Plus size={18} aria-hidden="true" /> Add first pattern</Link>}
        />
      )}

      {!loading && patterns.length > 0 && (
        <aside className="library-help">
          <span aria-hidden="true"><Check size={18} /></span>
          <p><strong>Everything is searchable.</strong> Titles, designers, yarn weights, sizes, categories, and tags are all included.</p>
        </aside>
      )}
    </div>
  )
}

export default PatternLibraryPage
