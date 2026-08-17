import { useRef, useState } from 'react'
import { BookOpen, ExternalLink, FileUp, Heart, ImageUp, Pencil, Play, Ruler, Scissors, Spool, Tags, UserRound } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppData } from '@/lib/data'
import { safeExternalUrl } from '@/lib/utils'

type MetaRow = Record<string, unknown>
interface CatalogMetadata {
  catalog?: MetaRow
  sources?: MetaRow[]
  sizes?: MetaRow[]
  measurements?: MetaRow[]
  yarnRequirements?: MetaRow[]
  materials?: MetaRow[]
  gauges?: MetaRow[]
  timeEstimates?: MetaRow[]
  palette?: MetaRow[]
  credits?: MetaRow[]
  reviewItems?: MetaRow[]
}

function value(row: MetaRow, ...keys: string[]) {
  for (const key of keys) if (row[key] !== null && row[key] !== undefined && row[key] !== '') return String(row[key])
  return null
}

function displayQuantity(row: MetaRow) {
  const quantity = value(row, 'published_quantity', 'balls_or_skeins', 'published_balls_or_skeins', 'balls_published', 'skeins_published')
  const unit = value(row, 'published_unit')
  const yards = value(row, 'normalized_yards', 'normalized_yards_min')
  const meters = value(row, 'normalized_meters', 'normalized_meters_min')
  return [quantity && unit ? `${quantity} ${unit}` : quantity, yards ? `${yards} yd` : null, meters ? `${meters} m` : null].filter(Boolean).join(' · ') || null
}

