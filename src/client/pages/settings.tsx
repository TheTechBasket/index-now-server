import { Check, Copy, Key, RefreshCw, Send, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Layout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, type Settings } from '@/lib/api'

const EVENT_LABELS: Record<string, string> = {
  'schedule.success': 'Scheduled run submitted URLs',
  'schedule.no_changes': 'Scheduled run found nothing new',
  'schedule.error': 'Scheduled run failed',
  'manual.success': 'Manual submit completed',
  'manual.error': 'Manual submit failed',
  'webhook.error': 'Incoming webhook trigger failed',
  'key_verification.failed': 'Key file not reachable',
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [testingDiscord, setTestingDiscord] = useState(false)

  useEffect(() => {
    api<Settings>('/settings')
      .then((data) => {
        setSettings(data)
      })
      .catch((err) => toast.error(err.message))
  }, [])

  async function save(patch: { discordWebhookUrl?: string | null; events?: string[] }) {
    setBusy(true)
    try {
      const updated = await api<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) })
      setSettings(updated)
      setWebhookUrl('')
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  function toggleEvent(key: string, enabled: boolean) {
    if (!settings) return
    const events = enabled ? [...settings.events, key] : settings.events.filter((e) => e !== key)
    setSettings({ ...settings, events }) // optimistic update
    api<Settings>('/settings', { method: 'PUT', body: JSON.stringify({ events }) }).catch((err) => {
      toast.error(err.message)
      setSettings(settings)
    })
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error('Clipboard unavailable'),
    )
  }

  async function rotateWebhookSecret() {
    setBusy(true)
    try {
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const updated = await api<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify({ webhookSecret: secret }),
      })
      setSettings(updated)
      toast.success('Webhook secret updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rotate secret')
    } finally {
      setBusy(false)
    }
  }

  async function testDiscord() {
    setTestingDiscord(true)
    try {
      await api('/settings/test-notification', { method: 'POST' })
      toast.success('Test notification sent to Discord')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test notification')
    } finally {
      setTestingDiscord(false)
    }
  }

  if (!settings) return <Layout>{null}</Layout>

  const curlExample = `curl -X POST "${window.location.origin}/hook/<SITE_ID>" \\
  -H "X-Webhook-Secret: ${settings.webhookSecret ?? '<SECRET>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/new-page"}'`

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Global Settings</h1>
          <p className="text-sm text-muted-foreground">Manage webhooks, secrets, and notification preferences</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: Webhook Secret & Quick Snippets */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Key className="size-4 text-primary" /> Account Webhook Secret
                </CardTitle>
                {settings.webhookSecret && (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                    Active
                  </Badge>
                )}
              </div>
              <CardDescription>
                Authenticates incoming URL indexing requests via the <code>X-Webhook-Secret</code> HTTP header.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.webhookSecret ? (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Secret Token</Label>
                    <div className="flex items-center gap-2">
                      <Input readOnly value={settings.webhookSecret} className="font-mono text-xs" />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copy(settings.webhookSecret!, 'Webhook secret')}
                        title="Copy secret"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <Terminal className="size-3.5" /> Quick cURL Snippet
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => copy(curlExample, 'cURL command')}
                        className="h-6 gap-1 text-[11px]"
                      >
                        <Copy className="size-3" /> Copy cURL
                      </Button>
                    </div>
                    <pre className="overflow-x-auto text-[11px] leading-relaxed text-muted-foreground">
                      <code>{curlExample}</code>
                    </pre>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      💡 <strong>Tip:</strong> Send without a body (or empty JSON) to automatically re-sync the site's sitemap and submit any new or updated pages.
                    </p>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No webhook secret configured yet. Generate one to enable webhook triggers for your sites.
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button disabled={busy} size="sm" onClick={rotateWebhookSecret} variant="outline" className="gap-2">
                <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
                {settings.webhookSecret ? 'Rotate Secret' : 'Generate Secret'}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Right column: Discord Webhook & Event Notifications */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="size-4 text-primary" /> Discord Integration
                </CardTitle>
                {settings.discordConfigured ? (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Check className="size-3" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not configured</Badge>
                )}
              </div>
              <CardDescription>
                Send real-time alerts to a Discord channel when submissions occur or errors happen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="webhook" className="text-xs">
                  {settings.discordConfigured ? 'Replace Webhook URL' : 'Discord Webhook URL'}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="webhook"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder={settings.discordConfigured ? 'https://discord.com/api/webhooks/...' : 'Paste Discord Webhook URL...'}
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    disabled={busy || !webhookUrl}
                    onClick={() => save({ discordWebhookUrl: webhookUrl })}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
            {settings.discordConfigured && (
              <CardFooter className="flex items-center justify-between border-t bg-muted/20 px-6 py-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingDiscord}
                  onClick={testDiscord}
                  className="gap-1.5"
                >
                  <Send className="size-3.5" />
                  {testingDiscord ? 'Sending test...' : 'Send Test Notification'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => save({ discordWebhookUrl: null })}
                  className="text-destructive hover:text-destructive"
                >
                  Remove Integration
                </Button>
              </CardFooter>
            )}
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notification Triggers</CardTitle>
              <CardDescription>Select which events post updates to your Discord webhook.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border/60">
              {settings.eventKeys.map((key) => (
                <div key={key} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <div className="space-y-0.5">
                    <Label htmlFor={key} className="cursor-pointer text-xs font-medium">
                      {EVENT_LABELS[key] ?? key}
                    </Label>
                    <div className="text-[10px] font-mono text-muted-foreground">{key}</div>
                  </div>
                  <Switch
                    id={key}
                    checked={settings.events.includes(key)}
                    onCheckedChange={(checked) => toggleEvent(key, checked)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  )
}

