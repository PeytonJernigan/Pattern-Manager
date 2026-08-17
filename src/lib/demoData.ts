import type { CreativeProject, Pattern, PdfAnnotation, RowCounter, UserPreferences } from './types'
import { defaultPreferences } from './types'

const now = new Date().toISOString()
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString()

export const demoPatterns: Pattern[] = [
  ['DEMO-0001', 'Harbor Light Cardigan', 'Crochet', 'Garments', 'Cardigan', 'Intermediate', '4 Medium', 'XS–5XL'],
  ['DEMO-0002', 'Moon Garden Baby Dress', 'Knit', 'Baby and Kids', 'Dress', 'Intermediate', '3 Light', '6–24 months'],
  ['DEMO-0003', 'Saturday Trail Hat', 'Crochet', 'Accessories', 'Hat', 'Easy', '4 Medium', 'Adult'],
  ['DEMO-0004', 'Pocket-Sized Cloud Beanie', 'Crochet', 'Baby and Kids', 'Hat', 'Easy', '3 Light', 'Baby'],
  ['DEMO-0005', 'Northwind Weekend Pullover', 'Knit', 'Garments', 'Pullover', 'Intermediate', '2 Fine', 'XS–5XL'],
  ['DEMO-0006', 'Picnic Heart Layering Vest', 'Crochet', 'Garments', 'Vest', 'Easy', '4 Medium', 'XS–5XL'],
].map(([legacyId, title, craft, category, itemType, skillLevel, yarnWeight, sizeSummary], index) => ({
  id: `demo-pattern-${index + 1}`,
  legacyId,
  householdId: 'demo-household',
  title,
  craft,
  category,
  itemType,
  itemSubtype: null,
  designer: index === 4 ? 'Demo Maker Studio' : null,
  publisher: 'Fictional preview catalog',
  description: `${title} is sample catalog content used to preview the private app before Supabase is connected. Importing the real catalog replaces this record with its complete sizes, yarn, tools, source, and credit data.`,
  thumbnailPath: null,
  primaryFileId: null,
  sourceUrl: null,
  skillLevel,
  yarnWeight,
  sizeSummary,
  freeStatus: 'Yes',
  accessStatus: 'Available',
  tags: [craft.toLowerCase(), category.toLowerCase(), itemType.toLowerCase()],
  metadata: {},
  favorite: index === 0 || index === 4,
  createdAt: day(-30 + index),
  updatedAt: day(-index),
}))

export const demoProjects: CreativeProject[] = [
  {
    id: 'demo-project-cardigan', householdId: 'demo-household', createdBy: 'demo-user', ownerId: 'demo-user',
    patternId: demoPatterns[0].id, title: 'Autumn Harbor Cardigan', craft: 'Crochet', status: 'in_progress',
    visibility: 'household', progress: 46, currentSection: 'Right front', sizeLabel: 'M', colorway: 'Rust and cream',
    notes: 'Check the front length before beginning the armhole shaping.', coverPath: null, startDate: day(-18).slice(0, 10),
    targetDate: day(30).slice(0, 10), completedAt: null, lastOpenedAt: now, createdAt: day(-20), updatedAt: now,
    pattern: { id: demoPatterns[0].id, title: demoPatterns[0].title, thumbnailPath: null, primaryFileId: null },
  },
  {
    id: 'demo-project-quilt', householdId: 'demo-household', createdBy: 'demo-user', ownerId: 'demo-user', patternId: null,
    title: 'Wildflower Memory Quilt', craft: 'Quilting', status: 'planned', visibility: 'household', progress: 12,
    currentSection: 'Choose backing', sizeLabel: null, colorway: 'Garden scraps', notes: 'A general creative project without a linked pattern.',
    coverPath: null, startDate: null, targetDate: day(75).slice(0, 10), completedAt: null, lastOpenedAt: day(-4),
    createdAt: day(-12), updatedAt: day(-4), pattern: null,
  },
]

export const demoCounters: RowCounter[] = [
  { id: 'demo-counter-body', projectId: demoProjects[0].id, householdId: 'demo-household', userId: 'demo-user', name: 'Body rows', currentValue: 37, step: 1, target: 80, repeatLength: 8, revision: 1, updatedAt: now },
  { id: 'demo-counter-cable', projectId: demoProjects[0].id, householdId: 'demo-household', userId: 'demo-user', name: 'Shell repeat', currentValue: 5, step: 1, target: 10, repeatLength: 2, revision: 1, updatedAt: now },
]

export const demoAnnotations: PdfAnnotation[] = []
export const demoPreferences: UserPreferences = defaultPreferences
