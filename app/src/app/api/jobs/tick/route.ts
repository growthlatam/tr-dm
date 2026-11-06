import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { processPending, resumeDueRuns } from "@/lib/engine/process";
import { sendQueued } from "@/lib/engine/sender";
import { markExpired } from "@/lib/channels";

export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // no secret set = the job is off
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Scheduled job: picks up events that were not processed, and continues runs whose wait is over. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse("unauthorized", { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new NextResponse("not configured", { status: 501 });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const events = await processPending(db, 50);
  const resumed = await resumeDueRuns(db, 50);
  const sent = await sendQueued(db, { limit: 50 });
  const tokens = await markExpired(db);
  return NextResponse.json({ events, resumed, sent, tokens });
}
