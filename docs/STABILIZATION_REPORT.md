# FRAKTUM Literature — отчёт стабилизации, 26 октября 2026

**Production Definition of Done пока не выполнен.** Изменения кода и локальные
регрессионные проверки не подтверждают живую схему Supabase, доставку OTP или
медиасоединение между двумя реальными аккаунтами.

Исходная база: актуальная `main`, commit
`7b5793e7154e4bde70b3c1be40cb3281601eaf34`. Код получен из GitHub после появления
исходников в удалённом репозитории. ZIP ранее превышал лимит передачи 32 МиБ;
побайтовое соответствие этому ZIP не проверялось. Работа находится в отдельной
ветке `codex/20261026-production-stabilization`, без изменений истории `main`.

Ветка отправлена в origin; открыт PR: https://github.com/sonor71/Fraktum-Literaty/pull/1.
Основной commit изменений: `57ef06a`.

## Причины и исправления

| Область | Причина | Результат |
| --- | --- | --- |
| Чаты | Drawer и toggle имели независимые fixed-позиции и конфликтующие mobile CSS | Общий shell/slide, один transform 300 мс, край кнопки совпадает с drawer, inert/ARIA/Escape/reduced motion |
| Навигация | Синхронный render без общего перехода/history; async permalink сбрасывал scroll | View Transitions или fade/translate 200 мс, история и scroll после загрузки, обработка ошибок перехода |
| Share | Кнопка не имела handler/permalink | Web Share или clipboard, toast, отдельная загрузка `/post/<uuid>`, missing/error UI; закрытый пост не восстанавливается из кеша |
| Редактор | HTML figures в документе и отдельный canvas в книге; normalization удаляла asset metadata; фрагменты сохраняли только текст | Общий structured media object и renderer для document/draft/fragment/book; Storage asset records, geometry, layers, flow/free, caption/alt, history |
| Сохранение | Autosave писал только localStorage; полный render терял метаданные до debounce | Последовательная cloud-save очередь и немедленный capture метаданных; восстановление с другого browser context |
| Старые медиа | Data/blob URL непереносимы между устройствами | Исходный snapshot сохраняется, сохранение явно приостановлено до загрузки/замены источника в Storage; новые binary JSON не создаются |
| Mobile Studio | Проекты/параметры скрывались CSS, controls перекрывали поля | Доступные проекты/страницы/параметры, natural scrolling, реальные взаимодействия на 360/390/430px |
| Звонки | Неиспользуемый config, STUN-only, конкурентный polling, ранние ICE и cursor loss, нет полного lifecycle | CallSession: очереди SDP/ICE, последовательный polling, timeout/cleanup, controls, TURN, debug getStats и явные статусы |
| Профиль | Отсутствующий UPDATE grant, перезапись кешируемого пути, отсутствие DELETE policies, stale null fallback | Immutable upload→pointer→cleanup, remove/replace, серверные пустые значения сохраняются, атомарный RPC текста/предпочтений |
| DB безопасность | UPDATE мог затронуть privileged fields; legacy verification RPC отсутствует в baseline | Owner RLS + privilege trigger; persisted-admin wrapper над фактической установленной функцией; inventory EXECUTE/RLS |
| PWA | Wordmark 206×92 использовался как manifest icon | Реальные PNG192/512, favicon32/apple180 и корректный MIME |
| Пустые действия | Community/reply меняли только локальные записи | «Скоро»/disabled, guards без фиктивных cloud writes; group calls также disabled |
| Auth | Параллельная ротация refresh token и удаление сессии при сетевой ошибке | Single-flight refresh, сохранение на network outage, отмена просроченного результата после logout |
| Рецензии | Локальная публикация/XP происходили до подтверждения сервера | Сначала cloud write; при отказе форма и данные сохраняются, успех/локальные XP не выдумываются; retry/reload проверены |
| Ошибки/feedback | Blocking alerts и проглоченные async ошибки | Видимая обратная связь без remount формы, pending/защита duplicate submissions, читаемые sync failures |
| Dev server | Checkout internals выдавались как статика, malformed URL мог обрушить сервер | Allowlist ресурсов, закрытые dotfiles, HTTP400/404, runtime-config no-store |

## Миграции

- `202610260001_profile_media_permissions.sql`: production UPDATE grant;
  owner/restrictive RLS; защита author_verified/is_admin/XP/reputation; согласованные
  avatar/banner/work-asset policies; атомарный `lit_save_my_profile`.
