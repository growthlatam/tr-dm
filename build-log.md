# Build log

Stack as built: Next.js 15 (App Router) + TypeScript + Tailwind 3, Lucide icons, custom i18n (EN / PT-BR / ES-AR). Data is a fake in-memory + localStorage layer in `app/src/lib/store.ts` with the signatures replica-backend will implement. Nothing is sent to Meta. Run: `cd replica/app && npm run dev` (port 3100). No commits were made (not asked for).

Deviations from architecture.md: no `next-intl` yet (a small provider with the same three locales instead), no React Flow yet, no Supabase yet. All three come with the next steps.

| ID | screen | date | status | missing / harder than expected |
| --- | --- | --- | --- | --- |
| S03 | Home | 2026-11-05 | done | templates 2 and 3 are inactive placeholders |
| S04 | Automations list | 2026-11-05 | partial | no folders, trash, grid view, bulk select |
| S05 | Flow view | 2026-11-05 | partial | read-only linear view. The real drag canvas (React Flow), node editors, condition, randomizer, delay are not built |
| S07 | Comment trigger + message wizard | 2026-11-05 | done | includes post ID, 3 languages, PDF picker (not uploaded), phone preview, test panel. No exclude keywords, no quick replies |
| S14 | Content editor | 2026-11-05 | partial | only text + one button + PDF, inside the wizard |
| S21 | Contacts list | 2026-11-05 | partial | search only; no segments, filters, bulk actions |
| S22 | Contact profile | 2026-11-05 | partial | modal; no custom fields, no history |
| S23 | Inbox | 2026-11-05 | partial | threads, notes, assign, close, reminder flag, 24h window block. No canned replies, labels, scheduled messages, @mentions |
| S28 | Team | 2026-11-05 | partial | list and invite link are demo only; roles not enforced in the UI |
| S02 | Channels | 2026-11-05 | partial | static demo status |
| S01, S06, S08-S13, S15-S20, S24-S27, S29-S34 | other | | not built | |

Verified in the browser at 1440 and 390 px: validation errors, wizard save, test comment (accent-insensitive keyword match), button tap opening the window, agent reply pausing automations, contact profile, no horizontal scroll on /automations, /automations/new, /inbox, /settings, and no console warnings. `tsc` and `next build` pass.

Not verified: keyboard-only pass on every screen, screen reader pass, the flow view (/automations/[id]) and edit route visually, the closed-window composer state in the browser, long-name (60 char) layouts.

Harder than expected: the real flow editor is much bigger than the quick wizard. The wizard covers the headline use case, but the "flow builder" requirement (conditions, multiple paths) is still open and is the next big piece. Messenger is assumed identical to Instagram and has no screens of its own yet.

## Flow editor (2026-11-05, second pass)

Built: `app/src/lib/flow.ts` (graph types, wizard-to-graph, publish validator), the graph engine in `store.ts`, `components/flow/{editor,nodes,panel}.tsx`, `components/tester.tsx`. The old read-only flow page was replaced by the editor at `/automations/[id]`; the quick wizard stays at `/automations/new` and `/automations/[id]/edit` until a flow is edited in the canvas.

| area | status | notes |
| --- | --- | --- |
| Canvas (React Flow) | done | drag, connect, delete (not the trigger), snap to 8 px, zoom, fit, undo/redo (buttons and Ctrl/Cmd+Z), outline list as a text alternative |
| Step types | done | trigger, public reply, message (3 languages, button, PDF), condition (all/any, 7 fields), actions (6 types), random split (2-4 paths), wait |
| Draft vs published | done | edits autosave to a draft; Publish validates, then the draft becomes the version the engine runs |
| Publish validator | done | one trigger, no loops, everything connected, required fields, button/PDF limits, percentages = 100, Meta window rules (only the first message before a tap, no documents, no message after a wait before a tap) |
| Engine | done (simulated) | runs the graph for a test comment; a button tap continues from the `tap` output; waits queue and run on "run waiting steps now" |
| Test panel | done | follower, follower count, ad vs organic, language; transcript; fast-forward |

Checked in the browser: opened the seed flow, added a condition and an actions step (auto-connected), set "follows your account", ran a test as a follower: both tags applied, both branches of the PDF path ran, hit counters updated; added a second message before a tap and the validator blocked publishing; undo removed it; publish succeeded. No console warnings; no horizontal scroll at 390 px. `tsc` passes.

Not done / known gaps:
- Wait steps never fire on their own (needs the backend scheduler); only the test fast-forward runs them.
- Condition picker is a plain select, not the searchable grouped picker the original has. No custom-field, segment or sequence conditions yet.
- No version history, no per-node sent/delivered/read numbers (only hit counts), no minimap (it rendered blank).
- Keyboard: nodes are focusable and Delete works, and the outline lets you select steps, but connecting two steps by keyboard only is not possible yet. Needs a "connect to…" control in the panel.
- Not checked: screen reader pass, 60-character names inside nodes, a 20+ node flow.
- Public replies are not per language yet.

## Remaining triggers (2026-11-05, third pass)

Built: the trigger step now has a "Starts when" choice. `lib/flow.ts` (types, `triggerOf`, `matchTrigger`, validator), `engine` in `store.ts` (`simulateEvent`), trigger panel in `components/flow/panel.tsx`, test panel in `components/tester.tsx`.

| trigger | status | notes |
| --- | --- | --- |
| Instagram comment | done | unchanged, plus an exclude list |
| Facebook comment | done | same rules, Facebook posts in the picker (two seed posts), channel Messenger |
| Message keyword | done | 5 match types (contains, exactly, whole word, begins with, does not contain) and an exclude list; channel Instagram or Messenger |
| Ad message | done | optional ad ID, channel Instagram or Messenger; validator requires a button on the first message |
| Story reply | done | keyword or any word |
| Story mention | partial | fires on any mention; whether a mention opens the 24h window is [verify] with Meta |
| Default reply | done | once per person every N hours; yields to a live automation that matches the word |

Rules that changed with this: when the person writes first (message, ad, story) the 24h window is open from the start, so the "only one message before a tap, no documents" check is skipped; a wait of 24h or more before a message still blocks publishing. Public reply steps only run on comment triggers, and the validator flags them elsewhere.

Checked in the browser: switched the seed flow to message keyword (message sent, tap opened the PDF), ad, story mention, default reply and Facebook comment, all fired; a second default reply to the same person inside the window was held back; the validator flagged the public reply step for the non-comment triggers. No horizontal scroll at 375 px. `tsc` and `next build` pass.

Found and fixed on the way: after a hard reload the flow editor and the quick edit page copied the seed data instead of the saved data (and a later edit would have overwritten the saved draft). Both now wait for `useHydrated()`.

Not done / not exercised:
- "Another automation answers it" for the default reply is written but I did not run it (the demo has one automation only).
- No screen creates an automation with a non-comment trigger from scratch: you change the trigger of an existing flow in the editor. The Automations list does not show the trigger type or channel yet.
- Triggers still use the same message-per-language rules; no per-trigger templates.
- The canvas opens zoomed out and cut off on the left at an 800 px wide window (seen in the last screenshot); not investigated.
- Messenger has no screens of its own; story triggers are Instagram only by design.
