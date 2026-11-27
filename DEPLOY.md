# Публикация на GitHub Pages

Сайт статический: GitHub Pages раздаёт папку `public`, данные и вход идут в Supabase. Сервер не нужен.

## Важно перед загрузкой

Репозиторий должен содержать **содержимое папки `futures-journal` в корне**, а не саму папку:

```
.github/workflows/pages.yml
public/
supabase/
README.md
server.js
...
```

Не загружайте `data/` — это локальная SQLite-база. В `.gitignore` она уже исключена, но при загрузке через браузер проверьте вручную. Папку `_shots` тоже не нужно.

`public/js/config.js` уже содержит URL и publishable-ключ Supabase. Это не секрет: доступ к данным закрывают RLS-политики. Ключ `service_role` в репозиторий не добавляйте.

## Вариант 1 — GitHub Desktop (проще всего)

1. Установите [GitHub Desktop](https://desktop.github.com/) и войдите в GitHub.
2. **File → Add local repository** → выберите папку `...\futures-journal`.
3. GitHub Desktop скажет, что это не репозиторий → **create a repository**.
   - Name: `futures-journal`
   - Branch: `main`
   - Create.
4. Слева появится список файлов. Убедитесь, что нет `data/`, введите summary «MOEX futures journal» → **Commit to main**.
5. Кнопка **Publish repository** → снимите галочку **Keep this code private** (Pages для публичных репозиториев бесплатен).
6. Откройте репозиторий на github.com → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
7. Вкладка **Actions** → workflow **Deploy to GitHub Pages** должен запуститься сам. Если нет — **Run workflow**.
8. Дождитесь зелёной галочки и откройте URL вида `https://<username>.github.io/futures-journal/`.

## Вариант 2 — Git в терминале

Установите [Git for Windows](https://git-scm.com/download/win), создайте на GitHub пустой репозиторий **без README и .gitignore**, затем:

```bash
cd путь\к\futures-journal
git init
git add .
git commit -m "MOEX futures journal"
git branch -M main
git remote add origin https://github.com/USERNAME/futures-journal.git
git push -u origin main
```

Дальше включите Pages: **Settings → Pages → Source: GitHub Actions**. Workflow `.github/workflows/pages.yml` опубликует `public`.

Если ветка называется `master`, либо переименуйте её в `main`, либо поправьте `branches` в workflow.

## Вариант 3 — загрузка через браузер

1. Создайте репозиторий на github.com.
2. **Add file → Upload files**.
3. Перетащите **содержимое** `futures-journal` (не саму папку): `public`, `supabase`, `server.js`, `README.md`, `package.json` и т. д.
4. Папка `.github` может не отобразиться в проводнике. Если workflow не загрузился, создайте файл вручную: **Add file → Create new file**, имя `.github/workflows/pages.yml`, и вставьте содержимое из репозитория.
5. Commit changes.
6. **Settings → Pages → Source: GitHub Actions**.

При загрузке через браузер `.gitignore` не действует: не переносите `data/journal.db`.

## Настройки Supabase после публикации

1. **Authentication → Providers → Email** → включите **Email provider**.
2. Для быстрого старта выключите **Confirm email**. Если оставляете подтверждение, настройте SMTP.
3. **Authentication → URL Configuration**:
   - **Site URL**: `https://<username>.github.io/futures-journal/`
   - **Redirect URLs**: тот же адрес, при необходимости `https://<username>.github.io/futures-journal/**`.
4. Откройте сайт, зарегистрируйтесь. Если на экране входа красное предупреждение «Email-вход отключён» — провайдер ещё выключен; включите и обновите страницу.

## Проверка

- Actions завершился успешно, сайт открывается по `https://<username>.github.io/<repo>/`.
- Регистрация создаёт пользователя, после входа появляется счёт и 17 инструментов MOEX.
- В **Настройки → Данные** можно загрузить демо или очистить журнал.
- CSR/SPA-роутинг работает через `#/dashboard`; прямые пути не нужны.

## Если что-то не работает

| Симптом | Причина |
|---|---|
| 404 на сайте | Pages не включён или workflow не завершён |
| Белый экран, в консоли 404 `/js/app.js` | папка `public` загружена как вложенная; в корне репозитория должна быть `public/index.html` |
| «Email-вход отключён» | Authentication → Providers → Email выключен |
| Письмо подтверждения ведёт на localhost | не задан Site URL в Supabase |
| `permission denied for table ...` после входа | не выполнен `supabase/schema.sql` или нет grant для `authenticated` |
| `data/` в репозитории | загружен локальный SQLite; удалите из репозитория, он не нужен |

## Обновление сайта

После изменений в `public/` сделайте commit и push в `main` (GitHub Desktop: Commit → Push). Workflow пересоберёт Pages. Supabase и данные пользователей не затрагиваются.
