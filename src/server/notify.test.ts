import { describe, expect, it, vi } from 'vitest'
import { sendDiscord } from './notify'

describe('sendDiscord notification helper', () => {
  it('sends embed payload to Discord webhook URL successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    })
    vi.stubGlobal('fetch', mockFetch)

    await expect(
      sendDiscord('https://discord.com/api/webhooks/123/abc', 'manual.success', {
        site: 'example.com',
        urlCount: 5,
        statusCode: 200,
      }),
    ).resolves.not.toThrow()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    )

    vi.unstubAllGlobals()
  })

  it('throws descriptive error when Discord webhook URL returns non-2xx status code', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"message": "Unknown Webhook", "code": 10015}',
    })
    vi.stubGlobal('fetch', mockFetch)

    await expect(
      sendDiscord('https://discord.com/api/webhooks/123/invalid', 'manual.success', {
        site: 'example.com',
      }),
    ).rejects.toThrow('Discord API returned HTTP 400: {"message": "Unknown Webhook", "code": 10015}')

    vi.unstubAllGlobals()
  })
})
