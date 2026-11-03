# Заявки в каталоги MCP: точные тексты и шаги

Условия проверены на живых страницах 2026-11-02, без регистрации. Порядок из `outreach/geo-research-2026-11.md`, раздел 3. Всё ниже делает владелец и только после публикации пакета в npm и репозитория на GitHub.

| Порядок | Каталог | Что делать | Стоимость |
|---|---|---|---|
| 1 | Официальный MCP Registry | Workflow `publish-registry.yml` | бесплатно |
| 2 | Glama | «Add Server», вход через GitHub | бесплатно |
| 3 | awesome-mcp-servers | Pull request с одной строкой | бесплатно |
| 4 | mcpservers.org | Бесплатная форма, проверка до 2 недель | бесплатно; $39 не платим |
| 5 | MCP Market | Бесплатная очередь, 4–6 недель | бесплатно; $29 не платим |
| — | LobeHub | Ждём: заявку не нашёл | — |
| — | PulseMCP | Приём закрыт, заберёт из официального реестра | — |
| — | Smithery | Заявки нет, сервис сокращён | — |
| — | mcp.so | Только платно, не платим | $39 |

Расхождение с исследованием: mcpservers.org и MCP Market не только «подхватывают сами», у них есть бесплатные формы. EnCarAPI там появился без явной заявки, поэтому формы необязательны, но ускоряют.

## Тексты

**Название:** `apiauto-mcp`

**Заголовок:** `apiauto.space: Encar, Che168, Copart, IAAI`

**Короткое описание, до 100 символов** (совпадает с `server.json`):

```
Official apiauto.space team MCP server, read-only. Used cars: Encar, Che168, Copart, IAAI
```

**Описание для форм:**

```
Official read-only MCP server from the apiauto.space team. Used-car listings from Encar (South Korea), Che168 (China), and Copart and IAAI auctions (USA) through the apiauto.space API. Search cars, read one car by id, watch new cars and price changes, list makes and models, check data age and quota. Runs locally over stdio. Results mark listing text as untrusted data. Needs an API key: a free demo gives 1 day, 100 requests, up to 20 cars per request and all 3 markets; paid plans start at $59 a month. Not affiliated with Encar, Che168 (Autohome), Copart or IAAI.
```

**Репозиторий:** `https://github.com/apiauto-space/apiauto-mcp`

**Сайт:** `https://apiauto.space/en/docs/`

**Имя в официальном реестре:** `io.github.apiauto-space/apiauto-mcp`

**Запуск:** `npx -y apiauto-mcp@0.1.1`, переменная `APIAUTO_API_KEY`

## 1. Официальный MCP Registry

Шаги в [PUBLISHING.md](PUBLISHING.md), раздел 4. Коротко: когда версия появилась в npm, GitHub → Actions → **Publish to the MCP Registry** → Run workflow, ветка `main`.

