import { after, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { eventsFrom, verifySignature } from "@/lib/meta";
import { processPending } from "@/lib/engine/process";
import { sendQueued } from "@/lib/engine/sender";

/** Meta's handshake when you save the webhook in the app dashboard. */
export async function GET(req: NextRequest) {
  const token = process.env.META_VERIFY_TOKEN;
  const q = req.nextUrl.searchParams;
  if (token && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Events from Instagram, Messenger and Facebook Pages. Verify the signature, store each event once, answer fast. */
export async function POST(req: NextRequest) {
  // Meta signs with the app secret. Instagram-login apps have a separate Instagram app secret, so accept either.
  const secrets = [process.env.META_APP_SECRET, process.env.INSTAGRAM_APP_SECRET].filter((x): x is string => !!x);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secrets.length || !url || !key) return new NextResponse("not configured", { status: 501 });

  const raw = await req.text(); // the signature covers the exact bytes, so read the body as text first
  const sig = req.headers.get("x-hub-signature-256");
  if (!secrets.some((sec) => verifySignature(raw, sig, sec))) return new NextResponse("bad signature", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }
  const events = eventsFrom(body);
  if (events.length) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    // unique (provider, external_event_id): a retry from Meta is ignored instead of stored twice
    const { error } = await db
      .from("webhook_events")
      .upsert(events.map((e) => ({ provider: "meta", external_event_id: e.id, payload: e.payload })), { onConflict: "provider,external_event_id", ignoreDuplicates: true });
    if (error) {
      console.error("[meta webhook] store failed", error.message);
      return new NextResponse("retry", { status: 500 }); // Meta retries on non-2xx
    }
  }
  // Answer Meta now, process after the response is sent. Anything missed is picked up by /api/jobs/tick.
  if (events.length) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    after(async () => {
      try {
        await processPending(db, 25);
        await sendQueued(db, { limit: 25 }); // does nothing unless META_SEND_ENABLED=true
      } catch (e) {
        console.error("[meta webhook] processing failed", e instanceof Error ? e.message : e);
      }
    });
  }
  return new NextResponse("ok", { status: 200 });
}
