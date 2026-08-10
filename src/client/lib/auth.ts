import { useEffect, useState } from 'react'

export type AuthState = { authenticated: boolean; email: string | null; authEnabled?: boolean }

export async function getSession(): Promise<AuthState> {
  const res = await fetch('/api/auth/session', { credentials: 'same-origin' })
  if (res.status === 401) return { authenticated: false, email: null, authEnabled: true }
  const data = (await res.json()) as AuthState
  return data
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    return { error: body?.error ?? 'Invalid email or password' }
  }
  return {}
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
}

/** React hook: returns { authenticated, email, authEnabled, isPending }. */
export function useSession(): {
  authenticated: boolean
  email: string | null
  authEnabled: boolean
  isPending: boolean
} {
  const [state, setState] = useState<AuthState>({ authenticated: false, email: null, authEnabled: true })
  const [isPending, setIsPending] = useState(true)

  useEffect(() => {
    getSession()
      .then((s) => {
        setState(s)
        setIsPending(false)
      })
      .catch(() => {
        setState({ authenticated: false, email: null, authEnabled: true })
        setIsPending(false)
      })
  }, [])

  return { ...state, authEnabled: state.authEnabled ?? true, isPending }
}
