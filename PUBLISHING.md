# Как опубликовать apiauto-mcp

Пакет `apiauto-mcp` живёт в репозитории `https://github.com/apiauto-space/apiauto-mcp`. Порядок такой: GitHub, потом npm, потом официальный реестр MCP (он проверяет уже опубликованный пакет). Первая версия npm уходит вручную, следующие — из GitHub Actions через trusted publishing, без токенов.

## 0. Что нужно заранее

- Аккаунт npmjs.com с 2FA. Имя `apiauto-mcp` на 2026-11-02 свободно; перед публикацией проверьте: `npm view apiauto-mcp`.
- Права создавать репозитории в организации `apiauto-space` на GitHub.
- Node 20.19+, npm 10+.

## 1. Репозиторий

1. Создайте публичный пустой репозиторий `apiauto-space/apiauto-mcp`. Публичный обязательно: npm не делает provenance для приватных.
2. Скопируйте папку отдельно, чтобы не делать вложенный git внутри `apiauto_saas`, без `node_modules` и `dist`:

   ```bash
   cp -r /c/web3/apiauto_saas/outreach/github/apiauto-mcp /c/web3/apiauto-mcp
   cd /c/web3/apiauto-mcp
   rm -rf node_modules dist
   git init -b main
   git add .
   git commit -m "apiauto-mcp 0.1.0"
   git remote add origin https://github.com/apiauto-space/apiauto-mcp.git
   git push -u origin main
   ```

3. Вкладка Actions: **CI** должен пройти на Linux и Windows, Node 20, 22, 24, плюс сборка Docker без ключа. Этого локально не проверить.
4. Заполните «About» по [GITHUB_ABOUT.md](GITHUB_ABOUT.md).
5. **Защита публикации, до первого тега.** Settings репозитория:
   - **Environments:** создайте `npm` и `mcp-registry`. В обоих включите **Required reviewers** (вы сами) и ограничьте **Deployment branches and tags** веткой `main` и тегами `v*`.
   - **Rules → Rulesets → New tag ruleset:** цель `v*`, правила Restrict creations, Restrict updates, Restrict deletions; в обход только администраторы. Тогда тег не поставит тот, кто может писать в репозиторий, но не владеет им.
   - **Branch ruleset на `main`:** запрет force push и удаления.

Workflow `publish.yml` держит OIDC-токен только в отдельном job `publish`. Этот job не запускает код репозитория: он скачивает tarball, собранный job `build`, сверяет его SHA-256 и публикует с `--ignore-scripts`.

`PUBLISHING.md`, `GITHUB_ABOUT.md`, `REGISTRY_LISTINGS.md`, `server.json`, `glama.json`, `Dockerfile`, `test/` и `scripts/` в npm не попадают: проверяйте списком `npm pack --dry-run`.

## 2. Первая публикация в npm, вручную

В `CHANGELOG.md` замените `Unreleased` на дату. Затем из чистой сборки:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm audit --omit=dev
npm pack --dry-run        # только dist/*.js, README, LICENSE, CHANGELOG, SECURITY, package.json, npm-shrinkwrap.json
npm login
npm publish --access public --provenance=false
```

Сразу после первой публикации проверьте, что реестр отметил файл версий и установка ему следует. Первая команда должна вывести `true`, вторая показать вложенный `node_modules/apiauto-mcp/node_modules/express-rate-limit` той версии, что в `npm-shrinkwrap.json`. Если нет, защита от новых версий зависимостей не работает, и строку об этом в `SECURITY.md` и `README.md` надо исправить:

```bash
npm view apiauto-mcp _hasShrinkwrap
mkdir /tmp/mcp-check && cd /tmp/mcp-check && npm init -y >/dev/null && npm install apiauto-mcp@0.1.0 --ignore-scripts && npm ls express-rate-limit
```

`--provenance=false` нужен только здесь: provenance подписывается только в CI. У 0.1.0 значка provenance не будет, у следующих версий появится.

Проверка после публикации, в чистой папке:

```bash
npx -y @modelcontextprotocol/inspector --cli npx -y apiauto-mcp@0.1.0 --method tools/list
```

## 3. Trusted publisher на npmjs.com

Новая настройка должна сделать первую публикацию за 2 дня, иначе истекает. Поэтому делайте этот шаг, когда готовы сразу выпустить следующую версию.

npmjs.com → Packages → `apiauto-mcp` → Settings → Trusted Publisher → GitHub Actions:

- Organization or user: `apiauto-space`
- Repository: `apiauto-mcp`
- Workflow filename: `publish.yml`
- Environment name: `npm`
- Allowed actions: отметьте **npm publish**

Когда первая публикация из Actions прошла: Settings пакета → Publishing access → **Require two-factor authentication and disallow tokens**. После этого украденный токен npm не сможет выпустить версию.

## 4. Официальный реестр MCP

Реестр хранит только метаданные и проверяет, что `mcpName` в опубликованном `package.json` совпадает с `name` в `server.json`. Поэтому сначала шаг 2. Реестр пока в preview.

**Обычный `mcp-publisher login github` здесь не подойдёт:** по [документации реестра](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx) (2026-11-02, issue #1468) он даёт только личное пространство, а не `io.github.apiauto-space/`. Рабочий путь — OIDC из GitHub Actions, он уже настроен в `.github/workflows/publish-registry.yml`.

1. Когда 0.1.0 появилась в npm: GitHub → Actions → **Publish to the MCP Registry** → Run workflow, ветка `main`. Подтвердите запуск в окружении `mcp-registry`. С других веток workflow не выполнится.
2. Проверка: `https://registry.modelcontextprotocol.io/v0/servers?search=io.github.apiauto-space/apiauto-mcp`

Запасной путь, если OIDC не сработает: классический PAT со scope `read:org`, без доступа к репозиториям, от аккаунта с ролью **Owner** организации. Обычного участника реестр не пустит.

```bash
mcp-publisher login github --token ВАШ_ТОКЕН
mcp-publisher validate
mcp-publisher publish
```

Версия в реестре неизменяема: новую версию пакета публикуйте и там, с новой `version` в `server.json`. Версия `mcp-publisher` закреплена в workflow и проверяется подписью Sigstore; обновляйте её осознанно.

## 5. Следующие версии

```bash
npm version patch         # обновит package.json, src/version.ts, server.json, README и REGISTRY_LISTINGS, поставит тег
git push --follow-tags    # Actions соберут, вы подтвердите окружения npm и mcp-registry
```

Тег должен лежать на `main`, иначе сборка остановится. Перед выпуском добавьте запись в `CHANGELOG.md` и прогоните `npm run build && npm run check:openapi && npm run check:server-json`.

Строку `Last verified` в README меняйте только после настоящего прогона `npm run test:live`.

## 6. Другие каталоги

Порядок, точные тексты и шаги: [REGISTRY_LISTINGS.md](REGISTRY_LISTINGS.md).
