// Message variables: [name] and [username], filled in when a message is queued. Pure, so it is tested without a database.
export type Person = { first_name?: string | null; username?: string | null };

const clean = (v: string | null | undefined) => (v ?? "").replace(/[\[\]\r\n]/g, "").trim();

/** [name] is the first name when we know it, else the @handle without the @. [username] is the handle.
 *  Matching ignores case. A variable with no data disappears, and the spaces and commas around it are tidied. */
export function fillVars(text: string, p: Person): string {
  if (!text.includes("[")) return text;
  const username = clean(p.username).replace(/^@/, "");
  const first = clean(p.first_name).split(/\s+/)[0] ?? "";
  const name = first || username;
  let empty = false;
  const out = text.replace(/\[(name|username)\]/gi, (_m, k: string) => {
    const v = k.toLowerCase() === "name" ? name : username;
    if (!v) empty = true;
    return v;
  });
  if (!empty) return out;
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/^[\s,.;:!?]+/, "")
    .trim();
}