- `202610260002_verification_rpc_guard.sql`: обнаруживает существующую UUID/text
  сигнатуру resolver, сохраняет legacy implementation под защищённым internal
  именем, проверяет persisted admin перед вызовом, ограничивает EXECUTE известных
  auth-dependent definer routines. Неизвестная сигнатура прерывает транзакцию.
- `supabase/security_audit.sql`: read-only inventory функций, effective EXECUTE,
  RLS/policies и schema privileges. Это дополнение к Advisor, не его замена.

История до v0.19 отсутствует. Она не восстановлена догадками; применение миграций
к production не выполнялось. Подробности и SQL matrix находятся в
`PROFILE_SECURITY_AUDIT.md` и `supabase/baseline/README.md`.

## Фактически выполненные проверки

Финальные результаты команд приведены ниже. Браузерные сценарии используют
изолированные HTTP fixtures, SQL — настоящий PostgreSQL-движок PGlite с явно
тестовой prerequisite schema. Это не live production acceptance.

| Команда / проверка | Результат |
| --- | --- |
| Frozen dependency install | Проверен с lockfile; точные devDependencies установлены |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS; проверяет редакторную TypeScript-модель, не весь JS |
| `npm test` | 78 PASS, 0 FAIL, 0 SKIP |
| `npm run test:integration` | 29 PASS, 0 FAIL, 0 SKIP; включая SQL/RLS/rollback/admin/service checks |
| `npm run build` с текущими переменными | BLOCKED: Missing required environment variable: VITE_SUPABASE_URL |
| Build в отдельной копии с fixture config | PASS; production coordinates и подключение не подтверждает |
| `PORT=5173 npm run dev` с текущими переменными | BLOCKED по той же обязательной конфигурации |
| `npm run test:e2e` | 36 PASS, 0 FAIL, 1 SKIP (RTP / managed Chromium policy), 34,4 с |
| `git diff --check` | PASS |

E2E проверяют регистрацию/OTP/login/logout/session restore, busy/error сохранность
форм, share/permalink, навигацию/back/forward/scroll, drawer geometry на
360/390/430/1366/1920px, профиль/avatar/banner replace/remove/reload, image post,
like/comment/reaction, DM/group messages, все четыре типа редактора,
drag/resize/wrap/free/delete/undo/redo/multiple images, cloud autosave/reload,
другой browser context, clipboard и legacy recovery. Неожиданные pageerror и
console.error проверяются; намеренные HTTP отказы учитываются отдельно.

Реальный двухконтекстный RTP-тест был запущен и не получил ICE candidates.
Управляемый Chromium имеет `WebRtcIPHandling=disable_non_proxied_udp`, запреты
AudioCapture/VideoCapture; TURN не настроен. Этот тест оставлен с явным skip для
данной политики, без обхода ограничений. Unit/signaling-тесты не выданы за реальный
звонок, а fixture accounts — за два настоящих Supabase аккаунта.

## Что ещё требуется

1. Задать настоящие `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` в
   настройках среды и Vercel. Не использовать service-role ключ во frontend.
2. Предоставить авторизованное подключение оператора к выбранному Supabase через
   безопасную конфигурацию. Сверить историческую схему/миграции, запустить Security
   Advisor и SQL inventory, затем проверить реальные RLS/storage/profile операции.
3. Для NAT/relay: опциональные `VITE_TURN_URL`, `VITE_TURN_USERNAME`,
   `VITE_TURN_CREDENTIAL`; debug — `VITE_RTC_DEBUG=true`. TURN credentials доступны
   браузеру: нужны короткоживущие реальные значения, не proxy placeholders.
4. Проверить audio/video в обе стороны, слышимость, camera/mute/switch/reject/
   hangup/repeated calls между двумя аккаунтами в разрешённых браузерах и сетях.
5. Выполнить живые fresh-device проверки Auth, публикаций, upload и media restore;
   пройти Safari/iOS/Android на реальных устройствах.

## Известные ограничения

- Production Advisor, schema parity и перечисленные live acceptance не выполнены.
- Work image buckets публичны: приватность текста черновика не означает приватность
  его URL медиа. Закрытый Storage требует отдельного проверенного backend контракта.
- Work/version/taxonomy сохраняются несколькими запросами; очередь устраняет
  конкурирующие autosave, но не превращает этот backend contract в одну транзакцию.
