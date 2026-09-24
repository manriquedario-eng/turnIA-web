import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { ok: false, disabled: true },
    { status: 410 },
  );
}
