import logoImg from '../assets/logo.png'
import {
  Bot,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Globe,
  Layers,
  LogOut,
  Settings,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSession, signOut } from '@/lib/auth'

export function Layout({ children }: { children: React.ReactNode }) {
  const { authEnabled } = useSession()

  function handleSignOut() {
    signOut().then(() => window.location.reload())
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-5xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-lg">
          <img src={logoImg} alt="IndexNow Logo" className="size-8 rounded-lg object-cover shadow-sm ring-1 ring-border" />
          <span>IndexNow <span className="font-light text-muted-foreground">Server</span></span>
        </a>
        <nav className="flex items-center gap-1">
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

      <main>{children}</main>

      <footer className="mt-20 border-t border-rose-500/20 pt-10 pb-8">
        {/* Informational Cards Section */}
        <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Card 1: Supported Search Engines */}
          <div className="rounded-xl border bg-card/50 p-5 shadow-xs transition-colors hover:border-rose-500/30">
            <div className="mb-3 flex items-center gap-2 text-rose-500 font-semibold text-sm">
              <Globe className="size-4" />
              <span>Supported Search Engines</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
              IndexNow is an open protocol adopted by major global search engines. Submitting your URL to IndexNow automatically notifies all participating search engines simultaneously:
            </p>
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" /> Microsoft Bing & Copilot
                </span>
                <span className="text-[10px] text-muted-foreground">Global</span>
              </li>
              <li className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" /> Yandex Search
                </span>
                <span className="text-[10px] text-muted-foreground">Europe / Asia</span>
              </li>
              <li className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" /> Naver Search
                </span>
                <span className="text-[10px] text-muted-foreground">South Korea</span>
              </li>
              <li className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" /> Seznam.cz & Yep (Ahrefs)
                </span>
                <span className="text-[10px] text-muted-foreground">Global</span>
              </li>
            </ul>
          </div>

          {/* Card 2: How IndexNow Protocol Works */}
          <div className="rounded-xl border bg-card/50 p-5 shadow-xs transition-colors hover:border-rose-500/30">
            <div className="mb-3 flex items-center gap-2 text-rose-500 font-semibold text-sm">
              <Zap className="size-4" />
              <span>How IndexNow Works</span>
            </div>
            <div className="space-y-2.5 text-xs text-muted-foreground">
              <div className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 font-mono font-bold text-[10px]">1</span>
                <div>
                  <strong className="text-foreground">Host Key File:</strong> Place a <code>&lt;key&gt;.txt</code> file at your domain root so search engines verify ownership.
                </div>
              </div>
              <div className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 font-mono font-bold text-[10px]">2</span>
                <div>
                  <strong className="text-foreground">Sitemap Auto-Sync:</strong> IndexNow Server monitors XML sitemaps to detect newly added or updated pages.
                </div>
              </div>
              <div className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 font-mono font-bold text-[10px]">3</span>
                <div>
                  <strong className="text-foreground">Instant Push Submissions:</strong> URLs are instantly submitted via API in batches up to 10,000 URLs per call.
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Automation & Integrations */}
          <div className="rounded-xl border bg-card/50 p-5 shadow-xs transition-colors hover:border-rose-500/30 sm:col-span-2 lg:col-span-1">
            <div className="mb-3 flex items-center gap-2 text-rose-500 font-semibold text-sm">
              <Cpu className="size-4" />
              <span>Automation & Integrations</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
              IndexNow Server keeps your search index 100% up-to-date with zero manual overhead:
            </p>
            <div className="space-y-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2 border">
                <span className="font-semibold text-foreground">Webhooks:</span> Trigger sitemap re-syncs and URL submissions automatically on CMS publish or CI deployment.
              </div>
              <div className="rounded-md bg-muted/40 p-2 border">
                <span className="font-semibold text-foreground">Flexible Schedules:</span> Set automatic background crons (Hourly, 6-Hours, Daily, Weekly, or Monthly).
              </div>
              <div className="rounded-md bg-muted/40 p-2 border">
                <span className="font-semibold text-foreground">Discord Alerts:</span> Receive real-time notifications on submission batches and error diagnostics.
              </div>
            </div>
          </div>
        </div>

        {/* Footer Bottom Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-rose-600" />
            </span>
            <span className="font-semibold text-foreground">IndexNow <span className="text-rose-500 font-bold">Server</span></span>
            <span>· Fast, Automated Search Engine Indexing</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" className="hover:text-rose-500 transition-colors">Dashboard</a>
            <a href="/settings" className="hover:text-rose-500 transition-colors">Settings</a>
            <a
              href="https://www.indexnow.org"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-rose-500 transition-colors"
            >
              IndexNow.org <ExternalLink className="size-3" />
            </a>
            <span className="text-muted-foreground/40">|</span>
            <span>Self-hosted & open-source</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
