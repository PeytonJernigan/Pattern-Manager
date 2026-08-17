export type Craft = 'Crochet' | 'Knit' | 'Sewing' | 'Embroidery' | 'Quilting' | 'Art' | 'DIY' | 'Other'

export type ProjectStatus = 'idea' | 'planned' | 'in_progress' | 'paused' | 'complete' | 'abandoned' | 'archived'
export type ProjectVisibility = 'private' | 'household'
export type AnnotationType = 'pen' | 'highlight' | 'line' | 'rectangle' | 'note' | 'sticker' | 'row_guide' | 'check'
export type ThemePreference = 'system' | 'light' | 'dark' | 'high-contrast'

export interface Pattern {
  id: string
  legacyId: string | null
  householdId: string
  title: string
  craft: Craft | string
  category: string | null
  itemType: string | null
  itemSubtype: string | null
  designer: string | null
  publisher: string | null
  description: string | null
  thumbnailPath: string | null
  primaryFileId: string | null
  sourceUrl: string | null
  skillLevel: string | null
  yarnWeight: string | null
  sizeSummary: string | null
  freeStatus: string | null
  accessStatus: string | null
  tags: string[]
  metadata: Record<string, unknown>
  favorite?: boolean
  createdAt: string
  updatedAt: string
}

export interface PatternFile {
  id: string
  patternId: string
  householdId: string
  storagePath: string
  originalName: string
  mimeType: string
  sha256: string | null
  pageCount: number | null
  version: number
  language: string | null
  role: string
  createdAt: string
}

export interface CreativeProject {
  id: string
  householdId: string
  createdBy: string
  ownerId: string
  patternId: string | null
  title: string
  craft: Craft | string
  status: ProjectStatus
  visibility: ProjectVisibility
  progress: number
  currentSection: string | null
  sizeLabel: string | null
  colorway: string | null
  notes: string | null
  coverPath: string | null
  startDate: string | null
  targetDate: string | null
  completedAt: string | null
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
  pattern?: Pick<Pattern, 'id' | 'title' | 'thumbnailPath' | 'primaryFileId'> | null
}

export interface ProjectTask {
  id: string
  projectId: string
  householdId: string
  title: string
  completed: boolean
  position: number
  dueDate: string | null
  createdAt: string
}

export interface ProjectNote {
  id: string
  projectId: string
  householdId: string
  authorId: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface RowCounter {
  id: string
  projectId: string
  householdId: string
  userId: string
  name: string
  currentValue: number
  step: number
  target: number | null
  repeatLength: number | null
  revision: number
  updatedAt: string
}

export interface PdfSession {
  id: string
  projectId: string
  patternFileId: string
  userId: string
  currentPage: number
  zoom: number
  fitMode: 'width' | 'page' | 'custom'
  scrollOffset: number
  selectedCounterId: string | null
  updatedAt: string
}

export interface AnnotationGeometry {
  x: number
  y: number
  width: number
  height: number
  points?: Array<{ x: number; y: number }>
}

export interface PdfAnnotation {
  id: string
  clientMutationId: string
  projectId: string
  patternFileId: string
  householdId: string
  authorId: string
  pageNumber: number
  type: AnnotationType
  geometry: AnnotationGeometry
  content: { text?: string; sticker?: string; label?: string }
  style: { color: string; opacity: number; thickness: number }
  revision: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface UserPreferences {
  theme: ThemePreference
  libraryView: 'grid' | 'list'
  libraryDensity: 'comfortable' | 'compact'
  defaultCraft: string | null
  unitSystem: 'imperial' | 'metric' | 'both'
  yarnLengthUnit: 'yards' | 'meters' | 'both'
  pdfFitMode: 'width' | 'page'
  annotationColor: string
  annotationThickness: number
  favoriteStickers: string[]
  defaultProjectVisibility: ProjectVisibility
  reducedMotion: boolean
  counterSound: boolean
}

export interface AppUser {
  id: string
  email: string
  displayName: string
  householdId: string
  role: 'owner' | 'member'
}

export interface DashboardSnapshot {
  activeProjects: CreativeProject[]
  recentPatterns: Pattern[]
  nextTasks: Array<ProjectTask & { projectTitle: string }>
  totals: { patterns: number; crochet: number; knit: number; projects: number; completed: number }
}

export interface PatternFilters {
  search: string
  craft: string
  category: string
  skill: string
  yarnWeight: string
  favoriteOnly: boolean
  sort: 'recent' | 'title' | 'skill'
}

export const defaultPreferences: UserPreferences = {
  theme: 'system',
  libraryView: 'grid',
  libraryDensity: 'comfortable',
  defaultCraft: null,
  unitSystem: 'both',
  yarnLengthUnit: 'both',
  pdfFitMode: 'width',
  annotationColor: '#d96d4a',
  annotationThickness: 4,
  favoriteStickers: ['📍', '✅', '↩️', '⚠️', '🧶', '⭐'],
  defaultProjectVisibility: 'household',
  reducedMotion: false,
  counterSound: false,
}
