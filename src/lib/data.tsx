import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useAuth } from './auth'
import { appConfig } from './config'
import { demoAnnotations, demoCounters, demoPatterns, demoPreferences, demoProjects } from './demoData'
import { enqueueMutation, markMutationAttempt, maxSyncAttempts, readOutbox, removeMutation, retryStalledMutations, withSyncLock } from './offlineQueue'
import { supabase } from './supabase'
import type {
  CreativeProject,
  DashboardSnapshot,
  Pattern,
  PatternFile,
  PdfAnnotation,
  PdfSession,
  ProjectNote,
  ProjectTask,
  RowCounter,
  UserPreferences,
} from './types'

type DbRow = Record<string, any>

function isTransientSyncError(error: { message?: string } | null | undefined) {
  if (!navigator.onLine) return true
  return /network|fetch|timeout|timed out|connection|temporar|rate limit|429|502|503|504/i.test(error?.message ?? '')
}

interface DemoState {
  patterns: Pattern[]
  projects: CreativeProject[]
  counters: RowCounter[]
  annotations: PdfAnnotation[]
  sessions: PdfSession[]
  preferences: UserPreferences
  tasks: ProjectTask[]
  notes: ProjectNote[]
}

interface NewProjectInput {
  title: string
  craft: string
  patternId?: string | null
  visibility?: 'private' | 'household'
  status?: CreativeProject['status']
  notes?: string | null
}

interface NewPatternInput {
  title: string
  craft: string
  category?: string | null
  itemType?: string | null
  description?: string | null
  sourceUrl?: string | null
}

interface DataContextValue {
  patterns: Pattern[]
  projects: CreativeProject[]
  preferences: UserPreferences
  dashboard: DashboardSnapshot
  loading: boolean
  error: string | null
  offlineIssueCount: number
  refresh(): Promise<void>
  retryOfflineChanges(): Promise<void>
  toggleFavorite(patternId: string): Promise<void>
  createProject(input: NewProjectInput): Promise<CreativeProject>
  updateProject(projectId: string, updates: Partial<CreativeProject>): Promise<void>
  createPattern(input: NewPatternInput): Promise<Pattern>
  updatePattern(patternId: string, updates: Partial<Pattern>): Promise<void>
  uploadPatternFile(patternId: string, file: File): Promise<PatternFile>
  uploadPatternThumbnail(patternId: string, file: File): Promise<string>
  updatePreferences(updates: Partial<UserPreferences>): Promise<void>
  getPattern(patternId: string): Pattern | undefined
  getProject(projectId: string): CreativeProject | undefined
  getPatternFile(assetId: string): Promise<PatternFile | null>
  getPdfBytes(file: PatternFile): Promise<Uint8Array>
  listAnnotations(projectId: string, patternFileId: string): Promise<PdfAnnotation[]>
  saveAnnotation(annotation: PdfAnnotation): Promise<void>
  deleteAnnotation(annotation: PdfAnnotation): Promise<void>
  listCounters(projectId: string): Promise<RowCounter[]>
  createCounter(projectId: string, name: string): Promise<RowCounter>
  incrementCounter(counterId: string, delta: number): Promise<RowCounter>
  loadPdfSession(projectId: string, patternFileId: string): Promise<PdfSession | null>
  savePdfSession(session: PdfSession): Promise<void>
  listProjectTasks(projectId: string): Promise<ProjectTask[]>
  createProjectTask(projectId: string, title: string): Promise<ProjectTask>
  toggleProjectTask(task: ProjectTask): Promise<ProjectTask>
  deleteProjectTask(task: ProjectTask): Promise<void>
  listProjectNotes(projectId: string): Promise<ProjectNote[]>
  createProjectNote(projectId: string, body: string): Promise<ProjectNote>
}

const DataContext = createContext<DataContextValue | null>(null)
const demoStorageKey = 'pattern-manager-demo-state-v2'

function initialDemoState(): DemoState {
  try {
    const stored = localStorage.getItem(demoStorageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DemoState>
      return { patterns: parsed.patterns ?? demoPatterns, projects: parsed.projects ?? demoProjects, counters: parsed.counters ?? demoCounters,
        annotations: parsed.annotations ?? demoAnnotations, sessions: parsed.sessions ?? [], preferences: parsed.preferences ?? demoPreferences,
        tasks: parsed.tasks ?? [], notes: parsed.notes ?? [] }
    }
  } catch { /* use clean preview data */ }
  return { patterns: demoPatterns, projects: demoProjects, counters: demoCounters, annotations: demoAnnotations, sessions: [], preferences: demoPreferences, tasks: [], notes: [] }
}

