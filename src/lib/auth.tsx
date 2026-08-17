import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import type { AuthError } from '@supabase/supabase-js'
import { appConfig } from './config'
import { clearOfflineData, pauseOfflineQueue, resumeOfflineQueue } from './offlineQueue'
import { supabase } from './supabase'
import type { AppUser } from './types'

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  unauthorized: boolean
  error: string | null
  demoMode: boolean
  signIn(email: string, password: string): Promise<AuthError | null>
  sendMagicLink(email: string): Promise<AuthError | null>
  signOut(): Promise<AuthError | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const demoUser: AppUser = {
  id: 'demo-user', email: 'demo@pattern-manager.local', displayName: 'Demo Maker', householdId: 'demo-household', role: 'owner',
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AppUser | null>(appConfig.demoMode ? demoUser : null)
  const [loading, setLoading] = useState(!appConfig.demoMode)
  const [unauthorized, setUnauthorized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authenticatedUserId = useRef<string | null>(appConfig.demoMode ? demoUser.id : null)
  const loadGeneration = useRef(0)

  useEffect(() => {
    if (!supabase) return
    let active = true

    let authEventSeen = false

    async function loadUser(userId: string, email: string, generation: number) {
      const [memberResult, profileResult] = await Promise.all([
        supabase!.from('household_members').select('household_id, role, active').eq('user_id', userId).eq('active', true).maybeSingle(),
        supabase!.from('profiles').select('display_name').eq('user_id', userId).maybeSingle(),
      ])
      if (!active || generation !== loadGeneration.current) return
      if (memberResult.error) {
        setError('The private membership check could not be completed. Check your connection and try again.')
        setUnauthorized(false); setLoading(false); return
      }
      if (!memberResult.data) {
        setUser(null); setError(null); setUnauthorized(true); setLoading(false); return
      }
      setError(null)
      setUnauthorized(false)
      setUser({
        id: userId,
        email,
        displayName: profileResult.data?.display_name || email.split('@')[0] || 'Maker',
        householdId: memberResult.data.household_id,
        role: memberResult.data.role as 'owner' | 'member',
      })
      setLoading(false)
    }

    const beginUserLoad = (userId: string, email: string) => {
      const generation = ++loadGeneration.current
      authenticatedUserId.current = userId
      void resumeOfflineQueue(userId)
      setLoading(true); setError(null); setUnauthorized(false); setUser(null)
      void loadUser(userId, email, generation)
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (authEventSeen || !active) return
      const authUser = data.session?.user
      if (authUser) beginUserLoad(authUser.id, authUser.email ?? '')
      else if (active) setLoading(false)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      authEventSeen = true
      if (event === 'TOKEN_REFRESHED' && session?.user.id === authenticatedUserId.current) return
      if (session?.user) beginUserLoad(session.user.id, session.user.email ?? '')
      else {
        ++loadGeneration.current
        authenticatedUserId.current = null
        setUser(null); setError(null); setUnauthorized(false); setLoading(false)
      }
    })
    return () => { active = false; subscription.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user, loading, unauthorized, error, demoMode: appConfig.demoMode,
    async signIn(email, password) {
      if (!supabase) { setUser(demoUser); return null }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return error
    },
    async sendMagicLink(email) {
      if (!supabase) return null
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` } })
      return error
    },
    async signOut() {
      const userId = authenticatedUserId.current ?? user?.id ?? null
      if (userId) await pauseOfflineQueue(userId)
      if (supabase) {
        const { error: signOutError } = await supabase.auth.signOut()
        if (signOutError) {
          if (userId) await resumeOfflineQueue(userId)
          setError(`Sign-out failed: ${signOutError.message}`)
          return signOutError
        }
      } else setUser(null)
      if (userId) await clearOfflineData(userId).catch(() => undefined)
      authenticatedUserId.current = null
      setError(null); setUnauthorized(false)
      return null
    },
  }), [error, loading, unauthorized, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
