# Mandarin · оперативная база

Сайт ищет материалы CASSIE, руководства и справочников отдела. Backend регистрации находится в `server/`: Node.js + PostgreSQL, Google OAuth и проверка Steam OpenID 2.0. Исходный Railway-сервис сайта не меняется.

## Локальная разработка

Запустить сайт:

```bash
python3 -m http.server 8000
```

Запустить backend с собственной PostgreSQL:

```bash
cd server
npm ci
npm test
```

Скопируйте `server/.env.example` в `server/.env`, укажите реальную базу и OAuth-секреты, затем выполните `npm start`. Файл `.env` исключён из Git.

## Настройка Bot-Hosting

1. Создайте отдельный Node.js-сервис на Bot-Hosting из папки `server/`. Установите Node.js 22+, команду запуска `npm start` и рабочую папку `server`. При автоматической сборке `npm install` выполняется в этой рабочей папке.
2. Подключите PostgreSQL. Установите адрес базы в переменную `DATABASE_URL`; у managed-базы используйте её TLS-настройку, обычно `DATABASE_SSL=true`. Сервер создаёт таблицы пользователей и сессий при запуске.
3. Сначала узнайте публичный HTTPS-адрес **нового Bot-Hosting сервиса**. Добавьте его в настройки OAuth Google Cloud Console как разрешённый URI возврата: `https://ВАШ-DOMEN/auth/google/callback`. Оставьте существующие Railway URL возврата без изменений, если продолжаете использовать прежний вход.
4. В переменные Bot-Hosting добавьте:

   - `PUBLIC_URL` — HTTPS-адрес нового сервиса Bot-Hosting без завершающего `/`.
   - `FRONTEND_URL` — `https://den09hop87-hub.github.io/site6/`.
   - `FRONTEND_ORIGINS` — `https://den09hop87-hub.github.io`, без завершающего `/`.
   - `GOOGLE_CLIENT_ID` — уже настроенный Client ID из OAuth-ссылки.
   - `GOOGLE_CLIENT_SECRET` — секрет Google Web Client. Добавьте его только в разделе секретных переменных Bot-Hosting; в этот workspace и GitHub его не отправляйте.
   - `DATABASE_URL` — private/internal URL созданной PostgreSQL.
   - `SESSION_SECRET` — случайная строка не короче 32 символов. Сгенерируйте её в терминале командой `openssl rand -base64 48` и вставьте результат прямо в секретные настройки Bot-Hosting.
   - `DATABASE_SSL=true` — если managed PostgreSQL требует TLS; `NODE_ENV=production`.

5. Проверьте Google URI возврата в Google Cloud: **Credentials → OAuth 2.0 Client ID → Authorized redirect URIs** должен содержать в точности `https://ВАШ-DOMEN/auth/google/callback`. Никаких Google-секретов во frontend добавлять не нужно.
6. Steam использует OpenID 2.0: Steam автоматически принимает возвращаемый URL того домена, с которого начат вход. На сайте кнопка Google запускает `/auth/google`; после её проверки интерфейс включает Steam и открывает `/auth/steam`; Steam возвращается на `/auth/steam/callback`.
7. В `assets/site-config.js` укажите `authApiUrl`, равный `PUBLIC_URL`. Проверьте, что публичная страница Bot-Hosting отвечает `/health`, а `/auth/session` разрешает только origin `https://den09hop87-hub.github.io`, cookies с `credentials: include` и методы `GET`, `POST`, `OPTIONS`.
8. Закоммитьте адрес сервиса в `assets/site-config.js` и опубликуйте frontend в GitHub Pages. Не коммитьте `.env`, Google Client Secret, пароль базы или ключ сессии.

При первой успешной проверке Google и Steam сервер создаёт профиль. При следующих входах он требует ту же пару: существующий Steam нельзя незаметно привязать к другому Google. На вход только через Steam сервер не пускает. Используются HTTPS-cookie, хранение сессий в PostgreSQL, короткие PKCE/state, ограничение попыток и CSRF-проверка выхода.

## Ссылки авторизации

Для публичного HTTPS-адреса backend:

- `https://ВАШ-DOMEN/auth/google` — начать вход Google.
- `https://ВАШ-DOMEN/auth/steam` — начать Steam **после Google в том же браузере**.
- `https://ВАШ-DOMEN/auth/session` — прочитать авторизованную сессию сайта.
- `https://ВАШ-DOMEN/health` — проверить доступность сервера и PostgreSQL.

На GitHub Pages сохранён тестовый публичный Client ID. В OAuth Google Console необходимо дополнительно внести реальный адрес возврата Bot-Hosting и проверить публикацию приложения. Передавайте только callback URL. Никогда не отправляйте и не публикуйте Google Client Secret.

## Каталог

Архив распакован в `reference-source/` и исключён из Git. В каталоге используются настоящие данные: 28 документов, 56 записей нарушителей и 27 записей ветеранов. Архив не содержит 195 объявлений из примера CASSIE, поэтому сайт не заменяет их выдуманными фразами.

## GitHub Pages

При включённом GitHub Actions публикация запускается workflow `.github/workflows/pages.yml`. Адрес сайта: https://den09hop87-hub.github.io/site6/.