function mapPattern(row: DbRow, favorite = false): Pattern {
  return {
    id: row.id, legacyId: row.external_id ?? row.catalog_code ?? null, householdId: row.household_id,
    title: row.title, craft: row.craft, category: row.category ?? null, itemType: row.item_type ?? null,
    itemSubtype: row.item_subtype ?? null, designer: row.designer_name ?? null, publisher: row.publisher ?? null,
    description: row.description ?? null, thumbnailPath: row.thumbnail_storage_path ?? null,
    primaryFileId: row.primary_asset_id ?? null, sourceUrl: row.source_url ?? null, skillLevel: row.skill_level ?? null,
    yarnWeight: row.yarn_weight ?? null, sizeSummary: row.size_summary ?? null, freeStatus: row.free_status ?? null,
    accessStatus: row.access_status ?? null, tags: row.tags ?? [], metadata: row.metadata ?? {}, favorite,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapProject(row: DbRow): CreativeProject {
  const pattern = row.patterns
  return {
    id: row.id, householdId: row.household_id, createdBy: row.created_by, ownerId: row.owner_user_id,
    patternId: row.pattern_id ?? null, title: row.title, craft: row.project_kind, status: row.status,
    visibility: row.visibility, progress: Number(row.progress_percent ?? 0), currentSection: row.current_section ?? null,
    sizeLabel: row.size_label ?? null, colorway: row.colorway ?? null, notes: row.notes ?? null,
    coverPath: row.cover_storage_path ?? null, startDate: row.started_on ?? null, targetDate: row.due_on ?? null,
    completedAt: row.completed_on ?? null, lastOpenedAt: row.last_opened_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
    pattern: pattern ? { id: pattern.id, title: pattern.title, thumbnailPath: pattern.thumbnail_storage_path ?? null, primaryFileId: pattern.primary_asset_id ?? null } : null,
  }
}

function mapAnnotation(row: DbRow): PdfAnnotation {
  return {
    id: row.id, clientMutationId: row.client_mutation_id, projectId: row.project_id, patternFileId: row.asset_id,
    householdId: row.household_id, authorId: row.author_user_id, pageNumber: row.page_number, type: row.kind,
    geometry: row.geometry, content: row.content ?? {}, style: row.style ?? {}, revision: row.revision,
    deletedAt: row.deleted_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapCounter(row: DbRow): RowCounter {
  return {
    id: row.id, projectId: row.project_id, householdId: row.household_id, userId: row.user_id,
    name: row.name, currentValue: row.current_value, step: row.step, target: row.target_value ?? null,
    repeatLength: row.repeat_length ?? null, revision: row.revision, updatedAt: row.updated_at,
  }
}

function mapTask(row: DbRow): ProjectTask {
  return { id: row.id, projectId: row.project_id, householdId: row.household_id, title: row.title, completed: row.completed,
    position: row.position, dueDate: row.due_date ?? null, createdAt: row.created_at }
}

function mapNote(row: DbRow): ProjectNote {
  return { id: row.id, projectId: row.project_id, householdId: row.household_id, authorId: row.author_id,
    body: row.body, createdAt: row.created_at, updatedAt: row.updated_at }
}

function buildUpcomingTasks(tasks: ProjectTask[], projects: CreativeProject[]) {
  const titles = new Map(projects.map((project) => [project.id, project.title]))
  return tasks
    .filter((task) => !task.completed && titles.has(task.projectId))
    .map((task) => ({ ...task, projectTitle: titles.get(task.projectId) ?? 'Project' }))
    .sort((left, right) => {
      if (left.dueDate && right.dueDate) return left.dueDate.localeCompare(right.dueDate) || left.position - right.position
      if (left.dueDate) return -1
      if (right.dueDate) return 1
      return left.position - right.position || left.createdAt.localeCompare(right.createdAt)
    })
    .slice(0, 12)
}

async function resolveThumbnailUrls(rows: DbRow[]) {
  if (!supabase) return new Map<string, string>()
  const paths = [...new Set(rows.map((row) => row.thumbnail_storage_path).filter((path): path is string => Boolean(path)))]
  const resolved = new Map<string, string>()
  for (let index = 0; index < paths.length; index += 100) {
    const { data } = await supabase.storage.from('pattern-assets').createSignedUrls(paths.slice(index, index + 100), 3600)
    for (const item of data ?? []) if (item.path && item.signedUrl) resolved.set(item.path, item.signedUrl)
  }
  return resolved
}

export function DataProvider({ children }: PropsWithChildren) {
  const { user, demoMode } = useAuth()
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [projects, setProjects] = useState<CreativeProject[]>([])
  const [upcomingTasks, setUpcomingTasks] = useState<Array<ProjectTask & { projectTitle: string }>>([])
  const [preferences, setPreferences] = useState<UserPreferences>(demoPreferences)
  const [demoState, setDemoState] = useState<DemoState>(initialDemoState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offlineIssueCount, setOfflineIssueCount] = useState(0)

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.reducedMotion = preferences.reducedMotion ? 'true' : 'false'
  }, [preferences.reducedMotion, preferences.theme])

  const persistDemo = useCallback((next: DemoState) => {
    setDemoState(next)
    localStorage.setItem(demoStorageKey, JSON.stringify(next))
    setPatterns(next.patterns); setProjects(next.projects); setPreferences(next.preferences)
    setUpcomingTasks(buildUpcomingTasks(next.tasks, next.projects))
  }, [])

  const refresh = useCallback(async () => {
    if (!user) { setPatterns([]); setProjects([]); setUpcomingTasks([]); setLoading(false); return }
    if (!patterns.length && !projects.length) setLoading(true)
    setError(null)
    if (demoMode || !supabase) {
      setPatterns(demoState.patterns); setProjects(demoState.projects); setUpcomingTasks(buildUpcomingTasks(demoState.tasks, demoState.projects)); setPreferences(demoState.preferences); setLoading(false); return
    }
    const [patternsResult, favoritesResult, projectsResult, settingsResult, tasksResult] = await Promise.all([
      supabase.from('patterns').select('*').is('deleted_at', null).order('title'),
      supabase.from('favorites').select('pattern_id').eq('user_id', user.id),
      supabase.from('projects').select('*, patterns(id,title,thumbnail_storage_path,primary_asset_id)').is('deleted_at', null).order('updated_at', { ascending: false }),
      supabase.from('user_settings').select('settings').eq('user_id', user.id).maybeSingle(),
      supabase.from('project_tasks').select('*, projects!inner(title)').eq('completed', false).order('due_date', { ascending: true, nullsFirst: false }).order('position').limit(12),
    ])
    const firstError = patternsResult.error || favoritesResult.error || projectsResult.error || settingsResult.error || tasksResult.error
    if (firstError) { setError(firstError.message); setLoading(false); return }
    const favorites = new Set((favoritesResult.data ?? []).map((row) => row.pattern_id))
    const patternRows = (patternsResult.data ?? []) as DbRow[]
    const thumbnails = await resolveThumbnailUrls(patternRows)
    setPatterns(patternRows.map((row) => mapPattern({ ...row, thumbnail_storage_path: typeof row.thumbnail_storage_path === 'string' ? thumbnails.get(row.thumbnail_storage_path) ?? null : null }, favorites.has(row.id))))
    const mappedProjects = ((projectsResult.data ?? []) as DbRow[]).map((row) => mapProject({ ...row, patterns: row.patterns ? {
      ...row.patterns,
      thumbnail_storage_path: typeof row.patterns.thumbnail_storage_path === 'string' ? thumbnails.get(row.patterns.thumbnail_storage_path) ?? null : null,
    } : null }))
    setProjects(mappedProjects)
    setUpcomingTasks(((tasksResult.data ?? []) as DbRow[]).map((row) => ({ ...mapTask(row), projectTitle: row.projects?.title ?? 'Project' })))
    setPreferences({ ...demoPreferences, ...(settingsResult.data?.settings ?? {}) })
    setLoading(false)
  }, [demoMode, demoState, patterns.length, projects.length, user])

  const flushOfflineChanges = useCallback(async () => {
    if (!user || demoMode || !supabase) return
    const client = supabase
    await withSyncLock(user.id, async () => {
      for (const mutation of (await readOutbox(user.id)).filter((item) => item.attempts < maxSyncAttempts)) {
        try {
          let mutationError: { message: string } | null = null
          if (mutation.kind === 'annotation_upsert') mutationError = (await client.from('pdf_annotations').upsert(mutation.payload)).error
          else if (mutation.kind === 'annotation_delete') mutationError = (await client.from('pdf_annotations').update({ deleted_at: new Date().toISOString() }).eq('id', mutation.payload.id as string)).error
          else if (mutation.kind === 'session_upsert') mutationError = (await client.from('pdf_sessions').upsert(mutation.payload)).error
          else if (mutation.kind === 'counter_delta') mutationError = (await client.rpc('increment_project_counter', {
            p_counter_id: mutation.payload.counterId as string, p_delta: mutation.payload.delta as number, p_client_mutation_id: mutation.id,
          })).error
          if (mutationError) throw new Error(mutationError.message)
          await removeMutation(user.id, mutation.id)
        } catch {
          const attempts = await markMutationAttempt(user.id, mutation.id)
          if (attempts >= maxSyncAttempts) setError('Some offline changes could not sync. Use the sync status to retry or sign out to discard them.')
        }
      }
    })
    const stalled = (await readOutbox(user.id)).filter((item) => item.attempts >= maxSyncAttempts).length
    setOfflineIssueCount(stalled)
    if (!stalled) setError((current) => current?.startsWith('Some offline changes could not sync') ? null : current)
  }, [demoMode, user])

  useEffect(() => {
    if (!user || demoMode || !supabase) return
    const flush = () => { void flushOfflineChanges() }
    const online = () => { void flush() }
    window.addEventListener('online', online); void flush()
    return () => window.removeEventListener('online', online)
  }, [demoMode, flushOfflineChanges, user])

  const retryOfflineChanges = useCallback(async () => {
    if (!user) return
    await retryStalledMutations(user.id)
    setOfflineIssueCount(0)
    await flushOfflineChanges()
  }, [flushOfflineChanges, user])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!user || demoMode || !supabase) return
    const renewPrivateUrls = () => void refresh()
    const timer = window.setInterval(renewPrivateUrls, 50 * 60 * 1000)
    window.addEventListener('focus', renewPrivateUrls)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', renewPrivateUrls) }
  }, [demoMode, refresh, user])

  const toggleFavorite = useCallback(async (patternId: string) => {
    if (!user) return
    const current = patterns.find((pattern) => pattern.id === patternId)?.favorite ?? false
    setPatterns((value) => value.map((pattern) => pattern.id === patternId ? { ...pattern, favorite: !current } : pattern))
    if (demoMode || !supabase) {
      persistDemo({ ...demoState, patterns: demoState.patterns.map((pattern) => pattern.id === patternId ? { ...pattern, favorite: !current } : pattern) }); return
    }
    const result = current
      ? await supabase.from('favorites').delete().eq('user_id', user.id).eq('pattern_id', patternId)
      : await supabase.from('favorites').insert({ user_id: user.id, pattern_id: patternId })
    if (result.error) { setError(result.error.message); await refresh() }
  }, [demoMode, demoState, patterns, persistDemo, refresh, user])

  const createProject = useCallback(async (input: NewProjectInput) => {
    if (!user) throw new Error('Sign in to create a project.')
    const timestamp = new Date().toISOString()
    if (demoMode || !supabase) {
      const pattern = patterns.find((item) => item.id === input.patternId)
      const project: CreativeProject = {
        id: crypto.randomUUID(), householdId: user.householdId, createdBy: user.id, ownerId: user.id,
        patternId: input.patternId ?? null, title: input.title, craft: input.craft, status: input.status ?? 'planned',
        visibility: input.visibility ?? preferences.defaultProjectVisibility, progress: 0, currentSection: null,
        sizeLabel: null, colorway: null, notes: input.notes ?? null, coverPath: null, startDate: null, targetDate: null,
        completedAt: null, lastOpenedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
        pattern: pattern ? { id: pattern.id, title: pattern.title, thumbnailPath: pattern.thumbnailPath, primaryFileId: pattern.primaryFileId } : null,
      }
      persistDemo({ ...demoState, projects: [project, ...demoState.projects] }); return project
    }
    const { data, error: insertError } = await supabase.from('projects').insert({
      pattern_id: input.patternId ?? null,
      title: input.title, project_kind: input.craft, status: input.status ?? 'planned',
      visibility: input.visibility ?? preferences.defaultProjectVisibility, notes: input.notes ?? null,
    }).select('*, patterns(id,title,thumbnail_storage_path,primary_asset_id)').single()
    if (insertError) {
      const detail = [insertError.message, insertError.details, insertError.hint].filter(Boolean).join(' ')
      throw new Error(detail || 'The project could not be created.')
    }
    const project = mapProject(data); setProjects((value) => [project, ...value]); return project
  }, [demoMode, demoState, patterns, persistDemo, preferences.defaultProjectVisibility, user])

  const updateProject = useCallback(async (projectId: string, updates: Partial<CreativeProject>) => {
    const timestamp = new Date().toISOString()
    const mergeProject = (project: CreativeProject) => {
      if (project.id !== projectId) return project
      const linked = 'patternId' in updates ? patterns.find((pattern) => pattern.id === updates.patternId) : undefined
      return { ...project, ...updates, ...(linked ? { pattern: { id: linked.id, title: linked.title, thumbnailPath: linked.thumbnailPath, primaryFileId: linked.primaryFileId } } : 'patternId' in updates && !updates.patternId ? { pattern: null } : {}), updatedAt: timestamp }
    }
    setProjects((value) => value.map(mergeProject))
    if (demoMode || !supabase) {
      persistDemo({ ...demoState, projects: demoState.projects.map(mergeProject) }); return
    }
    const dbUpdates: DbRow = { updated_at: timestamp }
    const mapping: Record<string, string> = { title: 'title', craft: 'project_kind', patternId: 'pattern_id', status: 'status', visibility: 'visibility', progress: 'progress_percent', currentSection: 'current_section', sizeLabel: 'size_label', colorway: 'colorway', notes: 'notes', startDate: 'started_on', targetDate: 'due_on', completedAt: 'completed_on' }
    for (const [key, column] of Object.entries(mapping)) if (key in updates) dbUpdates[column] = updates[key as keyof CreativeProject]
    const { error: updateError } = await supabase.from('projects').update(dbUpdates).eq('id', projectId)
    if (updateError) throw updateError
  }, [demoMode, demoState, patterns, persistDemo])

  const createPattern = useCallback(async (input: NewPatternInput) => {
    if (!user) throw new Error('Sign in to add a pattern.')
    const timestamp = new Date().toISOString()
    if (demoMode || !supabase) {
      const pattern: Pattern = { id: crypto.randomUUID(), legacyId: null, householdId: user.householdId, title: input.title, craft: input.craft,
        category: input.category ?? null, itemType: input.itemType ?? null, itemSubtype: null, designer: null, publisher: null,
        description: input.description ?? null, thumbnailPath: null, primaryFileId: null, sourceUrl: input.sourceUrl ?? null,
        skillLevel: null, yarnWeight: null, sizeSummary: null, freeStatus: 'Unknown', accessStatus: 'Unknown', tags: [], metadata: {}, favorite: false,
        createdAt: timestamp, updatedAt: timestamp }
      persistDemo({ ...demoState, patterns: [pattern, ...demoState.patterns] }); return pattern
    }
    const { data, error: insertError } = await supabase.from('patterns').insert({
      household_id: user.householdId, created_by: user.id, updated_by: user.id, title: input.title, craft: input.craft,
      category: input.category ?? null, item_type: input.itemType ?? null, description: input.description ?? null, source_url: input.sourceUrl ?? null,
    }).select().single()
    if (insertError) throw insertError
    const pattern = mapPattern(data); setPatterns((value) => [pattern, ...value]); return pattern
  }, [demoMode, demoState, persistDemo, user])

  const updatePattern = useCallback(async (patternId: string, updates: Partial<Pattern>) => {
    if (!user) return
    const timestamp = new Date().toISOString()
    setPatterns((value) => value.map((pattern) => pattern.id === patternId ? { ...pattern, ...updates, updatedAt: timestamp } : pattern))
    if (demoMode || !supabase) {
      persistDemo({ ...demoState, patterns: demoState.patterns.map((pattern) => pattern.id === patternId ? { ...pattern, ...updates, updatedAt: timestamp } : pattern) }); return
    }
    const dbUpdates: DbRow = { updated_at: timestamp, updated_by: user.id }
    const mapping: Record<string, string> = { title: 'title', craft: 'craft', category: 'category', itemType: 'item_type', itemSubtype: 'item_subtype', designer: 'designer_name', publisher: 'publisher', description: 'description', sourceUrl: 'source_url', skillLevel: 'skill_level', yarnWeight: 'yarn_weight', sizeSummary: 'size_summary', freeStatus: 'free_status', accessStatus: 'access_status', tags: 'tags', metadata: 'metadata', thumbnailPath: 'thumbnail_storage_path', primaryFileId: 'primary_asset_id' }
    for (const [key, column] of Object.entries(mapping)) if (key in updates) dbUpdates[column] = updates[key as keyof Pattern]
    const { error: updateError } = await supabase.from('patterns').update(dbUpdates).eq('id', patternId)
    if (updateError) throw updateError
  }, [demoMode, demoState, persistDemo, user])

  const uploadPatternFile = useCallback(async (patternId: string, file: File) => {
    if (!user) throw new Error('Sign in to upload a pattern file.')
    if (!supabase) throw new Error('Connect Supabase before uploading private PDFs.')
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Only PDF files can be opened in the pattern reader.')
    if (file.size > appConfig.maxUploadMb * 1024 * 1024) throw new Error(`This PDF is larger than the ${appConfig.maxUploadMb} MB upload limit.`)
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const storagePath = `${user.householdId}/catalog/${sha256.slice(0, 2)}/${sha256}.pdf`
    const uploadResult = await supabase.storage.from('pattern-assets').upload(storagePath, file, { contentType: 'application/pdf', cacheControl: '0', upsert: false })
    if (uploadResult.error && !uploadResult.error.message.toLowerCase().includes('already exists')) throw uploadResult.error
    const { data, error: assetError } = await supabase.from('assets').upsert({
      household_id: user.householdId, storage_bucket: 'pattern-assets', storage_path: storagePath, original_name: file.name,
      mime_type: file.type, byte_size: file.size, sha256, role: 'primary_instructions', created_by: user.id,
    }, { onConflict: 'household_id,sha256' }).select().single()
    if (assetError) throw assetError
    const { error: primaryError } = await supabase.rpc('set_pattern_primary_asset', { p_pattern_id: patternId, p_asset_id: data.id })
    if (primaryError) throw primaryError
    setPatterns((current) => current.map((pattern) => pattern.id === patternId ? { ...pattern, primaryFileId: data.id, updatedAt: new Date().toISOString() } : pattern))
    return { id: data.id, patternId, householdId: data.household_id, storagePath: data.storage_path, originalName: data.original_name,
      mimeType: data.mime_type, sha256: data.sha256, pageCount: data.page_count, version: data.version, language: data.language,
      role: data.role, createdAt: data.created_at } satisfies PatternFile
  }, [user])

  const uploadPatternThumbnail = useCallback(async (patternId: string, file: File) => {
    if (!user) throw new Error('Sign in to upload a cover image.')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.')
    if (file.size > 10 * 1024 * 1024) throw new Error('Cover images must be 10 MB or smaller.')
    if (demoMode || !supabase) {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })
      const nextPatterns = demoState.patterns.map((pattern) => pattern.id === patternId ? { ...pattern, thumbnailPath: dataUrl, updatedAt: new Date().toISOString() } : pattern)
      persistDemo({ ...demoState, patterns: nextPatterns }); return dataUrl
    }
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const storagePath = `${user.householdId}/thumbnails/${sha256.slice(0, 2)}/${sha256}.${extension}`
    const uploadResult = await supabase.storage.from('pattern-assets').upload(storagePath, file, { contentType: file.type, cacheControl: '0', upsert: false })
    if (uploadResult.error && !uploadResult.error.message.toLowerCase().includes('already exists')) throw uploadResult.error
    const { data: asset, error: assetError } = await supabase.from('assets').upsert({ household_id: user.householdId, storage_bucket: 'pattern-assets', storage_path: storagePath,
      original_name: file.name, mime_type: file.type, byte_size: file.size, sha256, role: 'thumbnail', created_by: user.id }, { onConflict: 'household_id,sha256' }).select().single()
    if (assetError) throw assetError
    const { error: linkError } = await supabase.from('pattern_assets').upsert({ household_id: user.householdId, pattern_id: patternId, asset_id: asset.id, role: 'thumbnail', is_primary: false })
    if (linkError) throw linkError
    const { error: patternError } = await supabase.from('patterns').update({ thumbnail_storage_path: storagePath, updated_by: user.id }).eq('id', patternId)
    if (patternError) throw patternError
    const { data: signed, error: signedError } = await supabase.storage.from('pattern-assets').createSignedUrl(storagePath, 3600)
    if (signedError) throw signedError
    setPatterns((current) => current.map((pattern) => pattern.id === patternId ? { ...pattern, thumbnailPath: signed.signedUrl, updatedAt: new Date().toISOString() } : pattern))
    return signed.signedUrl
  }, [demoMode, demoState, persistDemo, user])

  const updatePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
    if (!user) return
    const next = { ...preferences, ...updates }; setPreferences(next)
    document.documentElement.dataset.theme = next.theme
    if (demoMode || !supabase) { persistDemo({ ...demoState, preferences: next }); return }
    const { error: settingsError } = await supabase.from('user_settings').upsert({ user_id: user.id, settings: next, updated_at: new Date().toISOString() })
    if (settingsError) throw settingsError
  }, [demoMode, demoState, persistDemo, preferences, user])

  const getPatternFile = useCallback(async (assetId: string) => {
    if (demoMode || !supabase) return null
    const { data, error: fileError } = await supabase.from('assets').select('*').eq('id', assetId).single()
    if (fileError) throw fileError
    return { id: data.id, patternId: '', householdId: data.household_id, storagePath: data.storage_path, originalName: data.original_name,
      mimeType: data.mime_type, sha256: data.sha256, pageCount: data.page_count, version: data.version, language: data.language,
      role: data.role, createdAt: data.created_at } satisfies PatternFile
  }, [demoMode])

  const getPdfBytes = useCallback(async (file: PatternFile) => {
    if (!supabase) throw new Error('Attach a PDF after connecting Supabase.')
    const { data, error: signedUrlError } = await supabase.storage.from('pattern-assets').createSignedUrl(file.storagePath, 60)
    if (signedUrlError) throw signedUrlError
    const response = await fetch(data.signedUrl, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error(`The private PDF could not be downloaded (${response.status}).`)
    return new Uint8Array(await response.arrayBuffer())
  }, [])

  const listAnnotations = useCallback(async (projectId: string, patternFileId: string) => {
    if (demoMode || !supabase) return demoState.annotations.filter((item) => item.projectId === projectId && item.patternFileId === patternFileId && !item.deletedAt)
    const { data, error: listError } = await supabase.from('pdf_annotations').select('*').eq('project_id', projectId).eq('asset_id', patternFileId).is('deleted_at', null).order('created_at')
    if (listError) throw listError
    return (data ?? []).map(mapAnnotation)
  }, [demoMode, demoState.annotations])

  const saveAnnotation = useCallback(async (annotation: PdfAnnotation) => {
    if (demoMode || !supabase) {
      const next = [...demoState.annotations.filter((item) => item.id !== annotation.id), annotation]
      persistDemo({ ...demoState, annotations: next }); return
    }
    const row = { id: annotation.id, client_mutation_id: annotation.clientMutationId, project_id: annotation.projectId,
      asset_id: annotation.patternFileId, household_id: annotation.householdId, author_user_id: annotation.authorId,
      page_number: annotation.pageNumber, kind: annotation.type, geometry: annotation.geometry, content: annotation.content,
      style: annotation.style, revision: annotation.revision, deleted_at: annotation.deletedAt }
    const { error: saveError } = await supabase.from('pdf_annotations').upsert(row)
    if (saveError) { if (isTransientSyncError(saveError)) await enqueueMutation(annotation.authorId, { id: annotation.clientMutationId, kind: 'annotation_upsert', payload: row }); throw saveError }
  }, [demoMode, demoState, persistDemo])

  const deleteAnnotation = useCallback(async (annotation: PdfAnnotation) => {
    const deleted = { ...annotation, deletedAt: new Date().toISOString(), revision: annotation.revision + 1 }
    if (demoMode || !supabase) { await saveAnnotation(deleted); return }
    const { error: deleteError } = await supabase.from('pdf_annotations').update({ deleted_at: deleted.deletedAt, revision: deleted.revision }).eq('id', annotation.id).eq('revision', annotation.revision)
    if (deleteError) { if (isTransientSyncError(deleteError)) await enqueueMutation(annotation.authorId, { id: crypto.randomUUID(), kind: 'annotation_delete', payload: { id: annotation.id, revision: annotation.revision } }); throw deleteError }
  }, [demoMode, saveAnnotation])

  const listCounters = useCallback(async (projectId: string) => {
    if (demoMode || !supabase) return demoState.counters.filter((counter) => counter.projectId === projectId)
    const { data, error: counterError } = await supabase.from('project_counters').select('*').eq('project_id', projectId).order('created_at')
    if (counterError) throw counterError
    return (data ?? []).map(mapCounter)
  }, [demoMode, demoState.counters])

  const createCounter = useCallback(async (projectId: string, name: string) => {
    if (!user) throw new Error('Sign in to create a counter.')
    const now = new Date().toISOString()
    if (demoMode || !supabase) {
      const counter: RowCounter = { id: crypto.randomUUID(), projectId, householdId: user.householdId, userId: user.id, name, currentValue: 0, step: 1, target: null, repeatLength: null, revision: 1, updatedAt: now }
      persistDemo({ ...demoState, counters: [...demoState.counters, counter] }); return counter
    }
    const { data, error: counterError } = await supabase.from('project_counters').insert({ household_id: user.householdId, project_id: projectId, user_id: user.id, name }).select().single()
    if (counterError) throw counterError
    return mapCounter(data as DbRow)
  }, [demoMode, demoState, persistDemo, user])

  const incrementCounter = useCallback(async (counterId: string, delta: number) => {
    if (demoMode || !supabase) {
      const current = demoState.counters.find((counter) => counter.id === counterId)
      if (!current) throw new Error('Counter not found.')
      const next = { ...current, currentValue: Math.max(0, current.currentValue + delta), revision: current.revision + 1, updatedAt: new Date().toISOString() }
      persistDemo({ ...demoState, counters: demoState.counters.map((counter) => counter.id === counterId ? next : counter) }); return next
    }
    if (!user) throw new Error('Sign in to change a counter.')
    const mutationId = crypto.randomUUID()
    const { data, error: counterError } = await supabase.rpc('increment_project_counter', { p_counter_id: counterId, p_delta: delta, p_client_mutation_id: mutationId }).single()
    if (counterError) { if (isTransientSyncError(counterError)) await enqueueMutation(user.id, { id: mutationId, kind: 'counter_delta', payload: { counterId, delta } }); throw counterError }
    return mapCounter(data as DbRow)
  }, [demoMode, demoState, persistDemo, user])

  const loadPdfSession = useCallback(async (projectId: string, patternFileId: string) => {
    if (!user) return null
    if (demoMode || !supabase) return demoState.sessions.find((session) => session.projectId === projectId && session.patternFileId === patternFileId && session.userId === user.id) ?? null
    const { data, error: sessionError } = await supabase.from('pdf_sessions').select('*').eq('project_id', projectId).eq('asset_id', patternFileId).eq('user_id', user.id).maybeSingle()
    if (sessionError) throw sessionError
    return data ? { id: data.id, projectId: data.project_id, patternFileId: data.asset_id, userId: data.user_id, currentPage: data.current_page,
      zoom: Number(data.zoom), fitMode: data.fit_mode, scrollOffset: Number(data.scroll_offset), selectedCounterId: data.selected_counter_id, updatedAt: data.updated_at } : null
  }, [demoMode, demoState.sessions, user])

  const savePdfSession = useCallback(async (session: PdfSession) => {
    if (demoMode || !supabase) { persistDemo({ ...demoState, sessions: [...demoState.sessions.filter((item) => item.id !== session.id), session] }); return }
    const row = { id: session.id, project_id: session.projectId, asset_id: session.patternFileId, user_id: session.userId,
      current_page: session.currentPage, zoom: session.zoom, fit_mode: session.fitMode, scroll_offset: session.scrollOffset,
      selected_counter_id: session.selectedCounterId, updated_at: session.updatedAt }
    const { error: sessionError } = await supabase.from('pdf_sessions').upsert(row)
    if (sessionError) { if (isTransientSyncError(sessionError)) await enqueueMutation(session.userId, { id: crypto.randomUUID(), kind: 'session_upsert', payload: row }); throw sessionError }
  }, [demoMode, demoState, persistDemo])

  const listProjectTasks = useCallback(async (projectId: string) => {
    if (demoMode || !supabase) return demoState.tasks.filter((task) => task.projectId === projectId).sort((a, b) => a.position - b.position)
    const { data, error: taskError } = await supabase.from('project_tasks').select('*').eq('project_id', projectId).order('position').order('created_at')
    if (taskError) throw taskError
    return (data ?? []).map(mapTask)
  }, [demoMode, demoState.tasks])

  const createProjectTask = useCallback(async (projectId: string, title: string) => {
    if (!user) throw new Error('Sign in to add a task.')
    const now = new Date().toISOString()
    if (demoMode || !supabase) {
      const projectTasks = demoState.tasks.filter((task) => task.projectId === projectId)
      const task: ProjectTask = { id: crypto.randomUUID(), projectId, householdId: user.householdId, title, completed: false,
        position: projectTasks.length ? Math.max(...projectTasks.map((item) => item.position)) + 1 : 0, dueDate: null, createdAt: now }
      persistDemo({ ...demoState, tasks: [...demoState.tasks, task] }); return task
    }
    const { data, error: taskError } = await supabase.from('project_tasks').insert({ household_id: user.householdId, project_id: projectId, title }).select().single()
    if (taskError) throw taskError
    const task = mapTask(data)
    const projectTitle = projects.find((project) => project.id === projectId)?.title ?? 'Project'
    setUpcomingTasks((current) => [...current, { ...task, projectTitle }].slice(0, 12))
    return task
  }, [demoMode, demoState, persistDemo, projects, user])

  const toggleProjectTask = useCallback(async (task: ProjectTask) => {
    const next = { ...task, completed: !task.completed }
    if (demoMode || !supabase) { persistDemo({ ...demoState, tasks: demoState.tasks.map((item) => item.id === task.id ? next : item) }); return next }
    const { data, error: taskError } = await supabase.from('project_tasks').update({ completed: next.completed }).eq('id', task.id).select().single()
    if (taskError) throw taskError
    const updated = mapTask(data)
    setUpcomingTasks((current) => updated.completed
      ? current.filter((item) => item.id !== updated.id)
      : [...current.filter((item) => item.id !== updated.id), { ...updated, projectTitle: projects.find((project) => project.id === updated.projectId)?.title ?? 'Project' }].slice(0, 12))
    return updated
  }, [demoMode, demoState, persistDemo, projects])

  const deleteProjectTask = useCallback(async (task: ProjectTask) => {
    if (demoMode || !supabase) { persistDemo({ ...demoState, tasks: demoState.tasks.filter((item) => item.id !== task.id) }); return }
    const { error: taskError } = await supabase.from('project_tasks').delete().eq('id', task.id)
    if (taskError) throw taskError
    setUpcomingTasks((current) => current.filter((item) => item.id !== task.id))
  }, [demoMode, demoState, persistDemo])

  const listProjectNotes = useCallback(async (projectId: string) => {
    if (demoMode || !supabase) return demoState.notes.filter((note) => note.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const { data, error: noteError } = await supabase.from('project_notes').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
    if (noteError) throw noteError
    return (data ?? []).map(mapNote)
  }, [demoMode, demoState.notes])

  const createProjectNote = useCallback(async (projectId: string, body: string) => {
    if (!user) throw new Error('Sign in to add a journal entry.')
    const now = new Date().toISOString()
    if (demoMode || !supabase) {
      const note: ProjectNote = { id: crypto.randomUUID(), projectId, householdId: user.householdId, authorId: user.id, body, createdAt: now, updatedAt: now }
      persistDemo({ ...demoState, notes: [note, ...demoState.notes] }); return note
    }
    const { data, error: noteError } = await supabase.from('project_notes').insert({ household_id: user.householdId, project_id: projectId, author_id: user.id, body }).select().single()
    if (noteError) throw noteError
    return mapNote(data)
  }, [demoMode, demoState, persistDemo, user])

  const dashboard = useMemo<DashboardSnapshot>(() => {
    const activeProjects = projects.filter((project) => ['in_progress', 'planned', 'paused'].includes(project.status)).sort((a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt))
    const recentPatterns = [...patterns].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
    return { activeProjects, recentPatterns, nextTasks: upcomingTasks, totals: { patterns: patterns.length, crochet: patterns.filter((pattern) => pattern.craft === 'Crochet').length,
      knit: patterns.filter((pattern) => pattern.craft === 'Knit').length, projects: projects.length, completed: projects.filter((project) => project.status === 'complete').length } }
  }, [patterns, projects, upcomingTasks])

  const value = useMemo<DataContextValue>(() => ({ patterns, projects, preferences, dashboard, loading, error, offlineIssueCount, refresh, retryOfflineChanges, toggleFavorite, createProject,
    updateProject, createPattern, updatePattern, uploadPatternFile, uploadPatternThumbnail, updatePreferences, getPattern: (id) => patterns.find((pattern) => pattern.id === id),
    getProject: (id) => projects.find((project) => project.id === id), getPatternFile, getPdfBytes, listAnnotations, saveAnnotation,
    deleteAnnotation, listCounters, createCounter, incrementCounter, loadPdfSession, savePdfSession, listProjectTasks,
    createProjectTask, toggleProjectTask, deleteProjectTask, listProjectNotes, createProjectNote }),
  [createCounter, createPattern, createProject, dashboard, deleteAnnotation, error, getPatternFile, getPdfBytes, incrementCounter, listAnnotations, listCounters, loadPdfSession,
    createProjectNote, createProjectTask, deleteProjectTask, listProjectNotes, listProjectTasks, loading, offlineIssueCount, patterns, preferences, projects, refresh, retryOfflineChanges,
    saveAnnotation, savePdfSession, toggleFavorite, toggleProjectTask, updatePattern, updatePreferences, updateProject, uploadPatternFile, uploadPatternThumbnail])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useAppData() {
  const value = useContext(DataContext)
  if (!value) throw new Error('useAppData must be used inside DataProvider')
  const { user } = useAuth()
  return { ...value, user }
}
