import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { CONFIG } from '../config.js';

export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// Edge Function 호출. 실패하면 사람이 읽을 수 있는 메시지와 status를 담은 Error를 던진다.
export async function callFn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  let res;
  try {
    res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/ft-${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${session?.access_token ?? CONFIG.supabaseAnonKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('인터넷이 약해요. 다시 눌러줄래?'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '잠깐 문제가 생겼어요. 다시 눌러줄래?'), { status: res.status });
  return data;
}
