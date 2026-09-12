import { readError, readJson, type ChatRequest, type ChatResult, type Provider } from './index';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export const anthropic: Provider = {
  id: 'anthropic',
  label: 'Anthropic',
  keyPlaceholder: 'sk-ant-…',
  keysUrl: 'https://console.anthropic.com/settings/keys',
  // List prices, USD per million tokens.
  models: [
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fast', inputPer1M: 1, outputPer1M: 5, supportsVision: true },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', inputPer1M: 2, outputPer1M: 10, supportsVision: true },
    { id: 'claude-opus-5', label: 'Claude Opus 5', inputPer1M: 5, outputPer1M: 25, supportsVision: true },
  ],

  async chat(req: ChatRequest, key: string, model: string): Promise<ChatResult> {
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
        max_tokens: model === 'claude-sonnet-5' ? Math.max(256, req.maxTokens) : req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content }],
        // Sonnet 5 enables adaptive thinking at high effort by default. This workload is
        // a concise classification task: low effort keeps its reasoning advantage while
        // preventing an unexpectedly large hidden-token bill.
        ...(model === 'claude-sonnet-5'
          ? { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }
          : {}),
      }),
    });

    if (!res.ok) throw await readError(res);

    const data = await readJson<{
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    }>(res);

    return {
      text: (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  },
};
