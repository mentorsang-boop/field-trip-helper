import { createClient } from 'jsr:@supabase/supabase-js@2';
import { admin, AppError, serve } from '../_shared/common.ts';

const EMAIL = 'teacher@field-trip-helper.app'; // 공용 교사 계정 (메일은 보내지 않음)
const MAX_FAILS = 10;                          // 10분 동안 10번 틀리면 잠금
const WINDOW_MS = 10 * 60_000;

// 교사 비밀번호 하나로 로그인: 서버에서 확인한 뒤 공용 교사 계정의 세션을 돌려준다
serve(async ({ pin }) => {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await admin.from('ft_login_fails').select('id', { count: 'exact', head: true }).gte('at', since);
  if ((count ?? 0) >= MAX_FAILS) throw new AppError(429, '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해주세요.');

  const { data: ok } = await admin.rpc('ft_check_pin', { pin: String(pin ?? '') });
  if (!ok) {
    await admin.from('ft_login_fails').insert({});
    throw new AppError(401, '비밀번호가 맞지 않아요.');
  }

  // 계정이 없으면 만든다 (이미 있으면 오류를 무시)
  await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  if (error) throw error;

  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data, error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (e2 || !data.session) throw e2 ?? new Error('세션 없음');
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
});
