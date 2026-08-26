import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldX,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyFileHelper } from '@/components/key-file-helper'
import { Layout } from '@/components/layout'
import { SiteDialog } from '@/components/site-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { api, type KeyVerifyResult, type Site, type SiteUrl, type SitemapSyncResult, type SitemapWarnings, type UrlCounts, type UrlStatus } from '@/lib/api'

const PAGE = 100

const statusVariant: Record<UrlStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  new: 'default',
  updated: 'default',
  submitted: 'secondary',
  removed: 'outline',
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString() : '—'
}

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error('Clipboard unavailable'),
  )
}

export function SiteUrlsPage({
  siteId,
  initialEditOpen = false,
}: {
  siteId: string
  initialEditOpen?: boolean
}) {
  const [site, setSite] = useState<Site | null>(null)
  const [rows, setRows] = useState<SiteUrl[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<UrlCounts | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<SitemapWarnings | null>(null)
  const [sitemapCount, setSitemapCount] = useState<number | null>(null)
  const [keyStatus, setKeyStatus] = useState<'idle' | 'checking' | 'found' | 'missing' | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<UrlStatus | 'all'>('all')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<'sync' | 'submit' | 'reset' | 'prune' | 'deleteAll' | 'deleteSelected' | null>(null)
  const [editOpen, setEditOpen] = useState(initialEditOpen)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualUrlsInput, setManualUrlsInput] = useState('')
  const [submittingManual, setSubmittingManual] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmAction, setConfirmAction] = useState<'reset' | 'prune' | 'deleteAll' | 'deleteSelected' | null>(null)
  const [syncError, setSyncError] = useState<{ message: string; suggestedSitemap?: string; finalUrl?: string } | null>(null)
  const [redirectInfo, setRedirectInfo] = useState<{ from: string; to: string } | null>(null)

  const loadSite = useCallback(() => {
    api<Site[]>('/sites')
      .then((all) => {
        const found = all.find((s) => s.id === siteId) ?? null
        setSite(found)
        if (found) {
          setSitemapCount(found.sitemapCount)
          if (found.keyVerified === true) setKeyStatus('found')
        }
      })
      .catch((err) => toast.error(err.message))
  }, [siteId])

  useEffect(loadSite, [loadSite])

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) })
    if (q) params.set('q', q)
    if (status !== 'all') params.set('status', status)
    api<{ rows: SiteUrl[]; total: number; counts: UrlCounts; lastSyncAt: string | null; warnings?: SitemapWarnings }>(
      `/sites/${siteId}/urls?${params}`,
    )
      .then((d) => {
        setRows(d.rows)
        setTotal(d.total)
        setCounts(d.counts)
        setLastSyncAt(d.lastSyncAt)
        // server only recomputes warnings on the default unfiltered first-page view;
        // keep the last known value on paginated/filtered/search requests
        if (d.warnings) setWarnings(d.warnings)
        // prune selection to only rows still on page
        setSelected((prev) => {
          const ids = new Set(d.rows.map((r) => r.id))
          return new Set([...prev].filter((id) => ids.has(id)))
        })
      })
      .catch((err) => toast.error(err.message))
  }, [siteId, q, status, page])

  useEffect(load, [load])

  async function sync() {
    setBusy('sync')
    setSyncError(null)
    setRedirectInfo(null)
    try {
      const fresh = await api<SitemapSyncResult>(`/sites/${siteId}/sync`, { method: 'POST' })
      setSitemapCount(fresh.sitemapCount)
      if (fresh.redirected && fresh.finalUrl && fresh.finalUrl !== site?.sitemapUrl) {
        setRedirectInfo({ from: site!.sitemapUrl, to: fresh.finalUrl })
      }
      toast.success(`Synced — ${fresh.total} URLs, ${fresh.pending} pending`)
      load()
    } catch (err) {
      const e = err as Error & { suggestedSitemap?: string; finalUrl?: string }
      const msg = e.message
      if (e.suggestedSitemap || e.finalUrl || msg.includes('404')) {
        setSyncError({ message: msg, suggestedSitemap: e.suggestedSitemap, finalUrl: e.finalUrl })
      }
      toast.error(msg)
    } finally {
      setBusy(null)
    }
  }

  async function fixSitemap(url: string) {
    setBusy('sync')
    try {
      await api(`/sites/${siteId}/sitemap-fix`, { method: 'POST', body: JSON.stringify({ sitemapUrl: url }) })
      setSyncError(null)
      setRedirectInfo(null)
      loadSite()
      // auto re-sync after fix
      const fresh = await api<SitemapSyncResult>(`/sites/${siteId}/sync`, { method: 'POST' })
      setSitemapCount(fresh.sitemapCount)
      toast.success(`Sitemap updated, synced ${fresh.total} URLs`)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  async function submitPending() {
    setBusy('submit')
    try {
      const result = await api<{ status: string; urlCount: number; detail?: string }>(
        `/sites/${siteId}/submit`,
        { method: 'POST' },
      )
      if (result.status === 'success') toast.success(`Submitted ${result.urlCount} URLs`)
      else if (result.status === 'no_changes') toast.info('Nothing pending to submit')
      else toast.error(result.detail ?? 'Submission failed')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleManualSubmit() {
    const lines = manualUrlsInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    if (lines.length === 0) {
      toast.error('Enter at least one valid URL to submit')
      return
    }

    setSubmittingManual(true)
    try {
      const result = await api<{ status: string; urlCount: number; detail?: string }>(
        `/sites/${siteId}/submit`,
        { method: 'POST', body: JSON.stringify({ urls: lines }) },
      )
      toast.success(`Manual submission complete (${result.urlCount} URLs sent)`)
      setManualOpen(false)
      setManualUrlsInput('')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Manual submission failed')
    } finally {
      setSubmittingManual(false)
    }
  }

  async function submitSingleUrl(targetUrl: string) {
    try {
      const result = await api<{ status: string; urlCount: number; detail?: string }>(
        `/sites/${siteId}/submit`,
        { method: 'POST', body: JSON.stringify({ urls: [targetUrl] }) },
      )
      if (result.status === 'success') toast.success(`Submitted 1 URL to IndexNow`)
      else toast.info(result.detail ?? 'Submission completed')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'URL submission failed')
    }
  }

  async function doReset() {
    setBusy('reset')
    try {
      await api(`/sites/${siteId}/urls/reset`, { method: 'POST' })
      toast.success('All URL statuses reset to new')
      setConfirmAction(null)
      setSelected(new Set())
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setBusy(null)
    }
  }

  async function doPrune() {
    setBusy('prune')
    try {
      const r = await api<{ deleted: number }>(`/sites/${siteId}/urls?status=removed`, { method: 'DELETE' })
      toast.success(`Removed ${r.deleted} URLs no longer in sitemap`)
      setConfirmAction(null)
      setSelected(new Set())
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Prune failed')
    } finally {
      setBusy(null)
    }
  }

  async function doDeleteAll() {
    setBusy('deleteAll')
    try {
      const r = await api<{ deleted: number }>(`/sites/${siteId}/urls?all=true`, { method: 'DELETE' })
      toast.success(`Deleted ${r.deleted} URLs`)
      setConfirmAction(null)
      setSelected(new Set())
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  async function doDeleteSelected() {
    if (selected.size === 0) return
    setBusy('deleteSelected')
    try {
      const r = await api<{ deleted: number }>(`/sites/${siteId}/urls/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected] }),
      })
      toast.success(`Deleted ${r.deleted} URLs`)
      setConfirmAction(null)
      setSelected(new Set())
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  async function verifyKey() {
    setKeyStatus('checking')
    try {
      const result = await api<KeyVerifyResult>(`/sites/${siteId}/verify-key`, { method: 'POST' })
      setKeyStatus(result.found ? 'found' : 'missing')
      if (result.found) {
        toast.success('IndexNow key is properly deployed')
      } else {
        toast.error(`Key not found at ${result.keyUrl} (HTTP ${result.statusCode})`)
      }
      loadSite()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed')
      setKeyStatus('missing')
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE))
  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const somePageSelected = rows.some((r) => selected.has(r.id)) && !allPageSelected

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectAllPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const r of rows) next.delete(r.id)
      } else {
        for (const r of rows) next.add(r.id)
      }
      return next
    })
  }

  return (
    <Layout>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <a href="/" className="flex items-center gap-1 font-medium hover:text-foreground transition-colors">
          <ArrowLeft className="size-3.5" /> Sites
        </a>
        <ChevronRight className="size-3.5 text-muted-foreground/40" />
        <span className="font-semibold text-foreground truncate">{site?.name ?? '…'}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{site?.name ?? '…'}</h1>
            {site && (
              <button
                type="button"
                onClick={verifyKey}
                title={site.keyVerified ? 'Key Verified — click to re-check' : 'Key Unverified — click to check'}
                className="flex items-center gap-1 text-xs"
              >
                {site.keyVerified ? (
                  <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="size-3.5" /> Key Verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400">
                    <ShieldX className="size-3.5" /> Key Unverified
                  </Badge>
                )}
              </button>
            )}
            {site && (
              <Badge variant="secondary" className="text-xs font-normal">
                {site.submissionLevel === 'scheduled' ? `Sched (${site.cronInterval})` : site.submissionLevel}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {site?.host} · {counts && `${counts.total} URLs total · ${counts.pending} pending submission`}
            {lastSyncAt && ` · Last synced ${fmt(lastSyncAt)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="gap-1.5"
          >
            <SettingsIcon className="size-3.5" /> Site Settings
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setManualOpen(true)}
            className="gap-1.5"
          >
            <Plus className="size-3.5" /> Custom URL
          </Button>

          <Button type="button" variant="outline" onClick={sync} disabled={busy !== null} size="sm" className="gap-1.5">
            <RefreshCw className={`size-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} aria-hidden />
            {busy === 'sync' ? 'Syncing…' : 'Sync Sitemap'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5">
                <SettingsIcon className="size-3.5" /> Manage URLs
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setConfirmAction('reset')} disabled={!counts || counts.total === 0}>
                <RotateCcw className="size-3.5" /> Reset all statuses to new
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setConfirmAction('prune')}
                disabled={!counts || counts.removed === 0}
              >
                <Trash2 className="size-3.5" /> Remove URLs not in sitemap ({counts?.removed ?? 0})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmAction('deleteAll')}
                className="text-destructive focus:text-destructive"
                disabled={!counts || counts.total === 0}
              >
                <Trash2 className="size-3.5" /> Delete all URLs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button type="button" onClick={submitPending} disabled={busy !== null || !counts?.pending} size="sm" className="gap-1.5">
            <Send className="size-3.5" aria-hidden />
            {busy === 'submit' ? 'Submitting…' : `Submit Pending${counts?.pending ? ` (${counts.pending})` : ''}`}
          </Button>
        </div>
      </div>

      {syncError && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-destructive">
            <AlertTriangle className="size-3.5" /> Sitemap sync failed
          </p>
          <p className="mt-1 text-muted-foreground">{syncError.message}</p>
          {syncError.suggestedSitemap && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] break-all">{syncError.suggestedSitemap}</span>
              <Button type="button" size="sm" className="h-7 text-xs" onClick={() => fixSitemap(syncError.suggestedSitemap!)}>
                Use this sitemap
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSyncError(null)}>
                Dismiss
              </Button>
            </div>
          )}
          {syncError.finalUrl && !syncError.suggestedSitemap && (
            <p className="mt-1 font-mono text-[11px]">Final URL: {syncError.finalUrl}</p>
          )}
          {!syncError.suggestedSitemap && (
            <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => setSyncError(null)}>
              Dismiss
            </Button>
          )}
        </div>
      )}

      {redirectInfo && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" /> Sitemap redirected
          </p>
          <p className="mt-1 text-muted-foreground">
            Your sitemap URL redirected from <span className="font-mono break-all">{redirectInfo.from}</span> to{' '}
            <span className="font-mono break-all">{redirectInfo.to}</span>. Consider updating it.
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" onClick={() => fixSitemap(redirectInfo.to)}>
              Update to final URL
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRedirectInfo(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {warnings && warnings.mismatchedCount > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" /> {warnings.mismatchedCount} URL{warnings.mismatchedCount !== 1 ? 's' : ''} in sitemap do not match site host ({site?.host})
            {warnings.localCount > 0 && ` (includes ${warnings.localCount} localhost URL(s))`}
          </p>
          <p className="mt-1 text-muted-foreground">Fix your sitemap or site host. These URLs will be flagged and blocked from manual submission.</p>
          {warnings.samples.length > 0 && (
            <ul className="mt-2 list-disc pl-5 font-mono text-[11px] text-amber-800 dark:text-amber-200">
              {warnings.samples.map((s) => (
                <li key={s} className="truncate">{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
            }}
            placeholder="Search URLs..."
            className="h-8 w-64 text-xs"
          />
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as UrlStatus | 'all')
              setPage(0)
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="updated">Updated</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="removed">Removed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {counts && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setStatus('all')}
              className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                status === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              All ({counts.total})
            </button>
            <button
              type="button"
              onClick={() => setStatus('new')}
              className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                status === 'new' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              New ({counts.new})
            </button>
            <button
              type="button"
              onClick={() => setStatus('updated')}
              className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                status === 'updated' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              Updated ({counts.updated})
            </button>
            <button
              type="button"
              onClick={() => setStatus('submitted')}
              className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                status === 'submitted' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              Submitted ({counts.submitted})
            </button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={async () => {
              const urls = rows.filter((r) => selected.has(r.id)).map((r) => r.url)
              if (urls.length === 0) return
              try {
                await api(`/sites/${siteId}/submit`, { method: 'POST', body: JSON.stringify({ urls }) })
                toast.success(`Submitted ${urls.length} URLs`)
                setSelected(new Set())
                load()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Submit failed')
              }
            }}
          >
            <Send className="size-3.5" /> Submit selected
          </Button>
          <Button type="button" size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setConfirmAction('deleteSelected')}>
            <Trash2 className="size-3.5" /> Delete selected
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-8">
                <Checkbox
                  checked={allPageSelected}
                  indeterminate={somePageSelected}
                  onCheckedChange={toggleSelectAllPage}
                  aria-label="Select all on page"
                />
              </TableHead>
              <TableHead className="w-[55%]">URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sitemap Lastmod</TableHead>
              <TableHead>Last Seen</TableHead>
              <TableHead>Last Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  {counts?.total === 0 ? 'No URLs found. Click "Sync Sitemap" to index pages.' : 'No URLs match your search filters.'}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-muted/20" data-selected={selected.has(row.id)}>
                <TableCell>
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleSelect(row.id)} aria-label={`Select ${row.url}`} />
                </TableCell>
                <TableCell className="max-w-md truncate font-mono text-xs" title={row.url}>
                  <div className="flex items-center gap-2">
                    <span className="truncate">{row.url}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant[row.status]} className="text-[10px] uppercase tracking-wider font-semibold">
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {row.lastmod ?? '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmt(row.lastSeenAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmt(row.submittedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => submitSingleUrl(row.url)}
                      title="Submit URL to IndexNow"
                      className="h-7 w-7 text-primary hover:bg-primary/10"
                    >
                      <Send className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => copy(row.url, 'URL')}
                      title="Copy URL"
                      className="h-7 w-7"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      asChild
                      title="Open URL in new tab"
                      className="h-7 w-7"
                    >
                      <a href={row.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        if (!window.confirm(`Delete ${row.url}?`)) return
                        try {
                          await api(`/sites/${siteId}/urls/bulk-delete`, { method: 'POST', body: JSON.stringify({ ids: [row.id] }) })
                          toast.success('URL deleted')
                          load()
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Delete failed')
                        }
                      }}
                      title="Delete URL"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {keyStatus === 'missing' && site && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-300">
          <p className="mb-1 font-semibold flex items-center gap-2">
            <ShieldX className="size-4 text-amber-600" /> IndexNow key file missing from host
          </p>
          <p className="mb-3 text-xs opacity-90">
            Deploy your key file at <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono">https://{site.host}/{site.apiKey}.txt</code> to allow search engines to verify domain ownership.
          </p>
          <div className="rounded-md border bg-background p-3">
            <KeyFileHelper host={site.host} apiKey={site.apiKey} />
          </div>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page + 1} of {pages} ({total} total URLs)
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} className="h-7 text-xs">
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
              className="h-7 text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Custom URLs</DialogTitle>
            <DialogDescription>
              Only URLs already in the sitemap and matching {site?.host ?? 'site host'} can be submitted. Others are rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Label htmlFor="manualUrls" className="text-xs font-medium">
              URLs to submit
            </Label>
            <Textarea
              id="manualUrls"
              rows={5}
              value={manualUrlsInput}
              onChange={(e) => setManualUrlsInput(e.target.value)}
              placeholder={`https://${site?.host ?? 'example.com'}/page-1\nhttps://${site?.host ?? 'example.com'}/page-2`}
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setManualOpen(false)} disabled={submittingManual}>
              Cancel
            </Button>
            <Button type="button" onClick={handleManualSubmit} disabled={submittingManual || !manualUrlsInput.trim()}>
              <Send className="mr-1.5 size-3.5" />
              {submittingManual ? 'Submitting…' : 'Submit URLs'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAction !== null} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction === 'reset' && 'Reset all URL statuses?'}
              {confirmAction === 'prune' && `Remove ${counts?.removed ?? 0} URLs not in sitemap?`}
              {confirmAction === 'deleteAll' && `Delete all ${counts?.total ?? 0} URLs?`}
              {confirmAction === 'deleteSelected' && `Delete ${selected.size} selected URLs?`}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === 'reset' && 'All URLs will be marked as new and will be re-submitted on next submit. This does not delete URLs.'}
              {confirmAction === 'prune' && 'Deletes URLs whose status is removed (gone from sitemap since last sync). Cannot be undone without re-syncing.'}
              {confirmAction === 'deleteAll' && 'Permanently deletes every URL for this site. Re-sync to re-import from sitemap.'}
              {confirmAction === 'deleteSelected' && 'Permanently deletes the selected URLs. Re-sync to re-import them if still in sitemap.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmAction(null)} disabled={busy !== null}>Cancel</Button>
            <Button
              type="button"
              variant={confirmAction === 'reset' ? 'default' : 'destructive'}
              disabled={busy !== null}
              onClick={() => {
                if (confirmAction === 'reset') doReset()
                else if (confirmAction === 'prune') doPrune()
                else if (confirmAction === 'deleteAll') doDeleteAll()
                else if (confirmAction === 'deleteSelected') doDeleteSelected()
              }}
            >
              {busy ? 'Working…' : confirmAction === 'reset' ? 'Reset statuses' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {site && (
        <SiteDialog
          key={site.id}
          site={site}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            loadSite()
            load()
          }}
        />
      )}
    </Layout>
  )
}