Обычный `mcp-publisher login github` пространство организации не даёт (issue #1468 реестра). Реестр в preview: возможны сбросы данных.

## 2. Glama

Как проверяет, по [методологии](https://glama.ai/mcp/methodology):

- Заявку подаёт сопровождающий через GitHub OAuth, нужны права записи в репозиторий.
- Сервер собирается из `Dockerfile` в репозитории или из выведенного ИИ. Если сборка не удалась, сервер не попадает в поиск и списки.
- В песочнице Firecracker выполняются `tools/list`, `resources/list`, `prompts/list`. Для проверки работоспособности инструменты не вызываются.
- Поведение смотрят на уровне системных вызовов и сети: исходящие подключения к неуказанным хостам считаются риском.
- Описания инструментов оцениваются по TDQS и публикуются на странице сервера.

Почему у ChinaCarAPI статус «Unhealthy»: на Glama он [удалённый коннектор](https://glama.ai/mcp/connectors/io.github.ThatMojo/chinacarapi-mcp) с OAuth (`https://mcp.chinacarapi.com/mcp`), такие проверяются подключением к адресу, и для них сопровождающий должен задать тестовый профиль. Причина названа по этим признакам, журнал проверки я не видел. У нас другой путь: открытый сервер, сборка и `tools/list` в песочнице, ключ не нужен.

Подтвердить запуском:

```bash
npm run build
node scripts/check-keyless.mjs --docker
```

Скрипт собирает `Dockerfile` и запускает образ с `--network none` и без ключа. Сервер стартует и отвечает `tools/list` на 8 инструментов. CI делает то же при каждом push.

Шаги:

1. Убедитесь, что в корне репозитория лежат `Dockerfile` и `glama.json`. В `glama.json` сейчас указана организация `apiauto-space`. В [схеме Glama](https://glama.ai/mcp/schemas/server.json) поле `maintainers` описано как GitHub usernames, а про организации ничего не сказано; в [статье Glama о файле](https://glama.ai/blog/2025-07-08-what-is-glamajson) для сервера организации просят вписать туда свой логин GitHub и пройти Claim ownership. Организация войти не может, поэтому заявка с этим значением, скорее всего, не пройдёт; проверить это можно только на самой странице заявки. Появится ли сервер в каталоге без заявки, статья не говорит.
2. https://glama.ai/mcp/servers → **Add Server**, вход через GitHub, укажите репозиторий.
3. Дождитесь сборки. На странице появятся оценка и замечания по инструментам.

**Какой аккаунт станет виден.** Эти площадки работают с личным входом, а не с организацией:

- **Glama:** вход только через GitHub. Для Claim ownership логин вошедшего нужно вписать в публичный `glama.json`.
- **Packagist:** на странице пакета показан сопровождающий со ссылкой на его профиль. При входе через GitHub проверьте имя пользователя на Packagist до отправки пакета.
- **Формы каталогов, PR в awesome-mcp-servers:** автора запроса или формы видно в его профиле. Что покажет конкретная форма, смотрите перед отправкой.

Если логин показывать нельзя, заведите на этих площадках отдельное имя там, где правила это разрешают, или не подавайте заявку.

В поле с описанием, если спросят, вставьте текст «Описание для форм» выше. Настоящий ключ в поля и переменные каталога не вводите: для списка инструментов он не нужен.

## 3. awesome-mcp-servers

`https://github.com/punkpeye/awesome-mcp-servers`, правила в `CONTRIBUTING.md`: fork, ветка, одна строка в `README.md`, pull request. Открытых задач и PR тысячи, ждать можно долго.

**Раздел:** `🛒 E-Commerce`. Отдельного раздела про автомобили нет. **Место:** по алфавиту, как просит `CONTRIBUTING.md` (на практике порядок соблюдается не везде).

**Значки:** `📇` TypeScript; `☁️`, потому что по легенде cloud это сервер, который обращается к удалённым API; `🍎 🪟 🐧` все системы.

**Строка, если сервер уже есть на Glama:**

```markdown
- [apiauto-space/apiauto-mcp](https://github.com/apiauto-space/apiauto-mcp) [![apiauto-space/apiauto-mcp MCP server](https://glama.ai/mcp/servers/apiauto-space/apiauto-mcp/badges/score.svg)](https://glama.ai/mcp/servers/apiauto-space/apiauto-mcp) 📇 ☁️ 🍎 🪟 🐧 - Official read-only MCP server from the apiauto.space team: used-car listings from Encar (Korea), Che168 (China), Copart and IAAI (USA) through the apiauto.space API: search, one car by id, change feed, makes and models, quota. Needs an API key, with a free one-day demo.
```

**Без значка Glama:**

```markdown
- [apiauto-space/apiauto-mcp](https://github.com/apiauto-space/apiauto-mcp) 📇 ☁️ 🍎 🪟 🐧 - Official read-only MCP server from the apiauto.space team: used-car listings from Encar (Korea), Che168 (China), Copart and IAAI (USA) through the apiauto.space API: search, one car by id, change feed, makes and models, quota. Needs an API key, with a free one-day demo.
```

Адрес значка проверьте на странице Glama после шага 2: он может отличаться.

**Заголовок PR:** `Add apiauto-mcp`

**Описание PR:**

```
Adds apiauto-mcp, the official read-only MCP server from the apiauto.space team, for used-car listings from Encar, Che168, Copart and IAAI through the apiauto.space API. I maintain it and work on apiauto.space.

Runs locally over stdio with npx. It needs an API key, and there is a free one-day demo.
```

В `CONTRIBUTING.md` есть строка для автоматических агентов: «add 🤖🤖🤖 to the end of the PR title». Это текст страницы, а не решение за вас: PR от вашего имени подаёте вы, и значок нужен, только если его действительно создаёт агент.

## 4. mcpservers.org

https://mcpservers.org/submit: бесплатно, проверка до 2 недель. Вариант Premium за $39 с dofollow-ссылкой не берём: это покупка ссылки (раздел 7.5 исследования).

| Поле | Значение |
|---|---|
| Название сервера | `apiauto-mcp` |
| Категория | Другое (Other) |
| Краткое описание | «Описание для форм» выше |
| Репозиторий | `https://github.com/apiauto-space/apiauto-mcp` |
| Имя в официальном реестре | `io.github.apiauto-space/apiauto-mcp` |
| Удалённые подключения | не отмечать |
| Контактный email | ваш рабочий адрес |
| Вариант отправки | Бесплатно |

## 5. MCP Market

https://mcpmarket.com/submit: вкладка **MCP Server**, **GitHub repo**, адрес репозитория, вариант **Free Queue** (4–6 недель). Вариант за $29 с «Official» значком не берём: `Official` рядом с нашей карточкой о чужих марках запрещено разделом 7.5.

## Не подаём

- **LobeHub.** Страница `lobehub.com/mcp` отдаёт инструкцию для агентов с командой `npx @lobehub/market-cli register`. Я её не запускал. Формы заявки не нашёл. Конкурент EnCarAPI там появился без явной заявки, поэтому ждём.
- **PulseMCP.** https://www.pulsemcp.com/submit: «submissions and changes are temporarily paused», обновлено 3 сентября 2026. Советуют Official MCP Registry и обещают забрать оттуда.
- **Smithery.** С 31 октября 2026 закрыты аккаунты, CLI и API. Остался публичный каталог на Arcade с отобранными серверами, пути подачи нет. Проверить ещё раз через квартал.
- **mcp.so.** Только платная публикация за $39 с dofollow. Не платим.

## После публикации

Проверить через неделю, не появились ли карточки сами: `apiauto-mcp` на Glama, mcpservers.org, mcpmarket.com, LobeHub. Запрос `che168 mcp` в Brave и Perplexity показывает, сработало ли это: сейчас там конкурент.
