import { readError, readJson, type ChatRequest, type ChatResult, type Provider } from './index';

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

/** GPT-5.6 gets its reasoning controls through the Responses API. */
export function usesResponsesApi(model: string): boolean {
  return model.startsWith('gpt-5.6');
}

export const openai: Provider = {
  id: 'openai',
  label: 'OpenAI',
  keyPlaceholder: 'sk-…',
  keysUrl: 'https://platform.openai.com/api-keys',
  // List prices, USD per million tokens.
  models: [
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna · recommended', inputPer1M: 0.2, outputPer1M: 1.2, supportsVision: true },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra · quality', inputPer1M: 2, outputPer1M: 12, supportsVision: true },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini · fast', inputPer1M: 0.15, outputPer1M: 0.6, supportsVision: true },
    { id: 'gpt-4o', label: 'GPT-4o', inputPer1M: 2.5, outputPer1M: 10, supportsVision: true },
  ],

  async chat(req: ChatRequest, key: string, model: string): Promise<ChatResult> {
    if (usesResponsesApi(model)) return responsesChat(req, key, model);

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

    const res = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!res.ok) throw await readError(res);

    const data = await readJson<{
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(res);

    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  },
};

async function responsesChat(req: ChatRequest, key: string, model: string): Promise<ChatResult> {
  // OpenAI's JSON-object mode validates the `input` messages separately from
  // `instructions`: saying JSON only in the system instruction still returns a 400.
  const content: unknown[] = [
    { type: 'input_text', text: `Return the result as JSON.\n\n${req.user}` },
  ];
  if (req.image) {
    content.push({
      type: 'input_image',
      image_url: `data:${req.image.mediaType};base64,${req.image.base64}`,
      detail: 'low',
    });
  }

  const res = await fetch(RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      instructions: req.system,
      input: [{ role: 'user', content }],
      // Includes visible and reasoning tokens. Keep enough room for a small low-effort
      // reasoning trace even for the key test and one-post vision response.
      max_output_tokens: Math.max(256, req.maxTokens),
      reasoning: { effort: 'low', context: 'current_turn' },
      text: { format: { type: 'json_object' }, verbosity: 'low' },
      store: false,
    }),
  });

  if (!res.ok) throw await readError(res);

  const data = await readJson<{
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  }>(res);
  const outputText =
    data.output_text ??
    (data.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text ?? '')
      .join('');

  return {
    text: outputText,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      // The API includes reasoning tokens in output_tokens, so metered spend remains
      // honest without adding output_tokens_details a second time.
      outputTokens: data.usage?.output_tokens ?? 0,
    },
  };
}
