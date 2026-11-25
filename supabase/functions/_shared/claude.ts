import { AppError } from './common.ts';

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-5-5';

// Claude에 한 번 묻고, 응답 속 JSON 객체를 꺼내 돌려준다
export async function askClaude(system: string, content: unknown[], maxTokens = 500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    console.error('Claude API', res.status, await res.text());
    throw new AppError(502, 'AI가 잠깐 쉬고 있어요. 다시 눌러줄래?');
  }
  const data = await res.json();
  const text = (data.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  try {
    return JSON.parse(text.match(/\{[\s\S]*\}/)![0]);
  } catch {
    console.error('JSON 아님', text);
    throw new AppError(502, 'AI 답이 이상해요. 다시 눌러줄래?');
  }
}
