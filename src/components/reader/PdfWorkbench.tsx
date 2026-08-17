import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { CheckSquare, ChevronLeft, ChevronRight, Highlighter, Hand, Layers3, MessageSquareText, MousePointer2, Pencil, RectangleHorizontal, Rows3, StickyNote, ZoomIn, ZoomOut } from 'lucide-react'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import type { AnnotationGeometry, AnnotationType, PdfAnnotation, RowCounter } from '@/lib/types'
import { AnnotationOverlay } from './AnnotationOverlay'
import { RowCounterDock } from './RowCounterDock'
import { clamp, cx } from '@/lib/utils'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

interface PdfWorkbenchProps {
  title: string
  bytes: Uint8Array | null
  initialPage?: number
  annotations: PdfAnnotation[]
  counters: RowCounter[]
  selectedCounterId: string | null
  saving: 'saved' | 'saving' | 'offline' | 'error'
  initialColor?: string
  initialThickness?: number
  onPageChange(page: number): void
  onCreateAnnotation(type: AnnotationType, page: number, geometry: AnnotationGeometry, content?: PdfAnnotation['content'], style?: PdfAnnotation['style']): void
  onUpdateAnnotation(annotation: PdfAnnotation, geometry: AnnotationGeometry): void
  onDeleteAnnotation(annotation: PdfAnnotation): void
  onCounterSelect(id: string): void
  onCounterIncrement(id: string, delta: number): Promise<void>
  onCounterCreate(name: string): Promise<void>
}

const tools: Array<{ id: AnnotationType | 'pan' | 'select'; label: string; icon: typeof Hand }> = [
  { id: 'pan', label: 'Pan', icon: Hand }, { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'highlight', label: 'Highlight', icon: Highlighter }, { id: 'pen', label: 'Mark', icon: Pencil },
  { id: 'rectangle', label: 'Rectangle', icon: RectangleHorizontal }, { id: 'note', label: 'Note', icon: MessageSquareText },
  { id: 'sticker', label: 'Sticker', icon: StickyNote }, { id: 'row_guide', label: 'Row guide', icon: Rows3 },
  { id: 'check', label: 'Check', icon: CheckSquare },
]

