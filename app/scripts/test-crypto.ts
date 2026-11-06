import { randomBytes } from "node:crypto";
process.env.CHANNEL_TOKEN_KEY = randomBytes(32).toString("base64");
import { decryptToken, encryptToken, readState, signState } from "../src/lib/crypto";
let fails = 0;
const ck = (n: string, ok: boolean) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const tok = "IGAA" + randomBytes(40).toString("hex");
const enc = encryptToken(tok);
ck("encrypted value is a bytea literal and hides the token", enc.startsWith("\\x") && !Buffer.from(enc.slice(2), "hex").toString("latin1").includes("IGAA"));
ck("round trip returns the same token", decryptToken(enc) === tok);
ck("two encryptions of the same token differ (random iv)", encryptToken(tok) !== enc);
const tampered = enc.slice(0, -2) + (enc.endsWith("00") ? "01" : "00");
let threw = false; try { decryptToken(tampered); } catch { threw = true; }
ck("a tampered value fails to decrypt", threw);
const st = signState({ u: "user1", n: "abc", exp: 1 });
ck("signed state reads back", (readState<{ u: string }>(st))?.u === "user1");
ck("forged state is rejected", readState(st.replace(/^[^.]+/, Buffer.from('{"u":"evil"}').toString("base64url"))) === null);
ck("garbage state is rejected", readState("nonsense") === null && readState(undefined) === null);
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
