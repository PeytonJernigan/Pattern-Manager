import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, TriangleAlert } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { PdfWorkbench } from '@/components/reader/PdfWorkbench'
import { useAppData } from '@/lib/data'
import type { AnnotationGeometry, AnnotationType, PatternFile, PdfAnnotation, PdfSession, RowCounter } from '@/lib/types'

function playCounterTone(delta: number) {
  const AudioContextClass = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  try {
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = delta >= 0 ? 660 : 440
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.09)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.1)
    oscillator.addEventListener('ended', () => void context.close(), { once: true })
  } catch {
    // Sound feedback is optional; counter changes must never depend on audio support.
  }
}

export default function ReaderPage() {
  const { projectId } = useParams()
  const {
    user, preferences, getProject, getPatternFile, getPdfBytes, listAnnotations, saveAnnotation, deleteAnnotation,
    listCounters, createCounter, incrementCounter, loadPdfSession, savePdfSession,
  } = useAppData()
  const project = projectId ? getProject(projectId) : undefined
  const assetId = project?.pattern?.primaryFileId ?? null
  const [file, setFile] = useState<PatternFile | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [counters, setCounters] = useState<RowCounter[]>([])
  const [session, setSession] = useState<PdfSession | null>(null)
  const [selectedCounterId, setSelectedCounterId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<'saved' | 'saving' | 'offline' | 'error'>('saved')

  useEffect(() => {
    if (!project || !user) { setLoading(false); return }
    let active = true
    async function openWorkbench() {
      setLoading(true); setError(null)
      try {
        const loadedCounters = await listCounters(project!.id)
        if (!active) return
        setCounters(loadedCounters)
        setSelectedCounterId(loadedCounters[0]?.id ?? null)
        if (!assetId) return
        const loadedFile = await getPatternFile(assetId)
        if (!active || !loadedFile) return
        setFile(loadedFile)
        const [pdfBytes, loadedAnnotations, loadedSession] = await Promise.all([
          getPdfBytes(loadedFile), listAnnotations(project!.id, assetId), loadPdfSession(project!.id, assetId),
        ])
        if (!active) return
        setBytes(pdfBytes); setAnnotations(loadedAnnotations); setSession(loadedSession)
        setSelectedCounterId(loadedSession?.selectedCounterId ?? loadedCounters[0]?.id ?? null)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'The private pattern could not be opened.')
      } finally { if (active) setLoading(false) }
    }
    void openWorkbench()
    return () => { active = false }
  }, [assetId, getPatternFile, getPdfBytes, listAnnotations, listCounters, loadPdfSession, project, user])

  const persistSession = useCallback(async (updates: Partial<PdfSession>) => {
    if (!project || !assetId || !user) return
    const now = new Date().toISOString()
    const next: PdfSession = {
      id: session?.id ?? crypto.randomUUID(), projectId: project.id, patternFileId: assetId, userId: user.id,
      currentPage: session?.currentPage ?? 1, zoom: session?.zoom ?? 1, fitMode: session?.fitMode ?? 'width',
      scrollOffset: session?.scrollOffset ?? 0, selectedCounterId, updatedAt: now, ...updates,
    }
    setSession(next)
    try { await savePdfSession(next) } catch { setSaving(navigator.onLine ? 'error' : 'offline') }
  }, [assetId, project, savePdfSession, selectedCounterId, session, user])

  const createAnnotation = useCallback(async (type: AnnotationType, pageNumber: number, geometry: AnnotationGeometry, content: PdfAnnotation['content'] = {}, style?: PdfAnnotation['style']) => {
    if (!project || !assetId || !user) return
    const now = new Date().toISOString()
    const annotation: PdfAnnotation = {
      id: crypto.randomUUID(), clientMutationId: crypto.randomUUID(), projectId: project.id, patternFileId: assetId,
      householdId: user.householdId, authorId: user.id, pageNumber, type, geometry, content,
      style: style ?? { color: preferences.annotationColor, opacity: type === 'highlight' ? 0.42 : 0.9, thickness: preferences.annotationThickness },
      revision: 1, deletedAt: null, createdAt: now, updatedAt: now,
    }
    setAnnotations((current) => [...current, annotation]); setSaving('saving')
    try { await saveAnnotation(annotation); setSaving('saved') }
    catch { setSaving(navigator.onLine ? 'error' : 'offline') }
  }, [assetId, preferences.annotationColor, preferences.annotationThickness, project, saveAnnotation, user])

  const moveAnnotation = useCallback(async (annotation: PdfAnnotation, geometry: AnnotationGeometry) => {
    const next = { ...annotation, geometry, revision: annotation.revision + 1, updatedAt: new Date().toISOString(), clientMutationId: crypto.randomUUID() }
    setAnnotations((current) => current.map((item) => item.id === next.id ? next : item)); setSaving('saving')
    try { await saveAnnotation(next); setSaving('saved') }
    catch { setSaving(navigator.onLine ? 'error' : 'offline') }
  }, [saveAnnotation])

  const removeAnnotation = useCallback(async (annotation: PdfAnnotation) => {
    setAnnotations((current) => current.filter((item) => item.id !== annotation.id)); setSaving('saving')
    try { await deleteAnnotation(annotation); setSaving('saved') }
    catch { setAnnotations((current) => [...current, annotation]); setSaving(navigator.onLine ? 'error' : 'offline') }
  }, [deleteAnnotation])

  const changeCounter = useCallback(async (id: string, delta: number) => {
    const updated = await incrementCounter(id, delta)
    setCounters((current) => current.map((counter) => counter.id === id ? updated : counter))
    if (preferences.counterSound) playCounterTone(delta)
  }, [incrementCounter, preferences.counterSound])

  const addCounter = useCallback(async (name: string) => {
    if (!project) return
    const counter = await createCounter(project.id, name)
    setCounters((current) => [...current, counter]); setSelectedCounterId(counter.id)
    await persistSession({ selectedCounterId: counter.id })
  }, [createCounter, persistSession, project])

  const title = useMemo(() => project?.pattern?.title || project?.title || 'Pattern reader', [project])

  if (!project) return <main className="reader-route reader-route--message"><TriangleAlert /><h1>Project not found</h1><Link to="/projects">Return to projects</Link></main>
  if (loading) return <main className="reader-route reader-route--message" role="status"><span className="spinner" /><h1>Opening your workbench…</h1><p>Loading the private PDF, marks, counters, and saved page.</p></main>

  return (
    <main className="reader-route">
      <nav className="reader-breadcrumb"><Link to={`/projects/${project.id}`}><ArrowLeft />Back to {project.title}</Link><span><BookOpen />Private project workbench</span></nav>
      {error && <div className="error-banner" role="alert"><TriangleAlert /><div><strong>The PDF could not be loaded.</strong><span>{error}</span></div></div>}
      <PdfWorkbench
        title={title} bytes={bytes} initialPage={session?.currentPage ?? 1} annotations={annotations} counters={counters}
        selectedCounterId={selectedCounterId} saving={saving} initialColor={preferences.annotationColor} initialThickness={preferences.annotationThickness}
        onPageChange={(page) => void persistSession({ currentPage: page })}
        onCreateAnnotation={(type, page, geometry, content, style) => void createAnnotation(type, page, geometry, content, style)}
        onUpdateAnnotation={(annotation, geometry) => void moveAnnotation(annotation, geometry)}
        onDeleteAnnotation={(annotation) => void removeAnnotation(annotation)}
        onCounterSelect={(id) => { setSelectedCounterId(id); void persistSession({ selectedCounterId: id }) }}
        onCounterIncrement={changeCounter} onCounterCreate={addCounter}
      />
      {!file && !assetId && <p className="reader-hint">Attach a private PDF from the linked pattern page to unlock page annotations. Row counters already work for this project.</p>}
    </main>
  )
}
