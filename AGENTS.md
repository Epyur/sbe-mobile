# AGENTS.md — sbe-mobile (ЦУП Мобайл)

Мобильный центр управления плагинами СБЕ для Obsidian mobile (Android, в основном
планшеты испытателей). Хаб: вход (auth), новости, лаунчер + мини-магазин сервисов.
Публикует логический сервис `sbe-apstore` — будущие мобильные плагины
(контакты/документы/ЛИМС) берут авторизацию существующим кодом
`getService('sbe-apstore').auth.getToken(...)`.

**Расположение (правило 2026-08-26)**: исходники + git-репо живут в
`C:\Obsidian\mailers\mobile\sbe-mobile\` (папка `mobile/` в корне вольта — дом
всех мобильных плагинов; каждый — отдельный репозиторий). Собранные
`manifest.json`/`main.js`/`styles.css` копируются в `.obsidian/plugins/sbe-mobile/`
(live-установка Obsidian, без git и без исходников). Путь к sbe-core — относительный
`../../../.obsidian/plugins/sbe-core/src/...` (из-за глубины `mobile/`).

## Структура

- `src/main.ts` — `SbeMobilePlugin`: настройки, auth/manager, регистрация вьюхи и команды,
  публикация моста `sbe-apstore`, mandatory-новости при старте, announceUpdate на версию.
- `src/ui/mobile-view.ts` — `MobileView` (ItemView): нижняя навигация Сервисы/Новости/Аккаунт,
  мобильная установка плагинов (перезапуск Obsidian через `app:reload`), самообновление хаба.
- `src/ui/news-modal.ts` — модалка обязательного сообщения.
- `src/ui/settings-tab.ts` — `apiUrl`, `registryUrl` (email — во вкладке «Аккаунт» вьюхи).
- `src/styles.css` — мобильные классы `tn-*` поверх дизайн-системы sbe-core.
- `manifest.json` — author: Полищук Евгений (polishchuk@tn.ru).

## Ключевые решения

- **Логический id `sbe-apstore`**: на устройстве роль «ЦУП» занимает либо десктопный
  плагин, либо этот хаб. Публикуем мост только если `getServiceSync('sbe-apstore')` пуст —
  при совместной установке десктопный ЦУП всегда выигрывает.
- **Общий клиент из sbe-core** (рефактор 2026-08-26): `AuthService` (`auth-client.ts`) и
  `StoreManager` (`store-manager.ts`) перенесены в sbe-core — их используют и десктопный
  ЦУП (sbe-apstore 0.3.9), и этот плагин.
- **Установка на мобиле**: Obsidian mobile сканирует папку плагинов при старте, поэтому
  после записи файлов свежеустановленного плагина предлагаем «Перезапустить Obsidian»
  (команда `app:reload`); для уже загруженного плагина работает disable/enable. Если
  `installPlugin` упал, но версия локального манифеста совпала с реестром — считаем успехом
  и предлагаем перезапуск.
- **Самообновление хаба**: `installPlugin(skipReload: true)` — без disable/enable самого
  себя, всегда перезапуск (опция `skipReload` добавлена в sbe-core `installer.ts`).
- Сборка: `npm run build` (esbuild + `build.onEnd` для склейки tokens/components sbe-core +
  собственных стилей). `npx tsc --noEmit` EXIT=0.

## История работ

### 2026-08-26 — v0.1.0 (создание)
- Плагин создан по дизайну `docs/superpowers/specs/2026-08-26-sbe-mobile-design.md`.
- Согласовано с пользователем: отдельный плагин-хаб; Android-планшеты; v1 =
  вход+новости+лаунчер+мини-магазин; мост под логическим id `sbe-apstore`.
- Рефактор в sbe-core: `AuthService` → `sbe-core/src/auth-client.ts`,
  `StoreManager` → `sbe-core/src/store-manager.ts` (общие для десктопного ЦУП и хаба).
  sbe-apstore пересобран, версия 0.3.8 → **0.3.9**.
- `installer.ts`: добавлена опция `skipReload` (самообновление установщика).
- Реестр: запись `sbe-mobile` + SHA-256 хеши в `registry.json`; `community-plugins.json`
  дополнен. Репозиторий `Epyur/sbe-mobile` (public), init-коммит, пуш на main.
- **Перенос в `mobile/`**: по решению пользователя исходники+репо переехали в
  `C:\Obsidian\mailers\mobile\sbe-mobile\` (пути к sbe-core обновлены), собранные
  артефакты копируются в `.obsidian/plugins/sbe-mobile/` (live).
- `npx tsc --noEmit` EXIT=0; `npm run build` OK.
- ⚠️ E2E на Android-планшете (механика установки/самообновления) — за пользователем.

## Статистика ошибок и отступлений

- Нарушений правил нет: 0 `any`, 0 `fetch`, 0 bare `setTimeout`, 0 инлайн-стилей,
  все `catch(e: unknown)` + `errorMessage()`. Исключения: `(app as unknown as {...})`
  для `app:reload` (недокументированное API Obsidian) — задокументировано в коде.
- Сборка и типы — без ошибок и предупреждений.

## Правила

- `catch(e: unknown)` + `errorMessage()` (sbe-core); `requestUrl()`; `window.setTimeout()`;
  без `any`; CSS-классы `tn-*`; UI на русском; автор — Полищук Евгений (polishchuk@tn.ru).
