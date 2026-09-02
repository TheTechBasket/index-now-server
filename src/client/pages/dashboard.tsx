import {
  AlertCircle,
  ArrowUpDown,
  CheckCircle2,
  Columns3,
  Copy,
  FileText,
  Filter,
  Globe,
  History,
  Key,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldX,
  TableProperties,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { KeyFileHelper } from '@/components/key-file-helper'
import { Layout } from '@/components/layout'
import { LogDialog } from '@/components/log-dialog'
import { SiteDialog } from '@/components/site-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api, type CronProgress, type KeyVerifyResult, type Site } from '@/lib/api'

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error('Clipboard unavailable'),
  )
}

const submissionStatusVariant = {
  success: 'default',
  no_changes: 'secondary',
  error: 'destructive',
} as const

type SortKey = 'name' | 'pending' | 'lastSubmit' | 'created'
type LevelFilter = 'all' | 'manual' | 'scheduled' | 'webhook'
type StatusFilter = 'all' | 'verified' | 'unverified' | 'errors' | 'pending'
type ViewMode = 'cards' | 'table'

const VIEW_KEY = 'indexnow.dashboard.view'

function loadView(): ViewMode {
  return (localStorage.getItem(VIEW_KEY) as ViewMode) ?? 'cards'
}

type ColumnKey = 'level' | 'urls' | 'key' | 'lastRun'
const COLUMN_LABELS: Record<ColumnKey, string> = {
  level: 'Level',
  urls: 'URLs',
  key: 'Key',
  lastRun: 'Last run',
}
const COLS_KEY = 'indexnow.dashboard.columns'
const DEFAULT_COLS: Record<ColumnKey, boolean> = { level: true, urls: true, key: true, lastRun: true }

function loadCols(): Record<ColumnKey, boolean> {
  try {
    const raw = localStorage.getItem(COLS_KEY)
    return raw ? { ...DEFAULT_COLS, ...JSON.parse(raw) } : DEFAULT_COLS
  } catch {
    return DEFAULT_COLS
  }
}

function siteLastRunStatus(site: Site): 'success' | 'no_changes' | 'error' | 'never' {
  return site.lastSubmission ? site.lastSubmission.status : 'never'
}

function relTime(d: string | number | null): string {
  if (!d) return 'never'
  const diff = Date.now() - new Date(d).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(d).toLocaleDateString()
}

