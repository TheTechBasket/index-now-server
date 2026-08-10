import { useEffect, useState } from 'react'
import { Toaster } from './components/ui/sonner'
import { useSession } from './lib/auth'
import { Dashboard } from './pages/dashboard'
import { Login } from './pages/login'
import { NotFoundPage } from './pages/not-found'
import { SettingsPage } from './pages/settings'
import { SiteUrlsPage } from './pages/site-urls'

function usePathRoute() {
  const [route, setRoute] = useState(() => {
    // Support hash fallback for backward compatibility
    if (window.location.hash.startsWith('#/')) {
      return window.location.hash.slice(1)
    }
    return window.location.pathname
  })

  useEffect(() => {
    const onChange = () => {
      if (window.location.hash.startsWith('#/')) {
        setRoute(window.location.hash.slice(1))
      } else {
        setRoute(window.location.pathname)
      }
    }

    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a')
      if (!target) return
      const href = target.getAttribute('href')
      if (!href || target.target || href.startsWith('http://') || href.startsWith('https://') || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return

      if (href.startsWith('/') && !href.startsWith('//')) {
        e.preventDefault()
        window.history.pushState({}, '', href)
        onChange()
      } else if (href.startsWith('#/')) {
        e.preventDefault()
        window.location.hash = href
        onChange()
      }
    }

    window.addEventListener('popstate', onChange)
    window.addEventListener('hashchange', onChange)
    document.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('hashchange', onChange)
      document.removeEventListener('click', onClick)
    }
  }, [])

  return route
}

export function App() {
  const { authenticated, isPending } = useSession()
  const route = usePathRoute()

  if (isPending) return null

  if (!authenticated) {
    return (
      <>
        <Login />
        <Toaster position="bottom-right" />
      </>
    )
  }

  const siteSettingsMatch = route.match(/^\/site\/([^\/]+)\/settings$/)
  const siteMatch = route.match(/^\/site\/([^\/]+)$/)
  const isDashboard = route === '/' || route === ''
  const isSettings = route === '/settings'

  const page = siteSettingsMatch ? (
    <SiteUrlsPage key={siteSettingsMatch[1]} siteId={siteSettingsMatch[1]} initialEditOpen={true} />
  ) : siteMatch ? (
    <SiteUrlsPage key={siteMatch[1]} siteId={siteMatch[1]} />
  ) : isSettings ? (
    <SettingsPage />
  ) : isDashboard ? (
    <Dashboard />
  ) : (
    <NotFoundPage />
  )

  return (
    <>
      {page}
      <Toaster position="bottom-right" />
    </>
  )
}
