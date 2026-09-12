import { readError, readJson, type ChatRequest, type ChatResult, type Provider } from './index';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini',
  keyPlaceholder: 'AIza…',
  keysUrl: 'https://aistudio.google.com/app/apikey',
  // List prices, USD per million tokens.
  models: [
    {
      id: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash · recommended',
      inputPer1M: 0.75,
      outputPer1M: 3.75,
      // Google's introductory price ends after 2026; do not silently underquote later.
      priceAfter: { at: Date.UTC(2027, 0, 1), inputPer1M: 1.5, outputPer1M: 7.5 },
      supportsVision: true,
    },
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
        generationConfig: {
          maxOutputTokens: model === 'gemini-3.8-flash' ? Math.max(256, req.maxTokens) : req.maxTokens,
          responseMimeType: 'application/json',
          // 3.8 defaults to medium thinking. Classification is bounded and structured,
          // so low retains reasoning while avoiding needless latency and hidden tokens.
          ...(model === 'gemini-3.8-flash'
            ? { thinkingConfig: { thinkingLevel: 'low' } }
            : {}),
        },
      }),
    });

    if (!res.ok) throw await readError(res);

    const data = await readJson<{
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      // thoughtsTokenCount is billed at the output rate and is reported separately.
      // 2.5 Flash and Pro think by default, so omitting it under-reported every call.
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    }>(res);

    return {
      text: (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens:
          (data.usageMetadata?.candidatesTokenCount ?? 0) +
          (data.usageMetadata?.thoughtsTokenCount ?? 0),
      },
    };
  },
};
