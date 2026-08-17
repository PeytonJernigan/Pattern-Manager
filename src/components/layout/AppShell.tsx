import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen,
  ChevronDown,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAppData } from '@/lib/data'

interface AppShellProps {
  children?: ReactNode
  onSignOut?: () => void
}

const navigation = [
  { label: 'Home', to: '/', icon: Home, end: true },
  { label: 'Patterns', to: '/patterns', icon: BookOpen },
  { label: 'Projects', to: '/projects', icon: FolderKanban },
]

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0] || 'PM'
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function AppShell({ children, onSignOut }: AppShellProps) {
  const { user, loading, error, offlineIssueCount, retryOfflineChanges } = useAppData()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMobileNavOpen(false)
    setAccountOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    window.addEventListener('pointerdown', closeAccountMenu)
    return () => window.removeEventListener('pointerdown', closeAccountMenu)
  }, [])

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    return () => { window.removeEventListener('online', updateConnection); window.removeEventListener('offline', updateConnection) }
  }, [])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className={`app-sidebar ${mobileNavOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link className="brand-mark" to="/" aria-label="Pattern Manager home">
            <span aria-hidden="true">PM</span>
          </Link>
          <div>
            <p>Pattern Manager</p>
            <span>Jadyn's creative library</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <Link className="button button--primary sidebar-create" to="/patterns/new">
          <Plus size={18} aria-hidden="true" />
          Add something
        </Link>

        <nav className="sidebar-nav">
          <p className="nav-label">Workspace</p>
          {navigation.map(({ label, to, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <Icon size={19} strokeWidth={2} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'is-active' : '')}>
            <Settings size={19} aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
          <div className="privacy-note">
            <Sparkles size={17} aria-hidden="true" />
            <span>Your work is private to your household.</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="app-frame">
        <header className="app-topbar">
          <button
            className="icon-button mobile-menu-button"
            type="button"
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={22} aria-hidden="true" />
          </button>

          <Link className="mobile-wordmark" to="/">
            Pattern Manager
          </Link>

          <Link className="global-search" to="/patterns?focus=search">
            <Search size={18} aria-hidden="true" />
            <span>Search patterns and projects</span>
            <kbd>/</kbd>
          </Link>

          {offlineIssueCount > 0 ? (
            <button className="sync-state sync-state--error" type="button" title={error ?? undefined} onClick={() => void retryOfflineChanges()}>
              <span aria-hidden="true" />Retry {offlineIssueCount} unsynced change{offlineIssueCount === 1 ? '' : 's'}
            </button>
          ) : (
            <div className={`sync-state ${!online ? 'sync-state--offline' : error ? 'sync-state--error' : ''}`} role="status" title={error ?? undefined}>
              <span aria-hidden="true" />
              {!online ? 'Offline · changes will retry' : error ? 'Sync needs attention' : 'All changes saved'}
            </div>
          )}

          <div className="account-menu" ref={accountRef}>
            <button
              className="account-trigger"
              type="button"
              aria-label="Open account menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((value) => !value)}
            >
              <span className="avatar" aria-hidden="true">
                {loading ? '…' : initials(user?.displayName ?? '', user?.email ?? '')}
              </span>
              <span className="account-trigger__copy">
                <strong>{loading ? 'Loading…' : user?.displayName || 'Maker'}</strong>
                <small>{user?.role === 'owner' ? 'Library owner' : 'Household member'}</small>
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>

            {accountOpen && (
              <div className="account-popover">
                <div>
                  <strong>{user?.displayName || 'Maker'}</strong>
                  <span>{user?.email}</span>
                </div>
                <Link to="/settings">
                  <Settings size={17} aria-hidden="true" /> Settings
                </Link>
                {onSignOut && (
                  <button type="button" onClick={onSignOut}>
                    <LogOut size={17} aria-hidden="true" /> Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="app-main" id="main-content" tabIndex={-1}>
          {children ?? <Outlet />}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {navigation.map(({ label, to, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
            <Icon size={21} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
        <Link className="mobile-add" to="/patterns/new" aria-label="Add a pattern or project">
          <Plus size={25} aria-hidden="true" />
        </Link>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'is-active' : '')}>
          <Settings size={21} aria-hidden="true" />
          <span>Settings</span>
        </NavLink>
      </nav>
    </div>
  )
}

export default AppShell
