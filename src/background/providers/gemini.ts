import { readError, type ChatRequest, type Provider } from './index';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini',
  keyPlaceholder: 'AIza…',
  keysUrl: 'https://aistudio.google.com/app/apikey',
  models: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · fast', costPer1kPosts: 0.09, supportsVision: true },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', costPer1kPosts: 1.2, supportsVision: true },
  ],

  async chat(req: ChatRequest, key: string, model: string): Promise<string> {
    const parts: unknown[] = [{ text: req.user }];
    if (req.image) {
      parts.push({
        inline_data: { mime_type: req.image.mediaType, data: req.image.base64 },
      });
    }

    // The key goes in a header rather than the query string so it never lands in a
    // URL that could be logged by an intermediary.
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: req.maxTokens, responseMimeType: 'text/plain' },
      }),
    });

    if (!res.ok) throw await readError(res);

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
  },
};
