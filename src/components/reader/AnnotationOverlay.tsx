import { useRef, useState, type PointerEvent } from 'react'
import { Check, MapPin, MessageSquareText, Trash2 } from 'lucide-react'
import type { AnnotationGeometry, AnnotationType, PdfAnnotation } from '@/lib/types'
import { clamp, cx } from '@/lib/utils'

interface AnnotationOverlayProps {
  annotations: PdfAnnotation[]
  activeTool: AnnotationType | 'pan' | 'select'
  color: string
  opacity: number
  thickness: number
  sticker: string
  noteText: string
  disabled?: boolean
  onCreate(type: AnnotationType, geometry: AnnotationGeometry, content?: PdfAnnotation['content']): void
  onDelete(annotation: PdfAnnotation): void
  onMove(annotation: PdfAnnotation, geometry: AnnotationGeometry): void
}

interface DraftRect { x: number; y: number; width: number; height: number }

export function AnnotationOverlay({ annotations, activeTool, color, opacity, thickness, sticker, noteText, disabled, onCreate, onDelete, onMove }: AnnotationOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [drag, setDrag] = useState<{ annotation: PdfAnnotation; offsetX: number; offsetY: number; geometry: AnnotationGeometry } | null>(null)

  const point = (event: PointerEvent) => {
    const bounds = rootRef.current!.getBoundingClientRect()
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) }
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || ['pan', 'select'].includes(activeTool)) return
    const start = point(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (activeTool === 'sticker') onCreate('sticker', { ...start, width: 0.075, height: 0.075 }, { sticker })
    else if (activeTool === 'note') onCreate('note', { ...start, width: 0.12, height: 0.06 }, { text: noteText || 'Note' })
    else if (activeTool === 'check') onCreate('check', { ...start, width: 0.055, height: 0.055 }, { label: 'Checked' })
    else if (activeTool === 'row_guide') onCreate('row_guide', { x: 0.02, y: start.y, width: 0.96, height: 0.012 }, { label: 'Stopped here' })
    else setDraft({ x: start.x, y: start.y, width: 0, height: 0 })
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) {
      const next = point(event)
      setDrag((current) => current ? { ...current, geometry: { ...current.geometry, x: clamp(next.x - current.offsetX, 0, 1 - current.geometry.width), y: clamp(next.y - current.offsetY, 0, 1 - current.geometry.height) } } : null)
      return
    }
    if (!draft) return
    const next = point(event)
    setDraft({ x: Math.min(draft.x, next.x), y: Math.min(draft.y, next.y), width: Math.abs(next.x - draft.x), height: Math.abs(next.y - draft.y) })
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) { onMove(drag.annotation, drag.geometry); setDrag(null); return }
    if (!draft) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const min = activeTool === 'line' ? 0.006 : 0.012
    const geometry = { ...draft, width: Math.max(draft.width, min), height: Math.max(draft.height, activeTool === 'line' ? 0.008 : min) }
    onCreate(activeTool as AnnotationType, geometry)
    setDraft(null)
  }

  return (
    <div ref={rootRef} className={cx('annotation-overlay', activeTool !== 'pan' && 'annotation-overlay--active')} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} aria-label="PDF annotation layer">
      {annotations.map((annotation) => {
        const visibleGeometry = drag?.annotation.id === annotation.id ? drag.geometry : annotation.geometry
        const { x, y, width, height } = visibleGeometry
        const style = { left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`, '--mark-color': annotation.style.color, '--mark-opacity': annotation.style.opacity, '--mark-thickness': `${annotation.style.thickness}px` } as React.CSSProperties
        return (
          <div key={annotation.id} className={cx('pdf-mark', `pdf-mark--${annotation.type}`, activeTool === 'select' && 'pdf-mark--selectable')} style={style}
            onPointerDown={(event) => {
              if (activeTool !== 'select') return
              event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
              const p = point(event); setDrag({ annotation, offsetX: p.x - x, offsetY: p.y - y, geometry: annotation.geometry })
            }}
            aria-label={`${annotation.type} annotation${annotation.content.text ? `: ${annotation.content.text}` : ''}`}>
            {annotation.type === 'sticker' && <span className="pdf-mark__sticker">{annotation.content.sticker}</span>}
            {annotation.type === 'note' && <span className="pdf-mark__note"><MessageSquareText aria-hidden="true" />{annotation.content.text}</span>}
            {annotation.type === 'check' && <span className="pdf-mark__check"><Check aria-hidden="true" /></span>}
            {annotation.type === 'row_guide' && <span className="pdf-mark__guide"><MapPin aria-hidden="true" />{annotation.content.label}</span>}
            {activeTool === 'select' && <button type="button" className="pdf-mark__delete" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDelete(annotation) }} aria-label="Delete annotation"><Trash2 aria-hidden="true" /></button>}
          </div>
        )
      })}
      {draft && <div className={cx('pdf-mark', `pdf-mark--${activeTool}`, 'pdf-mark--draft')} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%`, '--mark-color': color, '--mark-opacity': opacity, '--mark-thickness': `${thickness}px` } as React.CSSProperties} />}
    </div>
  )
}