- При обнаружении legacy binary source исходный snapshot не перезаписывается до
  восстановления всех изображений. До этого новые правки остаются в памяти;
  интерфейс сообщает о приостановке сохранения.
- Communities mutations, author replies и group media calls отключены явно.
  Messenger attachments отсутствуют; post/editor uploads не являются этим сценарием.
- Часть legacy rich-text команд использует document.execCommand; браузерная
  матрица не равна проверке всех движков. Monolithic orchestration app.js сохранён.
- Обычный GitHub API первоначально блокировался CONNECT403. Через поддерживаемое
  разрешение команды GitHub CLI ветка успешно отправлена и PR #1 создан; это больше
  не блокер. Добавление api.github.com сохранено для обычного сетевого workflow.

## Воспроизведение и deployment

Из `/workspace/Fraktum-Literaty`, после ввода настоящих Supabase координат:

```bash
npm ci --include=dev --cache /tmp/fraktum-npm-cache --no-fund --no-audit
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

Для уже установленного Supabase CLI и операторского доступа, после сверки
`supabase/baseline/README.md`:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --linked
supabase db push --linked --dry-run
```

Только после проверки dry-run и истории:

```bash
supabase db push --linked
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/security_audit.sql
```

Это команды для авторизованного оператора, не заявление об их выполнении здесь.
Нельзя делать production `db reset` или слепой migration repair. Advisor запускается
в Dashboard выбранного проекта. Затем после настройки переменных проекта Vercel:

```bash
npx vercel link
npx vercel deploy --prod
```

Vercel использует `vercel.json`: build `npm run build`, output `dist`, SPA rewrite
для permalink. Эти deploy-команды здесь не выполнялись.

В черновике конфигурации среды сохранены `install_script`, `start_skill`, требования
к двум Supabase переменным и добавление `api.github.com` к существующим presets.
Сохранение черновика не запускает скрипты и не публикует среду. Для применения
нужно проверить и сохранить настройки, затем опубликовать среду; готовность нового
snapshot пока не проверена. Не публикуйте fixture build как production приложение.

## Изменённые файлы

```text
.env.example
.gitignore
ARCHITECTURE.md
REALTIME_AND_CALLS.md
TESTING.md
docs/FUNCTIONALITY_AUDIT.md
docs/PROFILE_SECURITY_AUDIT.md
docs/STABILIZATION_REPORT.md
index.html
package-lock.json
package.json
public/icons/apple-touch-icon.png
public/icons/favicon-32.png
public/icons/icon-192.png
public/icons/icon-512.png
public/manifest.webmanifest
scripts/runtime-config.mjs
server.mjs
src/CallSession.js
src/app.js
src/call-experience.js
src/cloud.js
src/editor/EditorRoot.js
src/editor/ImageStatus.js
src/editor/LegacyMediaRecovery.js
src/editor/MediaModel.js
src/editor/SaveQueue.js
src/editor/Serialization.js
src/editor/types.ts
src/feedback/OperationFeedback.js
src/navigation/Navigation.js
src/navigation/SharePost.js
src/pages.js
src/profile/ProfileEditor.js
src/profile/ProfileMediaService.js
src/profile/ProfileService.js
src/profile/ProfileView.js
src/state.js
src/style.css
src/ui.js
src/webrtc-config.js
supabase/baseline/MIGRATION_MANIFEST.md
supabase/migrations/202610260001_profile_media_permissions.sql
supabase/migrations/202610260002_verification_rpc_guard.sql
supabase/security_audit.sql
tests/e2e/browser-harness.js
tests/e2e/browser.test.js
tests/e2e/calls-browser.test.js
tests/e2e/editor-browser.test.js
tests/e2e/navigation-regressions.test.js
tests/e2e/profile-feed-browser.test.js
tests/e2e/review-browser.test.js
tests/e2e/smoke.test.js
tests/integration/auth-session.test.js
tests/integration/calls.test.js
tests/integration/post-permalink.test.js
tests/integration/profile-media.test.js
tests/integration/profile-security-sql.test.js
tests/unit/call-audio.test.js
tests/unit/calls.test.js
tests/unit/editor-media.test.js
tests/unit/future-controls.test.js
tests/unit/manifest.test.js
tests/unit/navigation-share.test.js
tests/unit/operation-feedback.test.js
tests/unit/profile-view.test.js
tests/unit/profile.test.js
tests/unit/ui.test.js
```