export function PdfWorkbench(props: PdfWorkbenchProps) {
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(Math.max(1, props.initialPage ?? 1))
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<AnnotationType | 'pan' | 'select'>('pan')
  const [color, setColor] = useState(props.initialColor ?? '#f2b84b')
  const [opacity, setOpacity] = useState(0.42)
  const [thickness, setThickness] = useState(props.initialThickness ?? 4)
  const [sticker, setSticker] = useState('📍')
  const [noteText, setNoteText] = useState('')
  const [panel, setPanel] = useState<'tools' | 'notes' | 'progress'>('tools')
  const [pageWidth, setPageWidth] = useState(720)
  const canvasShell = useRef<HTMLDivElement>(null)
  const pdfData = useMemo(() => props.bytes ? { data: props.bytes.slice() } : null, [props.bytes])

  useEffect(() => {
    const node = canvasShell.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setPageWidth(Math.max(280, Math.min(940, entry.contentRect.width - 32))))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const changePage = useCallback((next: number) => {
    const safe = clamp(next, 1, Math.max(1, pageCount)); setPage(safe); props.onPageChange(safe)
  }, [pageCount, props])

  const pageAnnotations = props.annotations.filter((annotation) => annotation.pageNumber === page && !annotation.deletedAt)

  if (!pdfData) {
    return (
      <div className="reader-empty">
        <Layers3 aria-hidden="true" />
        <h2>No PDF attached yet</h2>
        <p>Upload the private pattern PDF from the pattern page, then return here to annotate it and track rows.</p>
        <RowCounterDock counters={props.counters} selectedId={props.selectedCounterId} onSelect={props.onCounterSelect} onIncrement={props.onCounterIncrement} onCreate={props.onCounterCreate} />
      </div>
    )
  }

  return (
    <div className="pdf-workbench">
      <header className="pdf-workbench__bar">
        <div><strong>{props.title}</strong><span className={cx('save-state', `save-state--${props.saving}`)}>{props.saving === 'saved' ? 'Saved' : props.saving === 'saving' ? 'Saving…' : props.saving === 'offline' ? 'Offline · queued' : 'Couldn’t sync'}</span></div>
        <div className="pdf-workbench__page-controls">
          <button type="button" onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft /></button>
          <label>Page <input value={page} min={1} max={pageCount} type="number" onChange={(event) => changePage(Number(event.target.value))} /> of {pageCount || '…'}</label>
          <button type="button" onClick={() => changePage(page + 1)} disabled={page >= pageCount} aria-label="Next page"><ChevronRight /></button>
        </div>
        <div className="pdf-workbench__zoom">
          <button type="button" onClick={() => setZoom((value) => clamp(value - 0.1, 0.55, 2.2))} aria-label="Zoom out"><ZoomOut /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => clamp(value + 0.1, 0.55, 2.2))} aria-label="Zoom in"><ZoomIn /></button>
        </div>
      </header>

      <div className="pdf-workbench__body">
        <aside className="reader-tools" aria-label="Annotation tools">
          {tools.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tool === id ? 'is-active' : ''} onClick={() => setTool(id)} title={label} aria-label={label} aria-pressed={tool === id}><Icon /></button>)}
        </aside>

        <main ref={canvasShell} className={cx('pdf-stage', tool === 'pan' && 'pdf-stage--pan')}>
          <div className="pdf-page-shell" style={{ width: pageWidth * zoom }}>
            <Document file={pdfData} loading={<div className="pdf-loading">Opening private PDF…</div>} onLoadSuccess={({ numPages }) => { setPageCount(numPages); if (page > numPages) changePage(numPages) }} onLoadError={(error) => console.error('PDF load failed', error)}>
              <Page pageNumber={page} width={pageWidth * zoom} renderAnnotationLayer renderTextLayer />
            </Document>
            <AnnotationOverlay annotations={pageAnnotations} activeTool={tool} color={color} opacity={opacity} thickness={thickness} sticker={sticker} noteText={noteText}
              onCreate={(type, geometry, content) => props.onCreateAnnotation(type, page, geometry, content, { color, opacity, thickness })} onDelete={props.onDeleteAnnotation} onMove={props.onUpdateAnnotation} />
          </div>
        </main>

        <aside className="reader-panel">
          <div className="reader-panel__tabs" role="tablist">
            {(['tools', 'notes', 'progress'] as const).map((value) => <button key={value} role="tab" type="button" aria-selected={panel === value} onClick={() => setPanel(value)}>{value}</button>)}
          </div>
          {panel === 'tools' && <div className="reader-panel__section">
            <h2>Annotation style</h2>
            <label>Color <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
            <label>Opacity <input type="range" min="0.15" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>
            <label>Thickness <input type="range" min="1" max="12" step="1" value={thickness} onChange={(event) => setThickness(Number(event.target.value))} /></label>
            <label>Note text <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Type a note, then place it on the page" rows={3} /></label>
            <fieldset><legend>Sticker</legend><div className="sticker-grid">{['📍', '✅', '↩️', '⚠️', '🧶', '⭐', '❤️', '🔢'].map((value) => <button key={value} type="button" className={sticker === value ? 'is-active' : ''} onClick={() => { setSticker(value); setTool('sticker') }} aria-label={`Sticker ${value}`}>{value}</button>)}</div></fieldset>
            <p className="muted">Choose a tool, then tap or drag on the page. Select lets you move or delete marks.</p>
          </div>}
          {panel === 'notes' && <div className="reader-panel__section"><h2>Page {page} marks</h2>{pageAnnotations.length ? <ol className="annotation-list">{pageAnnotations.map((annotation) => <li key={annotation.id}><button type="button" onClick={() => setTool('select')}><span>{annotation.type}</span><small>{annotation.content.text || annotation.content.label || annotation.content.sticker || 'Visual mark'}</small></button></li>)}</ol> : <p className="empty-copy">No marks on this page.</p>}</div>}
          {panel === 'progress' && <div className="reader-panel__section"><RowCounterDock counters={props.counters} selectedId={props.selectedCounterId} onSelect={props.onCounterSelect} onIncrement={props.onCounterIncrement} onCreate={props.onCounterCreate} /></div>}
        </aside>
      </div>

      <div className="reader-counter-mobile"><RowCounterDock counters={props.counters} selectedId={props.selectedCounterId} onSelect={props.onCounterSelect} onIncrement={props.onCounterIncrement} onCreate={props.onCounterCreate} /></div>
    </div>
  )
}
