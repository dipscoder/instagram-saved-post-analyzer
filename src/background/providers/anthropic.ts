import { readError, type ChatRequest, type Provider } from './index';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export const anthropic: Provider = {
  id: 'anthropic',
  label: 'Anthropic',
  keyPlaceholder: 'sk-ant-…',
  keysUrl: 'https://console.anthropic.com/settings/keys',
  models: [
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fast', costPer1kPosts: 0.14, supportsVision: true },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', costPer1kPosts: 0.9, supportsVision: true },
    { id: 'claude-opus-5', label: 'Claude Opus 5', costPer1kPosts: 4.5, supportsVision: true },
  ],

  async chat(req: ChatRequest, key: string, model: string): Promise<string> {
    const content: unknown[] = [];
    if (req.image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: req.image.mediaType, data: req.image.base64 },
      });
    }
    content.push({ type: 'text', text: req.user });

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Without this the browser preflight fails: the API rejects direct
        // browser-origin calls unless they opt in explicitly.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) throw await readError(res);

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  },
};
