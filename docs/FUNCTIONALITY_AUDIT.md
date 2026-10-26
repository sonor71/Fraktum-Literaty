# Functionality audit — 2026-10-26

This is an implementation inventory. Cloud contracts exercised against fixtures
do not establish that production permissions, OTP delivery or storage work.

| Surface | Implemented behavior | Storage / availability |
| --- | --- | --- |
| Registration / login | Request and verify email/SMS OTP, restore and rotate sessions, logout | Supabase Auth; needs project configuration and provider setup |
| Profile | Edit text, books, links and genre/topic preferences transactionally; upload, replace and remove avatar/banner | Supabase RPC and Storage; new migrations required |
| Feed | Create text/media post, like, comments, comment reactions, report | Supabase REST/Storage; no seeded production posts |
| Share | Native Web Share, clipboard fallback, stable `/post/<uuid>` route, missing/error UI | Loads the post independently of the current feed page |
| Navigation | Browser history, scroll restoration, View Transitions or CSS fallback | Local navigation state; reduced motion supported |
| Chat | DM lookup by username, messages, project group conversations, drawer and edge toggle | Supabase conversations/messages |
| Calls | One-to-one audio/video, mute, camera toggle/switch, reject, hangup, connection diagnostics and timeouts | Supabase signaling + RTCPeerConnection; live media acceptance is outstanding |
| Editor | Structured images shared by document, draft, fragment and book; geometry/history and flow/free modes | Local draft plus cloud persistence; files use Storage asset records |
| Reading | Published works, library/progress, annotations, reviews/reactions | Supabase; local progress changes explicitly report sync failures |
| Evaluation | Catalog/session selection and progress, anchored feedback | Supabase RPCs and version/fragment records |
| Moderation | Reports, author verification requests and admin resolution | Server authorization required; browser role checks alone are insufficient |
| Review statistics | Counts and averages from existing reviews | Computed statistics; no AI-generated review claims |
| Private notes | Save personal notes on the current device | Explicitly local; no cross-device guarantee |
| Legacy communities | Read existing records stored on the current device | Read-only; no production membership backend exists |
| FRAKTUM TCG | Opens the configured game and exchanges a session only with its expected origin/project | Separate application; end-to-end integration not verified here |

## Explicitly unavailable

- Community creation, membership changes and community tabs: disabled, labelled
  **Скоро**. Old local counter mutations no longer pretend to create membership.
- Author replies to reviews: disabled, labelled **Скоро**, until an ownership-
  checked cloud persistence contract exists. Legacy dispatcher aliases report
  unavailability and do not fabricate successful writes.
- Group media calls: disabled, labelled **Скоро**. Group text conversations remain
  available. The one-to-one peer transport is not presented as a group call.
- Messenger file attachments have no implementation/control in this snapshot;
  post media and editor uploads are separate implemented paths.

## Controls, diagnostics and legacy markers

- Every rendered static `data-action` has a dispatcher branch. Form submit
  buttons submit handled forms; call sound/notification controls register direct
  listeners. The editor's static ribbon label is not an empty button.
- Asynchronous actions expose `aria-busy`, prevent duplicate submission and
  restore controls on errors. Feedback does not remount the active form.
- Blocking `alert()` calls have been replaced by visible dismissible feedback;
  polling failures are reported once per distinct cause instead of noisy warnings.
- `console.warn`, `prototype`, `демо` and `FIXME` are absent from application
  sources. Two intentional `TODO`s identify the disabled community/reply backend
  requirements. Historical changelogs and old audit documents are history, not
  active product controls.
- Call diagnostics use opt-in `VITE_RTC_DEBUG`; they omit SDP, ICE addresses and
  TURN credentials. Failure states remain visible with debug disabled.
- The manifest now uses actual 192×192 and 512×512 PNGs and separate favicon and
  Apple touch icon assets rather than declaring the 206×92 wordmark an icon.

See `STABILIZATION_REPORT.md` for executed checks and remaining acceptance gaps.
