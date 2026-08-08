import { readError, type ChatRequest, type ChatResult, type Provider } from './index';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini',
  keyPlaceholder: 'AIza…',
  keysUrl: 'https://aistudio.google.com/app/apikey',
  // List prices, USD per million tokens.
  models: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · fast', inputPer1M: 0.3, outputPer1M: 2.5, supportsVision: true },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputPer1M: 1.25, outputPer1M: 10, supportsVision: true },
  ],

  async chat(req: ChatRequest, key: string, model: string): Promise<ChatResult> {
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
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    return {
      text: (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  },
};
