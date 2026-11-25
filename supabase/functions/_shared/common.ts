import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
export const admin = createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// 모든 함수 공통: CORS, JSON 입출력, 학생이 이해할 수 있는 오류 메시지
export function serve(handler: (body: any, req: Request) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try {
      const body = await req.json().catch(() => ({}));
      return Response.json(await handler(body, req), { headers: cors });
    } catch (e) {
      if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status, headers: cors });
      console.error(e);
      return Response.json({ error: '잠깐 문제가 생겼어요. 다시 눌러줄래?' }, { status: 500, headers: cors });
    }
  });
}

// 학생 요청: student_id가 그 trip에 속하고, 이 폰(device_id)에 묶여 있는지 확인
export async function verifyStudent({ trip_id, student_id, device_id }: any) {
  if (!trip_id || !student_id || !device_id) throw new AppError(400, '정보가 부족해요. QR을 다시 찍어줘.');
  const { data } = await admin.from('ft_students').select('id, trip_id, device_id')
    .eq('id', student_id).eq('trip_id', trip_id).maybeSingle();
  if (!data || data.device_id !== device_id) throw new AppError(403, '이 폰에 등록된 이름이 아니에요. 이름을 다시 골라줘.');
  return data;
}

// 교사 요청: 로그인 토큰으로 RLS가 적용되는 클라이언트를 돌려준다
export async function teacher(req: Request) {
  const client = createClient(URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data } = await client.auth.getUser();
  if (!data.user) throw new AppError(401, '로그인이 필요해요.');
  return client;
}

export const SLOT_MS = 30_000;

export async function qrToken(secret: string, cpId: string, slot: number) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${cpId}:${slot}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

export async function qrSecret(tripId: string) {
  const { data } = await admin.from('ft_trip_secrets').select('qr_secret').eq('trip_id', tripId).single();
  return data!.qr_secret as string;
}
