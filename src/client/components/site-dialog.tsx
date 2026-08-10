import { useRef, useState } from 'react'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, type Site } from '@/lib/api'

type Props = {
  site: Site | null // null = create
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

type Level = Site['submissionLevel']

function KeyField({ defaultValue }: { defaultValue?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="apiKey">IndexNow key</Label>
      <Input
        id="apiKey"
        name="apiKey"
        pattern="[a-zA-Z0-9\-]{8,128}"
        defaultValue={defaultValue}
        placeholder="Leave blank to generate one"
      />
    </div>
  )
}

function ScheduleFields({
  level,
  setLevel,
  defaultInterval,
}: {
  level: Level
  setLevel: (l: Level) => void
  defaultInterval?: Site['cronInterval']
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="grid gap-2">
        <Label>Submission level</Label>
        <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {level === 'scheduled' && (
        <div className="grid gap-2">
          <Label>Interval</Label>
          <Select name="cronInterval" defaultValue={defaultInterval ?? 'daily'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="6h">Every 6 hours</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

function sitemapLabel(url: string) {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

/** Create flow: paste website URL → sitemap auto-discovered on blur → pick (if multiple)
 *  or confirm (if single) → fill optional fields → submit once. */
function CreateForm({ onOpenChange, onSaved }: Pick<Props, 'onOpenChange' | 'onSaved'>) {
  const [level, setLevel] = useState<Level>('webhook')
  const [busy, setBusy] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  // null = not discovered yet; [] = nothing found (show manual field); 1+ = show picker or auto-selected
  const [sitemaps, setSitemaps] = useState<string[] | null>(null)
  const [selectedUrl, setSelectedUrl] = useState('')
  const [discoveredHost, setDiscoveredHost] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const discoveredRef = useRef(false) // sync ref to avoid stale closure in onBlur

  async function discover(url: string) {
    if (!url.trim()) return
    setSitemaps(null)
    setSelectedUrl('')
    setDiscoveredHost('')
    discoveredRef.current = true
    setDiscovering(true)
    try {
      const result = await api<{ host: string; sitemapUrls: string[] }>(
        '/sites/discover',
        { method: 'POST', body: JSON.stringify({ url: url.trim() }) },
      )
      setDiscoveredHost(result.host)
      setSitemaps(result.sitemapUrls)
      if (result.sitemapUrls.length === 1) {
        setSelectedUrl(result.sitemapUrls[0])
      } else if (result.sitemapUrls.length > 1) {
        setSelectedUrl(result.sitemapUrls[0])
      }
      if (result.sitemapUrls.length === 0) {
        toast.info('No sitemap found — enter its URL below')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Discovery failed')
      setSitemaps([]) // fallback to manual input so user isn't stuck
    } finally {
      setDiscovering(false)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const apiKey = String(form.get('apiKey') ?? '').trim()
    const sitemapUrl = selectedUrl || String(form.get('sitemapUrlManual') ?? '').trim()
    const host = discoveredHost || String(form.get('hostFallback') ?? '')

    if (!sitemapUrl) {
      toast.error('Select or enter a sitemap URL')
      return
    }

    setBusy(true)
    try {
      await api('/sites', {
        method: 'POST',
        body: JSON.stringify({
          name: host.replace(/^www\./, ''),
          host,
          sitemapUrl,
          ...(apiKey && { apiKey }),
          submissionLevel: level,
          cronInterval: String(form.get('cronInterval') ?? 'daily'),
        }),
      })
      toast.success('Site added')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const discovered = sitemaps !== null

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="websiteUrl">Website URL</Label>
        <div className="flex gap-2">
          <Input
            id="websiteUrl"
            name="websiteUrl"
            required
            placeholder="example.com"
            value={websiteUrl}
            onChange={(e) => {
              setWebsiteUrl(e.target.value)
              if (discoveredRef.current) {
                discoveredRef.current = false
                setSitemaps(null)
                setSelectedUrl('')
                setDiscoveredHost('')
              }
            }}
            onBlur={(e) => {
              if (e.target.value.trim() && !discoveredRef.current) {
                discover(e.target.value)
              }
            }}
            disabled={discovering}
          />
          {discovered && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setSitemaps(null)
                setSelectedUrl('')
                setDiscoveredHost('')
              }}
            >
              Change
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {discovering
            ? 'Discovering sitemaps…'
            : discovered
              ? `${sitemaps!.length} sitemap${sitemaps!.length !== 1 ? 's' : ''} found for ${discoveredHost}`
              : 'Sitemap is found automatically (robots.txt or common locations). Name defaults to the domain.'}
        </p>
      </div>

      {discovered && sitemaps!.length === 0 && (
        <div className="grid gap-2">
          <Label htmlFor="sitemapUrlManual">Sitemap URL</Label>
          <Input
            id="sitemapUrlManual"
            name="sitemapUrlManual"
            type="url"
            required
            placeholder="https://example.com/sitemap.xml"
          />
        </div>
      )}

      {discovered && sitemaps!.length === 1 && (
        <div className="grid gap-2">
          <Label>Sitemap</Label>
          <input type="hidden" name="sitemapUrl" value={selectedUrl} />
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm font-mono text-muted-foreground">
            <span className="min-w-0 truncate" title={selectedUrl}>
              {sitemapLabel(selectedUrl)}
            </span>
          </div>
        </div>
      )}

      {discovered && sitemaps!.length > 1 && (
        <div className="grid gap-2">
          <Label htmlFor="sitemapPicker">Choose a sitemap</Label>
          <Select
            name="sitemapUrl"
            value={selectedUrl}
            onValueChange={setSelectedUrl}
          >
            <SelectTrigger id="sitemapPicker">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sitemaps!.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className="font-mono text-xs" title={s}>
                    {sitemapLabel(s)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Multiple sitemaps were detected. Pick the one you want to sync — typically the sitemap index if available.
          </p>
        </div>
      )}

      {/* Hidden host fallback in case the manual path is used */}
      {discoveredHost && <input type="hidden" name="hostFallback" value={discoveredHost} />}

      <KeyField />
      <ScheduleFields level={level} setLevel={setLevel} />
      <DialogFooter>
        <Button type="submit" disabled={busy || discovering || !discovered}>
          {busy ? 'Adding…' : discovering ? 'Discovering…' : 'Add site'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function EditForm({ site, onOpenChange, onSaved }: { site: Site } & Pick<Props, 'onOpenChange' | 'onSaved'>) {
  const [level, setLevel] = useState<Level>(site.submissionLevel)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    try {
      await api(`/sites/${site.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: String(form.get('name')),
          host: String(form.get('host')).replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
          sitemapUrl: String(form.get('sitemapUrl')),
          apiKey: String(form.get('apiKey')),
          submissionLevel: level,
          cronInterval: String(form.get('cronInterval') ?? site.cronInterval),
        }),
      })
      toast.success('Site updated')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required defaultValue={site.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="host">Host</Label>
        <Input id="host" name="host" required defaultValue={site.host} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sitemapUrl">Sitemap URL</Label>
        <Input id="sitemapUrl" name="sitemapUrl" type="url" required defaultValue={site.sitemapUrl} />
      </div>
      <KeyField defaultValue={site.apiKey} />
      <ScheduleFields level={level} setLevel={setLevel} defaultInterval={site.cronInterval} />
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          Save changes
        </Button>
      </DialogFooter>
    </form>
  )
}

export function SiteDialog({ site, open, onOpenChange, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{site ? 'Edit site' : 'Add site'}</DialogTitle>
          <DialogDescription>
            {site
              ? 'Update site details and submission policy.'
              : 'Just the website URL — everything else is worked out for you.'}
          </DialogDescription>
        </DialogHeader>
        {site ? (
          <EditForm site={site} onOpenChange={onOpenChange} onSaved={onSaved} />
        ) : (
          <CreateForm onOpenChange={onOpenChange} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  )
}
