# specification.md — sbe-mobile (ЦУП Мобайл)

## 1. Идентификация

- `manifest.id`: `sbe-mobile`
- Имя: ЦУП Мобайл
- Автор: Полищук Евгений (polishchuk@tn.ru)
- Зависимости: **runtime** — нет (потребляет сервер auth-service и мост `window.SBE`);
  **build** — `sbe-core`.

## 2. Роль и мост

Мобильный центр управления плагинами СБЕ для Obsidian mobile (Android, в основном
планшеты испытателей). На устройстве «ЦУП» — логическая роль: её занимает либо
десктопный плагин `sbe-apstore`, либо этот хаб.

Публикует мост под **логическим id `sbe-apstore`** (тип `SbeApstoreApi`). Правило
публикации: только если `getServiceSync('sbe-apstore')` ещё пуст — если на устройстве
есть десктопный ЦУП, он всегда выигрывает (конфликтов нет).

| Метод | Сигнатура | Описание |
|---|---|---|
| `getRegistry` | `() => Promise<RegistryPluginEntry[]>` | Реестр (сетевой) |
| `getPluginState` | `(id: string) => PluginState` | Состояние по версиям |
| `install` / `update` | `(id: string) => Promise<void>` | Установить / обновить |
| `updateAll` | `() => Promise<UpdateSummary>` | Обновить все доступные |
| `checkUpdates` | `() => Promise<UpdateSummary>` | Проверка без применения |
| `listInstalled` | `() => InstalledPlugin[]` | Установленные плагины |
| `auth` | `SbeAuthApi` | Полный серверный auth-клиент (см. sbe-apstore/specification.md §3) |
| `announceUpdate` | `(input: AnnounceUpdateInput) => Promise<void>` | Публикация в «Новости» |

`auth.getToken(appId)` — **белый список выдачи токенов**: только
`mailer`/`documents`/`lab`/`ekn`/`contacts`/`agent` (ревью B4c), произвольные
`app_id` отклоняются ошибкой.

## 3. Функциональность v1

- **Вход** (секция «Аккаунт» вьюхи): email → «Получить ключ» (письмо на @tn.ru) →
  «Активировать ключ»; статус; список устройств с «Отозвать»; «Выйти» = отзыв своего
  устройства (снимает ключ). Секрет `sbe-auth-key` в secretStorage; `deviceId` — UUID v4
  в `data.json`.
- **Новости** (секция «Новости»): `auth.listNews()` → карточки, «Отметить прочитанным»
  (`ackNews`), подсветка обязательных. При старте — модалка первого непрочитанного
  `mandatory` (тихая, только для авторизованных).
- **Сервисы** (лаунчер + мини-магазин): плагины реестра с `hasView`; карточки
  «Открыть» / «Установить» / «Обновить: vX → vY»; «Проверить обновления».
  Открытие — `getService(id)` + `isOpenable()` → `open()`.
- **Установка на мобиле**: общий `installPlugin` (download → SHA-256 по хешам реестра →
  запись адаптером). После установки, если `isPluginEnabled(id)` — плагин был загружен,
  disable/enable перезагрузил его; если не загружен (свежая установка) — модалка
  **«Перезапустите Obsidian»** (команда `app:reload`). Если `installPlugin` упал, но
  локальный манифест по версии совпал с реестром — считаем установку успешной с
  перезапуском.
- **Самообновление хаба** (`sbe-mobile`): `installPlugin` с `skipReload: true` (без
  disable/enable самого себя) + всегда перезапуск.

## 4. UI

- `ItemView`, тип `sbe-mobile-view`, имя «ЦУП Мобайл», иконка `brain`.
- Нижняя навигация: **Сервисы / Новости / Аккаунт** (на ширине ≥900px — сегментом сверху).
- Карточки вместо таблиц, тач-цели ≥44px (`.tn-btn-lg`, `.tn-input`), стили `tn-*` поверх
  дизайн-системы sbe-core (`src/styles.css`, склейка через `build.onEnd`).
- Доступ: команда «Открыть ЦУП Мобайл» (пользователь добавляет в мобильный тулбар);
  ribbon — для десктопной проверки.
- Настройки: `apiUrl` и `registryUrl`. Email — только во вкладке «Аккаунт».

## 5. Данные (`data.json`)

```ts
{
  "registryUrl": "https://epyur.fvds.ru/registry.json",
  "lastCheckAt": 0,
  "apiUrl": "https://epyur.fvds.ru",
  "email": "user@tn.ru",
  "deviceId": "uuid-v4 (генерируется один раз)",
  "lastAnnouncedVersion": "0.1.0"
}
```

## 6. Ошибки

- Сеть/реестр недоступен → Notice с причиной; при автопроверке на старте (`silent`) —
  только `console.warn`.
- Установка: при неудаче загрузки файлов — прервать, не перезаписывать остальные
  (гарантирует `installPlugin`).
- Активация/отзыв/новости — понятные Notice через `errorMessage()`.

## 7. Сборка и проверка

- `npm install` → `npm run build` (esbuild + `build.onEnd`: tokens/components sbe-core +
  собственные стили) → `npx tsc --noEmit` EXIT=0.
- Релизные файлы: `main.js`, `styles.css`, `manifest.json`.
- E2E на десктопе (вход, новости, установка/обновление плагина). Механика установки
  именно на Android-планшете — проверяется пользователем (главный технический риск).
