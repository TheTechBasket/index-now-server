import { Suspense, lazy, useEffect, useState } from 'react'
import { Layout } from './components/layout'
import { Toaster } from './components/ui/sonner'
import { useSession } from './lib/auth'
import { Login } from './pages/login'
import { NotFoundPage } from './pages/not-found'

const Dashboard = lazy(() => import('./pages/dashboard').then((m) => ({ default: m.Dashboard })))
const SiteUrlsPage = lazy(() => import('./pages/site-urls').then((m) => ({ default: m.SiteUrlsPage })))
const SettingsPage = lazy(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })))
const ChangelogPage = lazy(() => import('./pages/changelog').then((m) => ({ default: m.ChangelogPage })))

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
  const isChangelog = route === '/changelog'

  const page = siteSettingsMatch ? (
    <SiteUrlsPage key={siteSettingsMatch[1]} siteId={siteSettingsMatch[1]} initialEditOpen={true} />
  ) : siteMatch ? (
    <SiteUrlsPage key={siteMatch[1]} siteId={siteMatch[1]} />
  ) : isSettings ? (
    <SettingsPage />
  ) : isChangelog ? (
    <ChangelogPage />
  ) : isDashboard ? (
    <Dashboard />
  ) : (
    <NotFoundPage />
  )

  return (
    <>
      <Layout>
        <Suspense>{page}</Suspense>
      </Layout>
      <Toaster position="bottom-right" />
    </>
  )
}
