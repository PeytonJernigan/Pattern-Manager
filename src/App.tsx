import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { useAuth } from '@/lib/auth'
import { pauseOfflineQueue, readOutbox, resumeOfflineQueue } from '@/lib/offlineQueue'
const AuthCallbackPage = lazy(() => import('@/pages/AuthCallbackPage'))
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const ManageLibraryPage = lazy(() => import('@/pages/ManageLibraryPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const PatternDetailPage = lazy(() => import('@/pages/PatternDetailPage'))
const PatternFormPage = lazy(() => import('@/pages/PatternFormPage'))
const PatternLibraryPage = lazy(() => import('@/pages/PatternLibraryPage'))
const ProjectDetailPage = lazy(() => import('@/pages/ProjectDetailPage'))
const ProjectFormPage = lazy(() => import('@/pages/ProjectFormPage'))
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage'))
const ReaderPage = lazy(() => import('@/pages/ReaderPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const UnauthorizedPage = lazy(() => import('@/pages/UnauthorizedPage'))

function PrivateLayout() {
  const { user, signOut } = useAuth()
  const safelySignOut = async () => {
    if (user) await pauseOfflineQueue(user.id)
    const pendingChanges = user ? (await readOutbox(user.id).catch(() => [])).length : 0
    if (pendingChanges && !window.confirm(`${pendingChanges} offline change${pendingChanges === 1 ? '' : 's'} have not synced yet. Sign out and discard them?`)) {
      if (user) await resumeOfflineQueue(user.id)
      return
    }
    const signOutError = await signOut()
    if (signOutError) window.alert('The app could not sign out. Your session and unsynced changes were kept. Check your connection and try again.')
  }
  return <ProtectedRoute><AppShell onSignOut={() => void safelySignOut()} /></ProtectedRoute>
}

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading" role="status"><span className="spinner" />Opening your creative workspace…</div>}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route element={<PrivateLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="patterns" element={<PatternLibraryPage />} />
        <Route path="patterns/new" element={<PatternFormPage />} />
        <Route path="patterns/:patternId" element={<PatternDetailPage />} />
        <Route path="patterns/:patternId/edit" element={<PatternFormPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<ProjectFormPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="projects/:projectId/edit" element={<ProjectFormPage />} />
        <Route path="projects/:projectId/reader" element={<ReaderPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="manage/import" element={<ManageLibraryPage />} />
      </Route>
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes></Suspense>
  )
}
