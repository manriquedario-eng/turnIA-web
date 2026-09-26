import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=confirmation_failed', request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.warn('Email confirmation callback failed', {
      code: error.code,
      status: error.status,
    });
    return NextResponse.redirect(new URL('/login?error=confirmation_failed', request.url));
  }

  return NextResponse.redirect(new URL('/dashboard?welcome=1', request.url));
}
