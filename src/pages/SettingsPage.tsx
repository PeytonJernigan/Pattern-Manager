import {
  Bell,
  BookOpen,
  Check,
  Eye,
  FileText,
  Gauge,
  Highlighter,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Ruler,
  Save,
  Sun,
  Users,
  Volume2,
} from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader, Toggle } from '@/components/common'
import { useAppData } from '@/lib/data'
import type { ThemePreference, UserPreferences } from '@/lib/types'

interface SettingsSectionProps {
  icon: typeof Palette
  title: string
  description: string
  children: ReactNode
}

function SettingsSection({ icon: Icon, title, description, children }: SettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <span aria-hidden="true"><Icon size={20} /></span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  )
}

const themes: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'high-contrast', label: 'High contrast', icon: Eye },
]

const annotationColors = ['#d96d4a', '#146b6b', '#e8b84a', '#7d618b', '#2d6ca2', '#2d8062', '#202e2b']

export function SettingsPage() {
  const { user, preferences, loading, updatePreferences } = useAppData()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    if (saveState !== 'saved') return
    const timeout = window.setTimeout(() => setSaveState('idle'), 2000)
    return () => window.clearTimeout(timeout)
  }, [saveState])

  async function save(patch: Partial<UserPreferences>) {
    setSaveState('saving')
    try {
      await updatePreferences(patch)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  if (loading || !preferences) {
    return (
      <div className="page settings-page">
        <PageHeader eyebrow="Make it yours" title="Settings" description="Loading your preferences…" />
        <div className="settings-loading" aria-busy="true"><span /><span /><span /></div>
      </div>
    )
  }

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Make it yours"
        title="Settings"
        description="These preferences follow your account across devices. They do not change the other household member’s experience."
        actions={
          <div className={`save-indicator save-indicator--${saveState}`} role="status" aria-live="polite">
            {saveState === 'saving' && <><Save size={17} aria-hidden="true" /> Saving…</>}
            {saveState === 'saved' && <><Check size={17} aria-hidden="true" /> Saved</>}
            {saveState === 'error' && <>Couldn’t save. Try again.</>}
            {saveState === 'idle' && <><span aria-hidden="true" /> All changes saved</>}
          </div>
        }
      />

      <div className="settings-layout">
        <div className="settings-main">
          <SettingsSection icon={Palette} title="Appearance" description="Choose how Pattern Manager looks for you.">
            <fieldset className="setting-fieldset">
              <legend>Color theme</legend>
              <div className="theme-picker">
                {themes.map(({ value, label, icon: Icon }) => (
                  <button key={value} type="button" className={preferences.theme === value ? 'is-active' : ''} aria-pressed={preferences.theme === value} onClick={() => void save({ theme: value })}>
                    <span aria-hidden="true"><Icon size={20} /></span>
                    <strong>{label}</strong>
                    {preferences.theme === value && <Check size={16} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="settings-grid settings-grid--two">
              <label className="setting-control"><span>Default library view</span><select value={preferences.libraryView} onChange={(event) => void save({ libraryView: event.target.value as UserPreferences['libraryView'] })}><option value="grid">Gallery</option><option value="list">List</option></select></label>
              <label className="setting-control"><span>Card density</span><select value={preferences.libraryDensity} onChange={(event) => void save({ libraryDensity: event.target.value as UserPreferences['libraryDensity'] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
            </div>
            <Toggle label="Reduce motion" description="Minimize movement and animated transitions throughout the app." checked={preferences.reducedMotion} onChange={(checked) => void save({ reducedMotion: checked })} />
          </SettingsSection>

          <SettingsSection icon={BookOpen} title="Pattern library" description="Set the defaults you use most while browsing.">
            <div className="settings-grid settings-grid--three">
              <label className="setting-control"><span>Preferred craft</span><select value={preferences.defaultCraft ?? ''} onChange={(event) => void save({ defaultCraft: event.target.value || null })}><option value="">Show everything</option><option>Crochet</option><option>Knit</option><option>Sewing</option><option>Embroidery</option><option>Quilting</option><option>Art</option><option>DIY</option><option>Other</option></select></label>
              <label className="setting-control"><span>Measurements</span><select value={preferences.unitSystem} onChange={(event) => void save({ unitSystem: event.target.value as UserPreferences['unitSystem'] })}><option value="both">Show both</option><option value="imperial">Imperial</option><option value="metric">Metric</option></select></label>
              <label className="setting-control"><span>Yarn length</span><select value={preferences.yarnLengthUnit} onChange={(event) => void save({ yarnLengthUnit: event.target.value as UserPreferences['yarnLengthUnit'] })}><option value="both">Yards & meters</option><option value="yards">Yards</option><option value="meters">Meters</option></select></label>
            </div>
            <div className="settings-tip"><Ruler size={19} aria-hidden="true" /><p>Original pattern measurements are always preserved. These settings only change how normalized values are displayed.</p></div>
          </SettingsSection>

          <SettingsSection icon={FileText} title="PDF workbench" description="Choose the defaults used when you open a pattern for a project.">
            <div className="settings-grid settings-grid--two">
              <label className="setting-control"><span>Open pages fitted to</span><select value={preferences.pdfFitMode} onChange={(event) => void save({ pdfFitMode: event.target.value as UserPreferences['pdfFitMode'] })}><option value="width">Page width</option><option value="page">Whole page</option></select></label>
              <label className="setting-control"><span>Default visibility for new projects</span><select value={preferences.defaultProjectVisibility} onChange={(event) => void save({ defaultProjectVisibility: event.target.value as UserPreferences['defaultProjectVisibility'] })}><option value="household">Shared with household</option><option value="private">Private to me</option></select></label>
            </div>

            <fieldset className="setting-fieldset annotation-setting">
              <legend>Default annotation color</legend>
              <div className="color-picker">
                {annotationColors.map((color) => (
                  <button key={color} type="button" style={{ '--swatch': color } as CSSProperties} className={preferences.annotationColor.toLowerCase() === color ? 'is-active' : ''} aria-label={`Use ${color} for annotations`} aria-pressed={preferences.annotationColor.toLowerCase() === color} onClick={() => void save({ annotationColor: color })}>{preferences.annotationColor.toLowerCase() === color && <Check size={16} aria-hidden="true" />}</button>
                ))}
              </div>
            </fieldset>

            <label className="range-setting">
              <span><strong>Pen and highlighter thickness</strong><small>{preferences.annotationThickness}px</small></span>
              <input type="range" min="1" max="12" step="1" value={preferences.annotationThickness} onChange={(event) => void save({ annotationThickness: Number(event.target.value) })} />
              <span className="range-preview" style={{ height: `${preferences.annotationThickness}px`, background: preferences.annotationColor }} aria-hidden="true" />
            </label>

            <Toggle label="Row-counter sound" description="Play a quiet confirmation when you increase or decrease a counter." checked={preferences.counterSound} onChange={(checked) => void save({ counterSound: checked })} />
          </SettingsSection>

          <SettingsSection icon={Bell} title="Account and privacy" description="Your account is one of two invited members of this private library.">
            <div className="account-card">
              <span className="avatar avatar--large" aria-hidden="true">{(user?.displayName || user?.email || 'M').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
              <div><strong>{user?.displayName || 'Maker'}</strong><span>{user?.email}</span><small>{user?.role === 'owner' ? 'Library owner' : 'Household member'}</small></div>
              <span className="verified-chip"><LockKeyhole size={14} aria-hidden="true" /> Private account</span>
            </div>
            <div className="privacy-grid">
              <div><Users size={20} aria-hidden="true" /><span><strong>Two invited members</strong><small>No public sign-up</small></span></div>
              <div><Highlighter size={20} aria-hidden="true" /><span><strong>Your own preferences</strong><small>Annotations show authorship</small></span></div>
              <div><Gauge size={20} aria-hidden="true" /><span><strong>Synced progress</strong><small>Resume on any device</small></span></div>
              <div><Volume2 size={20} aria-hidden="true" /><span><strong>Private by design</strong><small>Files require sign-in</small></span></div>
            </div>
          </SettingsSection>
        </div>

        <aside className="settings-sidebar">
          <div className="settings-sidebar__card">
            <span aria-hidden="true"><LockKeyhole size={20} /></span>
            <h2>Private household library</h2>
            <p>Patterns, files, and shared projects are available only to the two invited accounts.</p>
          </div>
          <div className="settings-sidebar__card settings-sidebar__card--paper">
            <h2>What is personal?</h2>
            <ul><li>Theme and display choices</li><li>Pattern favorites</li><li>Viewer defaults</li><li>Private projects and notes</li></ul>
          </div>
          {user?.role === 'owner' && (
            <Link className="button button--secondary button--wide" to="/manage/import">Manage library data</Link>
          )}
        </aside>
      </div>
    </div>
  )
}

export default SettingsPage