function nextRelTime(d: string | number): string {
  const diff = new Date(d).getTime() - Date.now()
  if (diff <= 0) return 'soon'
  if (diff < 3_600_000) return `in ${Math.max(1, Math.floor(diff / 60_000))}m`
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h`
  return `in ${Math.floor(diff / 86_400_000)}d`
}

export function Dashboard() {
  const [allSites, setAllSites] = useState<Site[] | null>(null)
  const [editing, setEditing] = useState<Site | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [logSite, setLogSite] = useState<Site | null>(null)

  const [view, setView] = useState<ViewMode>(loadView)
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>(loadCols)
  const [q, setQ] = useState('')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('name')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [siteBusy, setSiteBusy] = useState<Record<string, 'submit' | 'verify' | 'sync' | 'delete'>>({})
  const [bulkBusy, setBulkBusy] = useState<null | 'submit' | 'verify' | 'sync' | 'delete'>(null)
  const [bulkProgress, setBulkProgress] = useState<{ index: number; total: number } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Site[] | null>(null)
  const [keyDialogSite, setKeyDialogSite] = useState<Site | null>(null)
  const [keyDialogStatus, setKeyDialogStatus] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle')

  const reload = useCallback(() => {
    api<Site[]>('/sites')
      .then((sites) => {
        setAllSites(sites)
        setSelected((prev) => {
          const ids = new Set(sites.map((s) => s.id))
          const next = new Set<string>()
          for (const id of prev) if (ids.has(id)) next.add(id)
          return next
        })
      })
      .catch((err) => toast.error(err.message))
  }, [])

  useEffect(reload, [reload])

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  useEffect(() => {
    localStorage.setItem(COLS_KEY, JSON.stringify(visibleCols))
  }, [visibleCols])

  function toggleCol(key: ColumnKey) {
    setVisibleCols((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const [cronProgress, setCronProgress] = useState<CronProgress | null>(null)
  useEffect(() => {
    let cancelled = false
    let wasRunning = false
    const poll = () => {
      if (document.hidden) return
      api<CronProgress>('/cron/status')
        .then((p) => {
          if (cancelled) return
          setCronProgress(p.interval ? p : null)
          if (wasRunning && !p.interval) reload() // batch just finished — refresh next-run/last-run
          wasRunning = p.interval !== null
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 4_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [reload])

  const filtered = useMemo(() => {
    if (!allSites) return []
    const lower = q.trim().toLowerCase()
    let list = allSites.filter((s) => {
      if (lower && !`${s.name} ${s.host}`.toLowerCase().includes(lower)) return false
      if (levelFilter !== 'all' && s.submissionLevel !== levelFilter) return false
      if (statusFilter !== 'all') {
        const status = siteLastRunStatus(s)
        if (statusFilter === 'verified' && !s.keyVerified) return false
        if (statusFilter === 'unverified' && s.keyVerified) return false
        if (statusFilter === 'errors' && status !== 'error') return false
        if (statusFilter === 'pending' && s.urlCounts.pending === 0) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'pending':
          return b.urlCounts.pending - a.urlCounts.pending
        case 'lastSubmit': {
          const at = (s: Site) => (s.lastSubmission ? s.lastSubmission.createdAt : 0)
          return at(b) - at(a)
        }
        case 'created':
          return b.createdAt - a.createdAt
      }
    })
    return list
  }, [allSites, q, levelFilter, statusFilter, sort])

  const stats = useMemo(() => {
    const s = allSites ?? []
    return {
      total: s.length,
      verified: s.filter((x) => x.keyVerified).length,
      unverified: s.filter((x) => !x.keyVerified).length,
      pending: s.reduce((sum, x) => sum + x.urlCounts.pending, 0),
      urls: s.reduce((sum, x) => sum + x.urlCounts.total, 0),
      errors: s.filter((x) => siteLastRunStatus(x) === 'error').length,
    }
  }, [allSites])

  const selectedSites = useMemo(
    () => (allSites ?? []).filter((s) => selected.has(s.id)),
    [allSites, selected],
  )

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id))
  const someFilteredSelected =
    filtered.length > 0 && filtered.some((s) => selected.has(s.id)) && !allFilteredSelected

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const s of filtered) next.delete(s.id)
      } else {
        for (const s of filtered) next.add(s.id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function setBusy(id: string, action: 'submit' | 'verify' | 'sync' | 'delete' | undefined) {
    setSiteBusy((b) => {
      const next = { ...b }
      if (action === undefined) delete next[id]
      else next[id] = action
      return next
    })
  }

  async function submitOne(site: Site) {
    setBusy(site.id, 'submit')
    try {
      const result = await api<{ status: string; urlCount: number; detail?: string }>(
        `/sites/${site.id}/submit`,
        { method: 'POST' },
      )
      if (result.status === 'success') toast.success(`${site.name}: submitted ${result.urlCount} URLs`)
      else if (result.status === 'no_changes') toast.info(`${site.name}: no new URLs`)
      else toast.error(`${site.name}: ${result.detail ?? 'failed'}`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${site.name} submission failed`)
    } finally {
      setBusy(site.id, undefined)
    }
  }

  async function verifyOne(site: Site) {
    setBusy(site.id, 'verify')
    try {
      const result = await api<KeyVerifyResult>(`/sites/${site.id}/verify-key`, { method: 'POST' })
      if (result.found) toast.success(`${site.name}: key verified`)
      else toast.error(`${site.name}: key not found (HTTP ${result.statusCode})`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${site.name} verify failed`)
    } finally {
      setBusy(site.id, undefined)
    }
  }

  async function syncOne(site: Site) {
    setBusy(site.id, 'sync')
    try {
      await api(`/sites/${site.id}/sync`, { method: 'POST' })
      toast.success(`${site.name}: sitemap synced`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${site.name} sync failed`)
    } finally {
      setBusy(site.id, undefined)
    }
  }

  async function runBulk(action: 'submit' | 'verify' | 'sync', inputSites: Site[]) {
    let sites = inputSites
    let skippedUnverified = 0
    if (action === 'submit') {
      skippedUnverified = sites.filter((s) => !s.keyVerified).length
      sites = sites.filter((s) => s.keyVerified)
    }
    if (sites.length === 0) {
      if (skippedUnverified > 0) toast.error(`Skipped ${skippedUnverified} unverified site(s) — verify the key before submitting`)
      return
    }
    setBulkBusy(action)
    let ok = 0
    let fail = 0
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i]
      setBulkProgress({ index: i + 1, total: sites.length })
      try {
        if (action === 'submit') {
          const r = await api<{ status: string }>(`/sites/${site.id}/submit`, { method: 'POST' })
          if (r.status === 'success' || r.status === 'no_changes') ok++
          else fail++
        } else if (action === 'sync') {
          await api(`/sites/${site.id}/sync`, { method: 'POST' })
          ok++
        } else {
          const r = await api<KeyVerifyResult>(`/sites/${site.id}/verify-key`, { method: 'POST' })
          if (r.found) ok++
          else fail++
        }
      } catch {
        fail++
      }
      if (sites.length > 1 && i < sites.length - 1) await new Promise((r) => setTimeout(r, 600))
    }
    setBulkBusy(null)
    setBulkProgress(null)
    const verb = action === 'submit' ? 'Submitted' : action === 'sync' ? 'Synced' : 'Verified'
    toast.success(`${verb} ${ok} site${ok !== 1 ? 's' : ''}${fail ? `, ${fail} failed` : ''}${skippedUnverified ? `, ${skippedUnverified} skipped (unverified key)` : ''}`)
    clearSelection()
    reload()
  }

  async function submitAllPending() {
    const pendingSites = (allSites ?? []).filter((s) => s.urlCounts.pending > 0)
    if (pendingSites.length === 0) return
    await runBulk('submit', pendingSites)
  }

  async function bulkDelete() {
    if (!deleteConfirm) return
    setBulkBusy('delete')
    let ok = 0
    let fail = 0
    for (const site of deleteConfirm) {
      try {
        await api(`/sites/${site.id}`, { method: 'DELETE' })
        ok++
      } catch {
        fail++
      }
    }
    setBulkBusy(null)
    setDeleteConfirm(null)
    toast.success(`Deleted ${ok} site${ok !== 1 ? 's' : ''}${fail ? `, ${fail} failed` : ''}`)
    clearSelection()
    reload()
  }

  async function verifyKeyDialog(site: Site) {
    setKeyDialogStatus('checking')
    try {
      const result = await api<KeyVerifyResult>(`/sites/${site.id}/verify-key`, { method: 'POST' })
      setKeyDialogStatus(result.found ? 'found' : 'missing')
      reload()
    } catch {
      setKeyDialogStatus('missing')
    }
  }

  const hasFilters = q || levelFilter !== 'all' || statusFilter !== 'all'

  return (
    <Layout>
      {/* Top Header & Page Title */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">IndexNow Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monitor and submit real-time URL updates across search engines</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
            className="gap-1.5 shadow-sm"
          >
            <Plus aria-hidden className="size-4" /> Add Site
          </Button>
        </div>
      </div>

      {cronProgress && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
          <RefreshCw aria-hidden className="size-4 shrink-0 animate-spin text-primary" />
          <span className="font-medium">
            Running {cronProgress.interval} sync: {cronProgress.index}/{cronProgress.total}
          </span>
          {cronProgress.currentSiteName && (
            <span className="truncate text-muted-foreground">
              {cronProgress.currentSiteName}
              {cronProgress.batchTotal && cronProgress.batchTotal > 1 && ` (batch ${cronProgress.batchIndex}/${cronProgress.batchTotal})`}
            </span>
          )}
          <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${cronProgress.total ? (cronProgress.index / cronProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Overview Tiles (High-impact visual hierarchy) */}
      {allSites && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            role="button"
            tabIndex={0}
            onClick={() => { setLevelFilter('all'); setStatusFilter('all') }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLevelFilter('all'); setStatusFilter('all') } }}
            className={`cursor-pointer transition-all hover:border-primary/50 ${levelFilter === 'all' && statusFilter === 'all' ? 'ring-2 ring-primary/20' : ''}`}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Sites</CardTitle>
              <Globe className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {stats.verified} / {stats.total} verified keys
              </p>
            </CardContent>
          </Card>

          <Card
            role="button"
            tabIndex={0}
            onClick={() => { setLevelFilter('all'); setStatusFilter('pending') }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLevelFilter('all'); setStatusFilter('pending') } }}
            className={`cursor-pointer transition-all ${
              stats.pending > 0 ? 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10' : ''
            } ${statusFilter === 'pending' ? 'ring-2 ring-amber-500/40' : ''}`}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Pending URLs
              </CardTitle>
              <Send className="size-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pending}</div>
                {stats.pending > 0 && (
                  <Button
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      submitAllPending()
                    }}
                    disabled={bulkBusy !== null}
                    className="h-7 gap-1 px-2 text-[11px]"
                  >
                    <Send className="size-3" /> Submit All
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {stats.pending > 0 ? 'Ready for immediate submission' : 'All sitemaps up to date'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Tracked URLs</CardTitle>
              <FileText className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.urls.toLocaleString()}</div>
              <p className="text-[11px] text-muted-foreground mt-1">Across all site sitemaps</p>
            </CardContent>
          </Card>

          <Card
            role="button"
            tabIndex={0}
            onClick={() => { setLevelFilter('all'); setStatusFilter('errors') }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLevelFilter('all'); setStatusFilter('errors') } }}
            className={`cursor-pointer transition-all ${
              stats.errors > 0 ? 'border-destructive/40 bg-destructive/5' : ''
            } ${statusFilter === 'errors' ? 'ring-2 ring-destructive/40' : ''}`}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">System Health</CardTitle>
              {stats.errors > 0 ? (
                <AlertCircle className="size-4 text-destructive" />
              ) : (
                <ShieldCheck className="size-4 text-emerald-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.errors > 0 ? `${stats.errors} Error${stats.errors > 1 ? 's' : ''}` : 'Healthy'}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {stats.errors > 0 ? 'Sites failed last submission' : 'All keys and runs operational'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Managed Sites Section & Controls Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Managed Sites</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick Preset Filter Pills */}
          <div className="flex items-center rounded-lg border bg-muted/30 p-1 text-xs">
            <button
              onClick={() => { setLevelFilter('all'); setStatusFilter('all') }}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                levelFilter === 'all' && statusFilter === 'all'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              onClick={() => { setLevelFilter('all'); setStatusFilter('pending') }}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                statusFilter === 'pending'
                  ? 'bg-background text-amber-600 shadow-sm dark:text-amber-400'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Pending ({stats.pending})
            </button>
            <button
              onClick={() => { setLevelFilter('webhook'); setStatusFilter('all') }}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                levelFilter === 'webhook'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Webhook
            </button>
            {stats.errors > 0 && (
              <button
                onClick={() => { setLevelFilter('all'); setStatusFilter('errors') }}
                className={`rounded px-2.5 py-1 font-medium transition-colors ${
                  statusFilter === 'errors'
                    ? 'bg-background text-destructive shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Errors ({stats.errors})
              </button>
            )}
          </div>

          <div className="flex rounded-md border p-0.5">
            <Button
              size="icon-sm"
              variant={view === 'cards' ? 'secondary' : 'ghost'}
              onClick={() => setView('cards')}
              aria-label="Card view"
              title="Card view"
            >
              <LayoutGrid aria-hidden className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant={view === 'table' ? 'secondary' : 'ghost'}
              onClick={() => setView('table')}
              aria-label="Table view"
              title="Table view"
            >
              <List aria-hidden className="size-3.5" />
            </Button>
          </div>

          {view === 'table' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Choose visible columns" title="Choose visible columns">
                  <Columns3 aria-hidden className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Visible columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={visibleCols[key]}
                    onCheckedChange={() => toggleCol(key)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {COLUMN_LABELS[key]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Toolbar (Search & Sort) */}
      {allSites && allSites.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sites or hostnames..."
              aria-label="Search sites or hostnames"
              className="h-8 w-60 pl-9 text-xs"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <ArrowUpDown aria-hidden className="size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort: Name</SelectItem>
              <SelectItem value="pending">Sort: Pending</SelectItem>
              <SelectItem value="lastSubmit">Sort: Last submit</SelectItem>
              <SelectItem value="created">Sort: Newest</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('')
                setLevelFilter('all')
                setStatusFilter('all')
              }}
              className="h-8 gap-1 px-2 text-xs"
            >
              <X className="size-3.5" aria-hidden /> Clear filters
            </Button>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            Showing {filtered.length} of {allSites.length} sites
          </div>
        </div>
      )}

      {/* Bulk actions bar */}
      {selectedSites.length > 0 && (
        <div className="animate-enter mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
          <span className="text-sm font-medium">{selectedSites.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => runBulk('submit', selectedSites)} disabled={bulkBusy !== null}>
            {bulkBusy === 'submit' ? <RotateCw className="size-3.5 animate-spin" aria-hidden /> : <Send aria-hidden />}
            {bulkBusy === 'submit' && bulkProgress ? `Submitting ${bulkProgress.index}/${bulkProgress.total}...` : 'Submit'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk('sync', selectedSites)} disabled={bulkBusy !== null}>
            <RotateCw className={`size-3.5 ${bulkBusy === 'sync' ? 'animate-spin' : ''}`} aria-hidden />
            {bulkBusy === 'sync' && bulkProgress ? `Syncing ${bulkProgress.index}/${bulkProgress.total}...` : 'Sync'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk('verify', selectedSites)} disabled={bulkBusy !== null}>
            {bulkBusy === 'verify' ? <RotateCw className="size-3.5 animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
            {bulkBusy === 'verify' && bulkProgress ? `Verifying ${bulkProgress.index}/${bulkProgress.total}...` : 'Verify'}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeleteConfirm(selectedSites)}
            disabled={bulkBusy !== null}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            <X aria-hidden />
          </Button>
        </div>
      )}

      {/* Empty states */}
      {allSites?.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No sites yet. Add your first site to generate an IndexNow key.
          </CardContent>
        </Card>
      )}
      {allSites && allSites.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No sites match your filters.
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {allSites === null && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-40 rounded-xl ring-1 ring-foreground/10"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      )}

      {/* Cards view */}
      {view === 'cards' && filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((site, i) => {
            const busy = siteBusy[site.id]
            const isSel = selected.has(site.id)
            const lastStatus = siteLastRunStatus(site)
            return (
              <Card
                key={site.id}
                data-selected={isSel}
                className={
                  'card-hover animate-enter ring-1 ring-foreground/10 transition-colors data-[selected=true]:ring-primary ' +
                  (lastStatus === 'error' ? 'border-destructive/40' : '')
                }
                style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
              >
                <CardHeader className="gap-0.5 pb-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={() => toggleSelect(site.id)}
                      aria-label={`Select ${site.name}`}
                    />
                    <button
                      onClick={() => verifyOne(site)}
                      disabled={busy !== undefined}
                      title={site.keyVerified ? 'Key verified — click to recheck' : 'Click to verify key'}
                      aria-label={site.keyVerified ? 'Key verified, click to recheck' : 'Click to verify key'}
                      className="shrink-0"
                    >
                      {site.keyVerified ? (
                        <ShieldCheck className="size-4 text-emerald-500" aria-hidden />
                      ) : (
                        <ShieldX className="size-4 text-amber-500" aria-hidden />
                      )}
                    </button>
                    <a
                      href={`/site/${site.id}`}
                      className="flex-1 truncate text-sm font-semibold hover:underline"
                      title="Click to view & manage URLs"
                    >
                      {site.name}
                    </a>
                    <CardAction>
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {site.submissionLevel === 'scheduled'
                          ? site.cronInterval
                          : site.submissionLevel}
                      </Badge>
                    </CardAction>
                  </div>
                  <CardDescription className="truncate pl-6 text-xs">{site.host}</CardDescription>
                </CardHeader>

                <CardContent className="pb-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tabular-nums font-medium text-foreground">{site.urlCounts.total} URLs</span>
                    {site.urlCounts.pending > 0 && (
                      <Badge variant="default" className="h-4 px-1.5 text-[10px]">
                        {site.urlCounts.pending} pending
                      </Badge>
                    )}
                    {lastStatus === 'error' && (
                      <Badge variant="destructive" className="animate-attention h-4 px-1.5 text-[10px]">
                        errored
                      </Badge>
                    )}
                    {site.mismatchedCount > 0 && (
                      <a href={`/site/${site.id}`}>
                        <Badge
                          variant="outline"
                          className="h-4 gap-0.5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
                          title={`${site.mismatchedCount} URL(s) in the sitemap don't match this site's host - click to review`}
                        >
                          <AlertCircle className="size-2.5" aria-hidden /> {site.mismatchedCount} mismatched
                        </Badge>
                      </a>
                    )}
                    <span
                      className="ml-auto text-[11px]"
                      title={[
                        site.lastSubmission ? `Last run: ${new Date(site.lastSubmission.createdAt).toLocaleString()}` : null,
                        site.nextRunAt ? `Next run: ${new Date(site.nextRunAt).toLocaleString()}` : null,
                      ].filter(Boolean).join('\n')}
                    >
                      {relTime(site.lastSubmission?.createdAt ?? null)}
                      {site.nextRunAt && ` · next ${nextRelTime(site.nextRunAt)}`}
                    </span>
                  </div>
                </CardContent>

                <CardFooter className="flex items-center justify-between border-t bg-muted/20 px-4 py-2">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant={site.urlCounts.pending > 0 ? "default" : "outline"}
                      onClick={() => submitOne(site)}
                      disabled={busy !== undefined || !site.keyVerified}
                      title={!site.keyVerified ? 'Verify the IndexNow key before submitting' : busy === 'submit' ? 'Submitting...' : 'Submit pending URLs'}
                      aria-label="Submit"
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      {busy === 'submit' ? (
                        <RefreshCw className="size-3 animate-spin" aria-hidden />
                      ) : (
                        <Send className="size-3" aria-hidden />
                      )}
                      <span>{busy === 'submit' ? 'Submitting...' : 'Submit'}</span>
                      {site.urlCounts.pending > 0 && (
                        <Badge variant="secondary" className="h-3.5 px-1 text-[9px] font-semibold">
                          {site.urlCounts.pending}
                        </Badge>
                      )}
                    </Button>

                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => syncOne(site)}
                      disabled={busy !== undefined}
                      title="Sync sitemap"
                      aria-label="Sync sitemap"
                      className="h-7 size-7"
                    >
                      <RefreshCw className={`size-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} aria-hidden />
                    </Button>

                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setLogSite(site)}
                      title="Submission history log"
                      aria-label="Log"
                      className="h-7 size-7"
                    >
                      <History className="size-3.5" aria-hidden />
                    </Button>

                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        setKeyDialogSite(site)
                        setKeyDialogStatus(site.keyVerified ? 'found' : 'idle')
                      }}
                      title="IndexNow Key file"
                      aria-label="Key file"
                      className="h-7 size-7"
                    >
                      <Key className="size-3.5" aria-hidden />
                    </Button>

                    {site.submissionLevel === 'webhook' && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() =>
                          copy(
                            `${location.origin}/hook/${site.id}`,
                            'Webhook endpoint',
                          )
                        }
                        title="Copy Webhook Endpoint"
                        aria-label="Copy Webhook Endpoint"
                        className="h-7 size-7"
                      >
                        <Link2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label="More options" className="h-7 size-7">
                        <MoreHorizontal className="size-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel className="text-xs">{site.name}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a href={`/site/${site.id}`}>
                          <TableProperties aria-hidden className="size-3.5" /> Browse URLs
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => verifyOne(site)} disabled={busy !== undefined}>
                        <ShieldCheck aria-hidden className="size-3.5" /> Re-verify key
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setEditing(site); setDialogOpen(true) }}>
                        <SettingsIcon aria-hidden className="size-3.5" /> Site settings
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteConfirm([site])}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 aria-hidden className="size-3.5" /> Delete site
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}


      {/* Table view */}
      {view === 'table' && filtered.length > 0 && (
        <div className="animate-enter overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allFilteredSelected}
                    indeterminate={someFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Site</TableHead>
                {visibleCols.level && <TableHead>Level</TableHead>}
                {visibleCols.urls && <TableHead className="text-right">URLs</TableHead>}
                <TableHead className="text-right">Pending</TableHead>
                {visibleCols.key && <TableHead>Key</TableHead>}
                {visibleCols.lastRun && <TableHead>Last run</TableHead>}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((site) => {
                const busy = siteBusy[site.id]
                const lastStatus = siteLastRunStatus(site)
                return (
                  <TableRow key={site.id} data-selected={selected.has(site.id)}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(site.id)}
                        onCheckedChange={() => toggleSelect(site.id)}
                        aria-label={`Select ${site.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <a href={`/site/${site.id}`} className="block">
                        <div className="flex items-center gap-1.5 font-medium leading-tight">
                          {site.name}
                          {site.mismatchedCount > 0 && (
                            <span title={`${site.mismatchedCount} URL(s) in the sitemap don't match this site's host`}>
                              <AlertCircle className="size-3.5 shrink-0 text-amber-500" aria-hidden />
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{site.host}</div>
                      </a>
                    </TableCell>
                    {visibleCols.level && (
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {site.submissionLevel === 'scheduled'
                            ? `sched · ${site.cronInterval}`
                            : site.submissionLevel}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleCols.urls && <TableCell className="text-right tabular-nums">{site.urlCounts.total}</TableCell>}
                    <TableCell className="text-right">
                      {site.urlCounts.pending > 0 ? (
                        <Badge>{site.urlCounts.pending}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    {visibleCols.key && (
                      <TableCell>
                        <button
                          onClick={() => verifyOne(site)}
                          disabled={busy !== undefined}
                          title={site.keyVerified ? 'Verified — recheck' : 'Verify key'}
                          aria-label={site.keyVerified ? 'Key verified, click to recheck' : 'Click to verify key'}
                        >
                          {site.keyVerified ? (
                            <ShieldCheck className="size-4 text-emerald-500" aria-hidden />
                          ) : (
                            <ShieldX className="size-4 text-amber-500" aria-hidden />
                          )}
                        </button>
                      </TableCell>
                    )}
                    {visibleCols.lastRun && <TableCell className="text-xs">
                      <div className="flex flex-col gap-0.5">
                        {site.lastSubmission ? (
                          <div className="flex items-center gap-1.5">
                            <span title={new Date(site.lastSubmission.createdAt).toLocaleString()}>
                              {relTime(site.lastSubmission.createdAt)}
                            </span>
                            {site.lastSubmission.status === 'success' ? (
                              <span title="Success">
                                <CheckCircle2 className="size-3 text-emerald-500" aria-hidden />
                              </span>
                            ) : (
                              <Badge
                                variant={submissionStatusVariant[site.lastSubmission.status]}
                                className={`h-4 px-1.5 text-[10px] font-normal ${lastStatus === 'error' ? 'animate-attention' : ''}`}
                              >
                                {site.lastSubmission.status.replace('_', ' ')}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                        {site.nextRunAt && (
                          <span className="text-[11px] text-muted-foreground" title={new Date(site.nextRunAt).toLocaleString()}>
                            next {nextRelTime(site.nextRunAt)}
                          </span>
                        )}
                      </div>
                    </TableCell>}
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => submitOne(site)}
                          disabled={busy !== undefined || !site.keyVerified}
                          title={!site.keyVerified ? 'Verify the IndexNow key before submitting' : busy === 'submit' ? 'Submitting...' : 'Submit'}
                        >
                          {busy === 'submit' ? (
                            <RotateCw className="animate-spin" aria-hidden />
                          ) : (
                            <Send aria-hidden />
                          )}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => syncOne(site)}
                          disabled={busy !== undefined}
                          title="Sync sitemap"
                        >
                          <RotateCw className={`size-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} aria-hidden />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => {
                            setKeyDialogSite(site)
                            setKeyDialogStatus(site.keyVerified ? 'found' : 'idle')
                          }}
                          title="Key file"
                        >
                          <Key className="size-3.5" aria-hidden />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label="More actions">
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <a href={`/site/${site.id}`}>
                                <TableProperties aria-hidden /> Browse URLs
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => verifyOne(site)} disabled={busy !== undefined}>
                              <ShieldCheck aria-hidden /> Verify key
                            </DropdownMenuItem>                            {site.submissionLevel === 'webhook' && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    copy(
                                      `${location.origin}/hook/${site.id}`,
                                      'Webhook endpoint',
                                    )
                                  }
                                >
                                  <Link2 aria-hidden /> Copy hook URL
                                </DropdownMenuItem>
                              )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setLogSite(site)}>
                              <History aria-hidden /> Submission log
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setEditing(site); setDialogOpen(true) }}>
                              <SettingsIcon aria-hidden /> Settings
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Host the key file at <code>https://&lt;host&gt;/&lt;key&gt;.txt</code> containing only the key string —
        IndexNow verifies ownership through it on every submission.
      </p>

      <SiteDialog
        key={editing?.id ?? 'new'}
        site={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={reload}
      />
      <LogDialog site={logSite} onClose={() => setLogSite(null)} />

      {/* Key file dialog */}
      <Dialog
        open={keyDialogSite !== null}
        onOpenChange={(open) => {
          if (!open) {
            setKeyDialogSite(null)
            setKeyDialogStatus('idle')
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-w-lg">
          <DialogHeader>
            <DialogTitle>{keyDialogSite?.name} — IndexNow Key</DialogTitle>
            <DialogDescription>
              Deploy your key file at <code className="rounded bg-muted px-1 font-mono text-xs">https://{keyDialogSite?.host}/{keyDialogSite?.apiKey}.txt</code>
            </DialogDescription>
          </DialogHeader>
          {keyDialogSite && (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm">
                <div className="flex items-center gap-2">
                  {keyDialogStatus === 'found' ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-medium">
                      <ShieldCheck className="size-3.5" aria-hidden /> Key Verified
                    </Badge>
                  ) : keyDialogStatus === 'missing' ? (
                    <Badge variant="outline" className="gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400 font-medium">
                      <ShieldX className="size-3.5" aria-hidden /> Key Missing
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs font-normal">
                      Unverified
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => verifyKeyDialog(keyDialogSite)}
                    disabled={keyDialogStatus === 'checking'}
                  >
                    {keyDialogStatus === 'checking' ? 'Checking…' : 'Re-verify'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => copy(keyDialogSite.apiKey, 'IndexNow Key')}
                  >
                    <Copy className="size-3" aria-hidden /> Copy Key
                  </Button>
                </div>
              </div>
              <KeyFileHelper host={keyDialogSite.host} apiKey={keyDialogSite.apiKey} />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setKeyDialogSite(null)
                setKeyDialogStatus('idle')
              }}
            >
              <CheckCircle2 className="mr-1 size-3.5" aria-hidden /> Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteConfirm?.length ?? 0} sites?</DialogTitle>
            <DialogDescription>
              This permanently deletes each site and all its submission history. Cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteConfirm && deleteConfirm.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <ul className="divide-y">
                {deleteConfirm.map((s) => (
                  <li key={s.id} className="px-3 py-2 text-sm">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.host}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)} disabled={bulkBusy !== null}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={bulkDelete} disabled={bulkBusy !== null}>
              <Trash2 aria-hidden /> {bulkBusy === 'delete' ? 'Deleting…' : `Delete ${deleteConfirm?.length ?? 0}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
