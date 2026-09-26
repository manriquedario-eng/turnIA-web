import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');

  const supabase = await createSupabaseServerClient();

  let error = null;

  if (tokenHash && type === 'email') {
    ({ error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email',
    }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    return NextResponse.redirect(new URL('/login?error=confirmation_failed', request.url));
  }

  if (error) {
    console.warn('Email confirmation callback failed', {
      code: error.code,
      status: error.status,
    });
    return NextResponse.redirect(new URL('/login?error=confirmation_failed', request.url));
  }

  return NextResponse.redirect(new URL('/dashboard?welcome=1', request.url));
}
