// Offline checks for signature verification and event splitting. Run: node scripts/test-meta.mjs
import { createHmac } from "node:crypto";
import { eventsFrom, verifySignature } from "../src/lib/meta.ts";

let fails = 0;
const ck = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const secret = "s3cret";
const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841", time: 1, changes: [{ field: "comments", value: { id: "c1", text: "whitepaper" } }] }] });
const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
ck("valid signature accepted", verifySignature(body, sig, secret));
ck("wrong secret rejected", !verifySignature(body, sig, "other"));
ck("tampered body rejected", !verifySignature(body + " ", sig, secret));
ck("missing header rejected", !verifySignature(body, null, secret));
ck("garbage header rejected", !verifySignature(body, "sha256=zz", secret) && !verifySignature(body, "md5=abc", secret));
const ev = eventsFrom(JSON.parse(body));
ck("comment becomes one event with a stable id", ev.length === 1 && ev[0].id === "instagram:comments:c1" && ev[0].accountId === "17841");
const dm = eventsFrom({ object: "instagram", entry: [{ id: "17841", time: 2, messaging: [{ sender: { id: "u1" }, recipient: { id: "17841" }, timestamp: 2, message: { mid: "m1", text: "hi" } }, { sender: { id: "u1" }, timestamp: 3, postback: { mid: "m2", payload: "x" } }] }] });
ck("two messaging items become two events", dm.length === 2 && dm[0].id === "instagram:message:m1" && dm[1].id === "instagram:postback:m2");
ck("same body twice gives the same ids (dedupe)", JSON.stringify(eventsFrom(JSON.parse(body)).map((e) => e.id)) === JSON.stringify(ev.map((e) => e.id)));
ck("non-Meta body gives no events", eventsFrom({ hello: 1 }).length === 0 && eventsFrom(null).length === 0);
const page = eventsFrom({ object: "page", entry: [{ id: "p1", changes: [{ field: "feed", value: { item: "comment", comment_id: "pc1", post_id: "p1_9" } }] }] });
ck("page feed comment keyed by comment_id", page.length === 1 && page[0].id === "page:feed:pc1");
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
