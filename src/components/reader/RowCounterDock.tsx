import { useEffect, useState } from 'react'
import { Minus, Plus, RotateCcw, Rows3 } from 'lucide-react'
import type { RowCounter } from '@/lib/types'

interface RowCounterDockProps {
  counters: RowCounter[]
  selectedId: string | null
  busy?: boolean
  onSelect(id: string): void
  onIncrement(id: string, delta: number): Promise<void>
  onCreate(name: string): Promise<void>
}

export function RowCounterDock({ counters, selectedId, busy, onSelect, onIncrement, onCreate }: RowCounterDockProps) {
  const [announced, setAnnounced] = useState('')
  const selected = counters.find((counter) => counter.id === selectedId) ?? counters[0]

  useEffect(() => {
    if (selected) setAnnounced(`${selected.name}: ${selected.currentValue}`)
  }, [selected])

  if (!selected) {
    return <button className="counter-empty" type="button" onClick={() => void onCreate('Main rows')}><Rows3 aria-hidden="true" />Add a row counter</button>
  }

  const change = async (delta: number) => {
    await onIncrement(selected.id, delta)
    setAnnounced(`${selected.name} changed by ${delta}`)
  }

  return (
    <section className="row-counter" aria-labelledby="row-counter-title">
      <div className="row-counter__heading">
        <Rows3 aria-hidden="true" />
        <label id="row-counter-title" htmlFor="counter-select">Row counter</label>
        <select id="counter-select" value={selected.id} onChange={(event) => onSelect(event.target.value)}>
          {counters.map((counter) => <option key={counter.id} value={counter.id}>{counter.name}</option>)}
        </select>
      </div>
      <div className="row-counter__controls">
        <button type="button" disabled={busy || selected.currentValue <= 0} onClick={() => void change(-selected.step)} aria-label={`Subtract ${selected.step}`}><Minus aria-hidden="true" /></button>
        <div className="row-counter__value"><strong>{selected.currentValue}</strong>{selected.target ? <span>of {selected.target}</span> : <span>current row</span>}</div>
        <button type="button" disabled={busy} onClick={() => void change(selected.step)} aria-label={`Add ${selected.step}`}><Plus aria-hidden="true" /></button>
      </div>
      <div className="row-counter__meta">
        {selected.repeatLength && <span>Repeat every {selected.repeatLength}</span>}
        <button type="button" disabled={busy || selected.currentValue === 0} onClick={() => void change(-selected.currentValue)}><RotateCcw aria-hidden="true" />Reset</button>
      </div>
      <p className="sr-only" aria-live="polite">{announced}</p>
    </section>
  )
}
