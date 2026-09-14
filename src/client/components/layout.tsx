import logoImg from '../assets/logo.png'
import {
  Bot,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FlaskConical,
  Globe,
  History,
  Layers,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, type GithubStats, type Settings as SettingsData } from '@/lib/api'
import { useSession, signOut } from '@/lib/auth'

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.26 5.68.42.36.78 1.07.78 2.17 0 1.56-.01 2.82-.01 3.2 0 .31.2.66.79.55A10.52 10.52 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
    </svg>
  )
}

const INFO_DISMISSED_KEY = 'indexnow.footer.dismissed'

function FooterInfo() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(INFO_DISMISSED_KEY) !== '1' } catch { return true }
  })

  function toggle() {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(INFO_DISMISSED_KEY, next ? '0' : '1') } catch {}
  }

  return (
    <div className="mb-6">
      <button
        onClick={toggle}
        className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Layers className="size-3.5" aria-hidden />
        <span>About IndexNow</span>
        <span className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-enter">
          <div className="rounded-xl border bg-card/50 p-5 shadow-xs">
            <div className="mb-3 flex items-center gap-2 text-rose-500 font-semibold text-sm">
              <Globe className="size-4" />
              <span>Search Engines</span>
            </div>
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-3.5 text-emerald-500" /> Bing & Copilot</li>
              <li className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-3.5 text-emerald-500" /> Yandex</li>
              <li className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-3.5 text-emerald-500" /> Naver</li>
              <li className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-3.5 text-emerald-500" /> Seznam & Yep</li>
            </ul>
          </div>
          <div className="rounded-xl border bg-card/50 p-5 shadow-xs">
            <div className="mb-3 flex items-center gap-2 text-rose-500 font-semibold text-sm">
              <Zap className="size-4" />
              <span>How It Works</span>
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 font-mono font-bold text-[10px]">1</span>
                <span>Host a <code>&lt;key&gt;.txt</code> file at your domain root</span>
              </div>
              <div className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 font-mono font-bold text-[10px]">2</span>
                <span>Server monitors sitemaps for new/changed URLs</span>
              </div>
              <div className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 font-mono font-bold text-[10px]">3</span>
                <span>URLs submitted to all engines in batches of 10,000</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-card/50 p-5 shadow-xs sm:col-span-2 lg:col-span-1">
            <div className="mb-3 flex items-center gap-2 text-rose-500 font-semibold text-sm">
              <Cpu className="size-4" />
              <span>Automation</span>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p><strong className="text-foreground">Webhooks:</strong> Trigger on CMS publish or CI deploy</p>
              <p><strong className="text-foreground">Cron:</strong> Hourly, 6h, daily, weekly, monthly</p>
              <p><strong className="text-foreground">Discord:</strong> Real-time submission alerts</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { authEnabled } = useSession()
  const [dryRun, setDryRun] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [gh, setGh] = useState<GithubStats | null>(null)

  useEffect(() => {
    api<SettingsData>('/settings')
      .then((s) => {
        setDryRun(s.dryRun)
        setDevMode(s.devMode)
      })
      .catch(() => {})
    api<{ version: string }>('/version').then((v) => setVersion(v.version)).catch(() => {})
    api<GithubStats>('/github-stats').then(setGh).catch(() => {})
  }, [])

  function handleSignOut() {
    signOut().then(() => window.location.reload())
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-5xl px-4 py-6">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <a href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-lg">
            <img src={logoImg} alt="IndexNow Logo" className="size-8 rounded-lg object-cover shadow-sm ring-1 ring-border" />
            <span>IndexNow <span className="font-light text-muted-foreground">Server</span></span>
          </a>
          {version && <span className="text-xs font-normal text-muted-foreground">v{version}</span>}
          {gh?.updateAvailable && (
            <a
              href="/changelog"
              className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
              title={`v${gh.latestVersion} available (currently v${version}), click for changelog`}
            >
              <Sparkles className="size-3" aria-hidden /> UPDATE AVAILABLE
            </a>
          )}
        </div>
        <nav className="flex items-center gap-1">
          {gh && (
            <a
              href={gh.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              title="View on GitHub"
            >
              <GithubMark className="size-3.5" />
              <Star className="size-3 fill-current" aria-hidden />
              {gh.stars}
            </a>
          )}
          <Button variant="ghost" size="sm" asChild>
            <a href="/changelog">
              <History aria-hidden /> Changelog
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="/settings">
              <Settings aria-hidden /> Settings
            </a>
          </Button>
          {authEnabled && (
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut aria-hidden /> Sign out
            </Button>
          )}
        </nav>
      </header>

      {(devMode || dryRun) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {devMode && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-slate-500/40 bg-slate-500/10 px-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400"
              title="NODE_ENV is not 'production': running the unbundled dev server (tsx watch + Vite dev middleware), noticeably slower on large sites. Run `pnpm build && pnpm start` for production performance."
            >
              <Wrench className="size-3" aria-hidden /> DEV MODE
            </Badge>
          )}
          {dryRun && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
              title="DRY_RUN=true: IndexNow submissions are simulated, nothing is sent to api.indexnow.org"
            >
              <FlaskConical className="size-3" aria-hidden /> DRY RUN
            </Badge>
          )}
        </div>
      )}

      <main>{children}</main>

      <footer className="mt-20 border-t border-rose-500/20 pt-6 pb-8">
        <FooterInfo />
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-2 rounded-full bg-rose-600" />
            <span className="font-semibold text-foreground">IndexNow <span className="text-rose-500 font-bold">Server</span></span>
            <span>· Self-hosted & open-source</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" className="hover:text-rose-500 transition-colors">Dashboard</a>
            <a href="/settings" className="hover:text-rose-500 transition-colors">Settings</a>
            <a href="/changelog" className="hover:text-rose-500 transition-colors">Changelog</a>
            <a
              href="https://www.indexnow.org"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-rose-500 transition-colors"
            >
              IndexNow.org <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
