import { readError, type ChatRequest, type Provider } from './index';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export const openai: Provider = {
  id: 'openai',
  label: 'OpenAI',
  keyPlaceholder: 'sk-…',
  keysUrl: 'https://platform.openai.com/api-keys',
  models: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini · fast', costPer1kPosts: 0.11, supportsVision: true },
    { id: 'gpt-4o', label: 'GPT-4o', costPer1kPosts: 1.8, supportsVision: true },
  ],

  async chat(req: ChatRequest, key: string, model: string): Promise<string> {
    const userContent: unknown[] = [{ type: 'text', text: req.user }];
    if (req.image) {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${req.image.mediaType};base64,${req.image.base64}`,
          detail: 'low', // image tokens dominate cost; low is plenty for a thumbnail
        },
      });
    }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
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

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  },
};
