import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyFileHelper } from '@/components/key-file-helper'
import { Layout } from '@/components/layout'
import { SiteDialog } from '@/components/site-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { api, type KeyVerifyResult, type Site, type SiteUrl, type SitemapSyncResult, type UrlCounts, type UrlStatus } from '@/lib/api'

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
  const [sitemapCount, setSitemapCount] = useState<number | null>(null)
  const [keyStatus, setKeyStatus] = useState<'idle' | 'checking' | 'found' | 'missing' | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<UrlStatus | 'all'>('all')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<'sync' | 'submit' | null>(null)
  const [editOpen, setEditOpen] = useState(initialEditOpen)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualUrlsInput, setManualUrlsInput] = useState('')
  const [submittingManual, setSubmittingManual] = useState(false)

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
    api<{ rows: SiteUrl[]; total: number; counts: UrlCounts; lastSyncAt: string | null }>(
      `/sites/${siteId}/urls?${params}`,
    )
      .then((d) => {
        setRows(d.rows)
        setTotal(d.total)
        setCounts(d.counts)
        setLastSyncAt(d.lastSyncAt)
      })
      .catch((err) => toast.error(err.message))
  }, [siteId, q, status, page])

  useEffect(load, [load])

  async function sync() {
    setBusy('sync')
    try {
      const fresh = await api<SitemapSyncResult>(`/sites/${siteId}/sync`, { method: 'POST' })
      setSitemapCount(fresh.sitemapCount)
      toast.success(`Synced — ${fresh.total} URLs, ${fresh.pending} pending`)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
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
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="gap-1.5"
          >
            <SettingsIcon className="size-3.5" /> Site Settings
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setManualOpen(true)}
            className="gap-1.5"
          >
            <Plus className="size-3.5" /> Custom URL
          </Button>

          <Button variant="outline" onClick={sync} disabled={busy !== null} size="sm" className="gap-1.5">
            <RefreshCw className={`size-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} aria-hidden />
            {busy === 'sync' ? 'Syncing…' : 'Sync Sitemap'}
          </Button>

          <Button onClick={submitPending} disabled={busy !== null || !counts?.pending} size="sm" className="gap-1.5">
            <Send className="size-3.5" aria-hidden />
            {busy === 'submit' ? 'Submitting…' : `Submit Pending${counts?.pending ? ` (${counts.pending})` : ''}`}
          </Button>
        </div>
      </div>

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
              onClick={() => setStatus('all')}
              className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                status === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              All ({counts.total})
            </button>
            <button
              onClick={() => setStatus('new')}
              className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                status === 'new' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              New ({counts.new})
            </button>
            <button
              onClick={() => setStatus('updated')}
              className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                status === 'updated' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              Updated ({counts.updated})
            </button>
            <button
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

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
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
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  {counts?.total === 0 ? 'No URLs found. Click "Sync Sitemap" to index pages.' : 'No URLs match your search filters.'}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-muted/20">
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
                      size="icon"
                      variant="ghost"
                      onClick={() => submitSingleUrl(row.url)}
                      title="Submit URL to IndexNow"
                      className="h-7 w-7 text-primary hover:bg-primary/10"
                    >
                      <Send className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copy(row.url, 'URL')}
                      title="Copy URL"
                      className="h-7 w-7"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
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
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} className="h-7 text-xs">
              Previous
            </Button>
            <Button
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
              Paste one or more URLs (one per line) for immediate submission to IndexNow engines.
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
            <Button variant="ghost" onClick={() => setManualOpen(false)} disabled={submittingManual}>
              Cancel
            </Button>
            <Button onClick={handleManualSubmit} disabled={submittingManual || !manualUrlsInput.trim()}>
              <Send className="mr-1.5 size-3.5" />
              {submittingManual ? 'Submitting…' : 'Submit URLs'}
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
