import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body?.logs)) {
    console.warn('[Apple Wallet device log]', body.logs.join('\n'));
  }
  return new NextResponse(null, { status: 200 });
}