export default function PatternDetailPage() {
  const { patternId } = useParams()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const { getPattern, createProject, toggleFavorite, uploadPatternFile, uploadPatternThumbnail, user } = useAppData()
  const pattern = patternId ? getPattern(patternId) : undefined
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (!pattern) return <main className="page"><div className="empty-state"><h1>Pattern not found</h1><Link to="/patterns">Return to the library</Link></div></main>

  const metadata = pattern.metadata as CatalogMetadata
  const catalog = metadata.catalog ?? {}
  const sizes = metadata.sizes ?? []
  const measurements = metadata.measurements ?? []
  const yarn = metadata.yarnRequirements ?? []
  const materials = metadata.materials ?? []
  const gauges = metadata.gauges ?? []
  const credits = metadata.credits ?? []

  const startProject = async () => {
    setBusy(true)
    try {
      const project = await createProject({ title: `My ${pattern.title}`, craft: pattern.craft, patternId: pattern.id, status: 'in_progress' })
      navigate(`/projects/${project.id}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The project could not be created.') }
    finally { setBusy(false) }
  }

  const upload = async (file: File) => {
    setBusy(true); setMessage('Uploading private PDF…')
    try { await uploadPatternFile(pattern.id, file); setMessage('PDF attached. You can now open it from any linked project.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed.') }
    finally { setBusy(false) }
  }

  const uploadCover = async (file: File) => {
    setBusy(true); setMessage('Uploading private cover image…')
    try { await uploadPatternThumbnail(pattern.id, file); setMessage('Cover image updated.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Image upload failed.') }
    finally { setBusy(false) }
  }

  return (
    <main className="page pattern-detail">
      <nav className="breadcrumbs"><Link to="/patterns">Pattern library</Link><span>/</span><span>{pattern.legacyId || 'Custom pattern'}</span></nav>
      <header className="detail-hero">
        <div className="detail-cover">{pattern.thumbnailPath ? <img src={pattern.thumbnailPath} alt={`${pattern.title} cover`} /> : <Spool aria-hidden="true" />}<button className="cover-upload" type="button" onClick={() => imageInput.current?.click()} disabled={busy}><ImageUp />Change cover</button><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCover(file) }} /></div>
        <div className="detail-hero__content"><div className="badge-row"><span className="badge badge--craft">{pattern.craft}</span>{pattern.skillLevel && <span className="badge">{pattern.skillLevel}</span>}<span className="badge badge--free">{pattern.freeStatus || 'Access unknown'}</span></div>
          <p className="eyebrow">{pattern.publisher || 'Personal library'} · {pattern.legacyId || 'User added'}</p><h1>{pattern.title}</h1>
          <p className="lead">{pattern.description || 'Add a description, sizing, yarn, and source details whenever you are ready.'}</p>
          <div className="action-row"><button className="button button--primary" disabled={busy} onClick={() => void startProject()}><Play />Start a project</button>
            <button className="button" onClick={() => void toggleFavorite(pattern.id)} aria-pressed={pattern.favorite}><Heart fill={pattern.favorite ? 'currentColor' : 'none'} />{pattern.favorite ? 'Saved' : 'Save'}</button>
            <Link className="button" to={`/patterns/${pattern.id}/edit`}><Pencil />Edit</Link>
            {pattern.sourceUrl && safeExternalUrl(pattern.sourceUrl) && <a className="button button--quiet" href={pattern.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />Source</a>}
          </div>
          {message && <p className="form-message" role="status">{message}</p>}
        </div>
      </header>
      <section className="detail-grid">
        <article className="content-card"><h2><BookOpen />At a glance</h2><dl className="metadata-list"><div><dt>Type</dt><dd>{pattern.itemSubtype || pattern.itemType || pattern.category || 'Not classified'}</dd></div><div><dt>Designer</dt><dd>{pattern.designer || 'Not stated'}</dd></div><div><dt>Audience / sizes</dt><dd>{pattern.sizeSummary || 'See the pattern PDF'}</dd></div><div><dt>Yarn weight</dt><dd>{pattern.yarnWeight || 'Not recorded'}</dd></div><div><dt>Construction</dt><dd>{value(catalog, 'construction') || 'Not recorded'}</dd></div><div><dt>Estimated time</dt><dd>{value(catalog, 'timeBand') || 'Unknown'}</dd></div></dl></article>
        <article className="content-card"><h2><Ruler />Sizing</h2>{sizes.length ? <ul className="catalog-fact-list">{sizes.map((row, index) => <li key={value(row, 'size_id') ?? index}><strong>{value(row, 'original_label', 'original_size_label', 'normalized_label', 'normalized_size') || 'Published size'}</strong><span>{value(row, 'age_or_body_group', 'age_group') || 'See measurements'}</span></li>)}</ul> : <p>{pattern.sizeSummary || 'Published size details are in the instruction file.'}</p>}{measurements.length > 0 && <details className="catalog-details"><summary>{measurements.length} finished/body measurements</summary><ul>{measurements.map((row, index) => <li key={value(row, 'measurement_id') ?? index}><strong>{value(row, 'measurement_type', 'measurement_name_original') || 'Measurement'}</strong><span>{[value(row, 'size_label'), value(row, 'original_value_text', 'value_original'), value(row, 'unit_original')].filter(Boolean).join(' · ')}</span></li>)}</ul></details>}</article>
        <article className="content-card"><h2><Spool />Yarn requirements</h2>{yarn.length ? <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Size / option</th><th>Yarn and shade</th><th>Quantity</th></tr></thead><tbody>{yarn.map((row, index) => <tr key={value(row, 'yarn_requirement_id') ?? index}><td>{value(row, 'size_label', 'option_label', 'variant_label') || 'All sizes'}</td><td>{[value(row, 'brand', 'yarn_brand'), value(row, 'line', 'yarn_line'), value(row, 'shade_name')].filter(Boolean).join(' · ') || 'See PDF'}</td><td>{displayQuantity(row) || 'As stated'}</td></tr>)}</tbody></table></div> : <p>Yarn quantities have not been normalized for this record.</p>}</article>
        <article className="content-card"><h2><Scissors />Tools, notions & gauge</h2>{materials.length ? <ul className="catalog-fact-list">{materials.map((row, index) => <li key={value(row, 'material_id') ?? index}><strong>{value(row, 'item', 'description', 'material_type') || 'Material'}</strong><span>{[value(row, 'specification'), value(row, 'quantity'), value(row, 'required_or_optional')].filter(Boolean).join(' · ')}</span></li>)}</ul> : <p>See the instruction file for tools and notions.</p>}{gauges.length > 0 && <details className="catalog-details"><summary>Gauge / tension</summary>{gauges.map((row, index) => <p key={value(row, 'gauge_id') ?? index}>{value(row, 'statement', 'gauge_text') || 'See PDF'}</p>)}</details>}</article>
        {credits.length > 0 && <article className="content-card content-card--wide"><h2><UserRound />Credits</h2><div className="credit-grid">{credits.map((row, index) => <div key={value(row, 'externalId') ?? index}><strong>{value(row, 'name') || 'Creator not stated'}</strong><span>{value(row, 'role', 'printedByline') || 'Design credit'}</span>{Array.isArray(row.links) && <div>{(row.links as MetaRow[]).map((link, linkIndex) => { const url = value(link, 'url'); return url && safeExternalUrl(url) ? <a key={value(link, 'platform') ?? linkIndex} href={url} target="_blank" rel="noreferrer">{value(link, 'platform') || 'Official link'}<ExternalLink /></a> : null })}</div>}</div>)}</div></article>}
        <article className="content-card content-card--wide"><div className="section-heading"><div><h2><BookOpen />Pattern files</h2><p>The original PDF stays unchanged; annotations are saved separately for each project.</p></div><button className="button" type="button" onClick={() => fileInput.current?.click()} disabled={busy || !user}><FileUp />{pattern.primaryFileId ? 'Attach a new PDF version' : 'Attach private PDF'}</button></div>
          <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
          <div className="file-row"><BookOpen /><div><strong>{pattern.primaryFileId ? 'Private instruction PDF attached' : 'No PDF attached yet'}</strong><span>{pattern.primaryFileId ? 'Available to linked projects through authenticated storage.' : 'Upload the complete PDF to enable the reader and annotation workbench.'}</span></div></div>
          <div className="icon-facts"><span><Spool />{pattern.yarnWeight || 'Yarn details pending'}</span><span><Scissors />{materials.length || '—'} tools/notion rows</span><span><Tags />{pattern.tags.length} searchable tags</span></div>
        </article>
      </section>
    </main>
  )
}
