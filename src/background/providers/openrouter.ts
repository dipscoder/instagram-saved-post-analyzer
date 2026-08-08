import { readError, type ChatRequest, type ChatResult, type Provider } from './index';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** OpenRouter speaks the OpenAI chat-completions shape, so this mirrors openai.ts. */
export const openrouter: Provider = {
  id: 'openrouter',
  label: 'OpenRouter',
  keyPlaceholder: 'sk-or-…',
  keysUrl: 'https://openrouter.ai/keys',
  // OpenRouter passes the upstream model's list price through, USD per million tokens.
  models: [
    { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', inputPer1M: 1, outputPer1M: 5, supportsVision: true },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash · fast', inputPer1M: 0.3, outputPer1M: 2.5, supportsVision: true },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B · text only', inputPer1M: 0.12, outputPer1M: 0.3, supportsVision: false },
  ],

  async chat(req: ChatRequest, key: string, model: string): Promise<ChatResult> {
    const userContent: unknown[] = [{ type: 'text', text: req.user }];
    if (req.image) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${req.image.mediaType};base64,${req.image.base64}` },
      });
    }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        // OpenRouter attributes traffic by these; both are optional but polite.
        'HTTP-Referer': 'https://github.com/local/saved-index',
        'X-Title': 'Saved Index',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!res.ok) throw await readError(res);

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  },
};
