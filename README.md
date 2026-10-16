# dsh-custom-search

> A DeepSeek Harness plugin that replaces the built-in DeepSeek web search with a
> search engine you choose — SearXNG, Tavily, Exa, Brave, Serper, Bing, or Google
> CSE. The model-facing `web_search` tool keeps its name and schema, so prompts,
> agent presets, and tool lists are unchanged.

用你自己的搜索源替换 DSH 内置的「仅官方 DeepSeek」搜索。`web_search` 工具名与参数保持不变，
换的只是背后的检索通道——所以模型的提示词、工具表、Agent 预设都不用动。

> **第三方社区插件。** 本项目与 DeepSeek 官方无隶属关系，也不属于官方插件市场。
> 下文「官方搜索」「官方提供方」一律指 DSH 自带的 `@deepseek-ai/dsh-web-search-deepseek`。

---

## 它替换的到底是什么

DSH 把「联网搜索」拆成了三层，本插件只接管最底下那层：

| 层 | 包 | 职责 | 本插件是否改动 |
|---|---|---|---|
| 工具层 | `@deepseek-ai/dsh-tool-web` | 向模型暴露 `web_search` / `web_fetch` | 不改 |
| 服务层 | `@deepseek-ai/dsh-web`（`ctx.web`） | 选后端、取消、错误码、`maxResults` 截断 | 只改一个配置值 |
| 提供方层 | `@deepseek-ai/dsh-web-search-deepseek` | 真正发请求、返回结果 | **替换掉** |

服务层通过 `registerSearchProvider()` 收集提供方，并按**配置里 pin 的 id** 选一个执行。
官方提供方注册的 id 是 `deepseek-official`，本插件注册 `custom-search`——
所以「换搜索引擎」在 DSH 里就是改一个字符串，不需要替换任何官方文件。

这也意味着：官方搜索的**一个查询要花一整轮模型调用**（DeepSeek 没有独立的检索接口），
而接上 SearXNG / Tavily 这类真正的检索 API 后，搜索不再消耗会话模型的 token。

## 安装

**桌面端面板**（桌面端只有这一条路）

侧栏「插件」→「+ 添加插件」→ 填 `github:Anixuil/dsh-custom-search` → **安装** → **立即启用** → 重启 Harness。

<p align="center">
  <img src="docs/install-from-github.png" width="400" alt="在桌面端「+ 添加插件」里填入 github:Anixuil/dsh-custom-search，被识别为「Git 仓库」来源">
  <img src="docs/installed.png" width="400" alt="安装完成：pnpm add github:Anixuil/dsh-custom-search 成功，点「立即启用」">
</p>

左：面板把 `github:Anixuil/dsh-custom-search` 识别为「Git 仓库」来源，底层走 `pnpm add` 拉取。
右：安装完成，落点是 profile 目录 `~/.dsh/profiles/desktop`，点「立即启用」。

> 面板那一栏填的是**安装源**（npm 包名 / GitHub 源 / 本地路径），不是插件名。
> 直接填 `dsh-custom-search` 会提示「未找到相关插件」——这个名字在 npm 上还没发布。

装完**重启 Harness** 才生效（bundle 类插件不会热加载）。桌面端用「重启 Harness」或退出重开。

**改成从本地目录装**（自己改代码时用这个）

同一栏填本仓库的绝对路径，例如 `D:\code\self\all\dsh-custom-search`。
pnpm 把它记成 `link:` 而不是复制，所以此后改 `index.js` / `client.js`
**只要重启 Harness 就生效**，不必卸载重装。改了代码要反复看效果时用这个，稳定了再换回 `github:`。

**命令行安装**（需要单独装 CLI，桌面端不自带）

```bash
dsh plugin --profile desktop add github:Anixuil/dsh-custom-search#main
```

> DeepSeek Harness Desktop 的应用包没有声明 `bin`，也没有随附 `dsh` 可执行文件；
> `dsh plugin` 来自单独安装的 CLI。只有桌面端的话，用上面面板那一栏，效果相同。

> `desktop` 是桌面端的 profile 名（数据目录 `~/.dsh/profiles/desktop`）。
> 用 CLI 或其他 profile 时换成实际名称，例如
> `dsh plugin --profile web add github:Anixuil/dsh-custom-search#main`。

> 本插件没有构建步骤，`github:` 源可以直装。若 pnpm 仍拦下构建脚本，
> 在 `$DSH_HOME/profiles/desktop/pnpm-workspace.yaml` 的 `allowBuilds` 里放行 `dsh-custom-search`。

### 升级：必须卸载再装

插件管理器**不提供升级**——不列注册表版本，也没有更新按钮。而且 `pnpm-lock.yaml` 会把
git 源解析出的 commit **钉死**（`resolution: {commit, type: git}`），所以后台也不会自己挪。

面板里：**卸载**（要确认）→ 「+ 添加插件」填同一个 `github:` 地址 → 安装 → 立即启用 → 重启。

命令行同理：

```bash
dsh plugin --profile desktop remove dsh-custom-search
dsh plugin --profile desktop add github:Anixuil/dsh-custom-search#main
```

> `github:` 源拉的是默认分支的当前提交，所以重装即拿到最新代码。
> 要省掉反复重装，就按上面说的换成**本地目录**安装——之后只需重启。

> **从 ≤0.1.0 升上来的注意**：旧版的 patch 写法会让面板卸载永久失败（报
> `bundle-in-use`），卸载那一步走不通。照「卸载」一节末尾的手工步骤摘掉旧版，再装 0.2.0。

### 兼容性

provider 契约（`ctx.web.registerSearchProvider` 与返回结构）是照着
**`@deepseek-ai/dsh-*` 0.2.0-rc.2**（DeepSeek Harness Desktop 0.2.0-rc.2）的源码实现的，
并对该版本做过离线契约验证。

> DSH 仍在 developer preview：`apply(ctx)` 规范稳定，但 `ctx.web` 这类服务在预览版之间
> 仍可能调整。升级 Harness 后若搜索报 `WEB_PROVIDER_*` 错误，先对照
> `@deepseek-ai/dsh-web` 的 `registerSearchProvider` 签名和 `WebRuntime.Config` 字段。

## 配置

**在插件页改**（推荐）。侧栏「插件」，有两个入口，进去是同一张表单：

- **「官方」区块里的「自定义搜索引擎」卡片** —— 点开就是配置页，最直接。
- 或者点开 `dsh-custom-search` 组合包 → 组件行 `custom-search` 右侧的**配置**按钮。

表单里 12 个字段全在，引擎还能用一排胶囊一键切换。点**保存**即写入 profile 的 patch 层并由
Loader 应用，不用重启。

> **装完要重启一次 Harness**，卡片才会出现。浏览器半侧是前端启动时加载的模块：
> 安装是在前端启动之后才落地的，热重载不会把它补进来。

**API Key 不进设置文件**：它经凭证服务写入，引用名默认取该引擎约定的环境变量名
（Brave 是 `BRAVE_API_KEY`），落点是 `~/.dsh/.credentials.yaml` 的 `refs:` 段——和模型 provider 的
`VOLCENGINE_API_KEY` 并排。填一次就持久保存，profile patch 里只留引用名，**key 不会进版本库**。

### 没有界面时：直接改 profile 的 patch 层

`$DSH_HOME/profiles/desktop/cordis.patch.yml` 在所有 bundle 层之后应用，优先级高于插件自带的默认值：

```yaml
- id: custom-search
  name: dsh-custom-search
  config:
    engine: brave
```

- **只写要改的字段**。没写的字段回落到 `Config` schema 的默认值（每个字段都有默认值）。
- 手改后**重启 Harness**。
- 同一个 id 已存在于 profile patch 时改那一条，不要重复添加。

> **为什么配置页要插件自带？** DSH 的插件页只渲染**插件自己注册了配置页**的插件——
> 官方那四个配置页（shell 执行器、agent loop、子智能体、DeepSeek 搜索提供方）
> **各来自一个伴生包**，设置里的「插件」分区只是**只读**清单。
>
> 本插件把这一半放在 `client.js`，两个入口都注册（官方只用前者）：
>
> | 槽位 | 寻址字段 | 渲染成 |
> |---|---|---|
> | `plugins.item` | `id`（list 槽） | 插件页上一张能直接点开的卡片，带独立页面 |
> | `plugins.row.config` | `key` = `<包名>#<行 id>`（keyed 槽） | 行详情里的配置表单 |
>
> 两者都只在宿主**在服务** `custom-search` 这个设置命名空间时才挂载
> （`configForms.whileServed`），所以没装/没启用的部署上看不到任何痕迹。
> 没有它们，这一行就只有启停开关——这正是本插件 0.1.0 的状态。

### 字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `engine` | `searxng` | 主搜索引擎，可选 `searxng` / `tavily` / `exa` / `brave` / `serper` / `bing` / `google` |
| `fallback` | 空 | 逗号分隔的备用引擎，按顺序兜底（主引擎报错或返回空结果时启用） |
| `endpoint` | 空 | 主引擎的接口基址。留空则用该引擎的官方地址；自建 SearXNG 填 `http://127.0.0.1:8080` |
| `endpoints` | 空 | 按引擎分别指定基址的 JSON，例如 `{"tavily":"https://gw.internal/tavily"}`，优先级高于 `endpoint` |
| `apiKey` | 空 | API key 字面量。标记为 secret，不会回显、不进模型上下文 |
| `apiKeyEnv` | 空 | 凭证引用名。留空则用该引擎约定的环境变量（见下表） |
| `googleCx` | 空 | 仅 Google CSE 需要：Programmable Search 的搜索引擎 ID |
| `searchDepth` | `basic` | 仅 Tavily：`basic` / `advanced`（advanced 消耗更多额度） |
| `maxResults` | `8` | 单次搜索最多返回多少条来源，上限 20 |
| `timeoutMs` | `20000` | 单次搜索超时（毫秒） |
| `language` | `zh-CN` | 语言/地区提示，各引擎会映射成自己的参数 |
| `safeSearch` | `moderate` | `off` / `moderate` / `strict`，引擎不支持时忽略 |

### 各引擎怎么准备

| 引擎 | 是否要 key | 约定的环境变量 | 备注 |
|---|---|---|---|
| `searxng` | 否 | — | 自建或公共实例，**必须在实例的 `settings.yml` 里开启 `json` 输出格式**，否则接口返回 403 |
| `tavily` | 是 | `TAVILY_API_KEY` | 为 AI 检索设计，按次计费 |
| `exa` | 是 | `EXA_API_KEY` | 语义检索，可直接拿到正文片段 |
| `brave` | 是 | `BRAVE_API_KEY` | 独立索引，免费额度较宽裕 |
| `serper` | 是 | `SERPER_API_KEY` | Google 结果的低延迟代理 |
| `bing` | 是 | `BING_API_KEY` | Azure 认知服务 Web Search |
| `google` | 是 | `GOOGLE_API_KEY` | 还需填 `googleCx` |

**key 的解析顺序**：`apiKey` 字面量 → 凭证服务（设置页写入的） → 启动环境 → 进程环境变量。

> `apiKey` / `apiKeyEnv` 只作用于**当前选中的主引擎**。`fallback` 里的引擎是别的厂商，
> 各自从自己的环境变量或凭证服务取 key——例如 `engine: searxng` + `fallback: tavily`
> 只需要额外准备 `TAVILY_API_KEY`。

### 常见组合

**全本地、不花一分钱**（推荐先跑通这个）

```yaml
engine: searxng
endpoint: http://127.0.0.1:8080
```

**要更稳，主引擎挂了自动兜底**

```yaml
engine: searxng
endpoint: http://127.0.0.1:8080
fallback: tavily
```

## 安装后的实际改动

`cordis.patch.yml` 里有**两类**条目，区别很关键：

```yaml
- insert:                          # ① 新行：本组合包「拥有」的行
    - id: custom-search
      name: dsh-custom-search
      config: { ... }

# ② 覆盖行：改的是别的组合包已经声明的行（dsh-base 声明了它们）
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: custom-search
    fetchProvider: http            # 必须保留：patch 是整行替换，不是深合并

- id: web-search-deepseek
  name: '@deepseek-ai/dsh-web-search-deepseek'
  disabled: true
```

**为什么这两行不能放进 `insert:`。** `insert:` 的语义是「插入新行」——
loader 以**空**列表为基准套用所有层，所以 `insert:` 里的行会被直接追加进树。
而 `web` / `web-search-deepseek` 这两行由 `@deepseek-ai/dsh-base` 声明，id 已经被占用；
再 `insert:` 一次只会多出**同名副本**，不会覆盖原来那行。

更隐蔽的后果在卸载：插件管理器把「`insert:` 里的行」记为本组合包的组件
（`bundleRows`），只要其中任何一行还挂着，就拒绝卸载并报
`bundle-in-use`（「其他配置仍在使用这个组合包的组件，请先停用它们」）。
`web` 那行的**正本**属于 `dsh-base`，永远不会下线——于是本组合包会**永远卸不掉**。
写成顶层覆盖就没有这个问题：覆盖行不被算作本组合包的组件，卸载时随层一起失效。

两个容易踩的点：

1. **patch 是整行替换**。`web` 那一行必须把 `fetchProvider` 一起写回去，
   否则 `web_fetch` 会失去后端。
2. **关掉官方提供方是为了避免歧义**。服务层在没 pin id 时会要求「恰好一个可用提供方」；
   两个都在就会报 `WEB_PROVIDER_AMBIGUOUS`。想让官方搜索和本插件并存，
   把 `disabled: true` 改成 `false`，并确保 `searchProvider` 始终有值。

## 回到官方搜索

**最省事**：在插件页把 `dsh-custom-search` 这个**组合包**整个关掉。它的 patch 层随之失效，
那两条覆盖一起消失——`web` 的 `searchProvider` 回落、`web-search-deepseek` 不再被 `disabled`，
官方搜索自动回来。

**想保留插件、只临时切回官方搜索**：在 profile 的 `cordis.patch.yml` 里加两条覆盖：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official
    fetchProvider: http        # 整行替换，必须复述，否则 web_fetch 失去后端

- id: web-search-deepseek
  name: '@deepseek-ai/dsh-web-search-deepseek'
  disabled: false              # 必须放开，否则 pin 的提供方本身是关闭的
```

## 卸载

面板里点组合包卡片上的**卸载**（要确认）。用 CLI 的话：

```bash
dsh plugin --profile desktop remove dsh-custom-search
```

两条路都会连组合包一起摘掉，它携带的两条覆盖随之消失，**不需要**手工清理。

要清理的是**你自己**写进 profile patch 的那些条目（见上面的「配置」）——组合包没了以后
`id: custom-search` 寻址不到任何一行，会被静默跳过；留在文件里只是垃圾。

### 如果面板报「其他配置仍在使用这个组合包的组件」

这条报错对应宿主的 `bundle-in-use`：管理器认为该组合包还有行挂在运行时里。
**0.2.0 之前的版本一定会撞上它**——那时 `web` / `web-search-deepseek` 被写在 `insert:` 里，
而它们的正本属于 `dsh-base`，永远不会下线，卸载检查因此永远过不去（见「安装后的实际改动」）。
0.2.0 起改成顶层覆盖，面板卸载正常。

**已经被卡住的旧版：不用拆 profile，换掉那一份文件就够。** 卸载检查读的是
**已安装副本**里的 `cordis.patch.yml`，把它换成 0.2.0 的，判据立刻从 3 行降到 1 行：

```bash
cd ~/.dsh/profiles/desktop/node_modules/dsh-custom-search
cp "D:\code\self\all\dsh-custom-search\cordis.patch.yml" .
# 然后回面板点卸载 —— 它会自己跑 pnpm remove 并整理 package.json / lockfile
```

想先确认再动手，用 `dev/bundle-rows.mjs` 对着这份文件跑一次：它照宿主的语义算出
「贡献行」，凡不是本包的行都会被标出来 —— 那正是 `bundle-in-use` 的判据。

如果报的是**另一个**码 —— `reasonStopProfile`（「这个 profile 没有启用 HMR，
正在使用的包要停止后用 dsh plugin 卸载」）—— 说明该组合包是**本次启动时**加载的。
先重启 Harness 让 `startedBundles` 复位，再卸载。

两条路都不通时的兜底（桌面端没有 `dsh` CLI，只能改文件）：

```bash
# 1) 停掉 Harness
# 2) 从依赖里删掉这一行
#    ~/.dsh/profiles/desktop/package.json       的 dependencies.dsh-custom-search
# 3) 删掉 profile patch 里 id: custom-search 那个条目（若有）
#    ~/.dsh/profiles/desktop/cordis.patch.yml
# 4) 删目录，并删掉 dsh.profile.bundles 里的 dsh-custom-search
rm -rf ~/.dsh/profiles/desktop/node_modules/dsh-custom-search
# 5) 重启 Harness —— 官方搜索自动回来
```

## 安全说明

- 插件以 Harness 进程的权限运行，安装前请自行审阅源码——这是所有 DSH 插件的通用前提。
- 携带 API key 的请求使用 `redirect: 'error'`，重定向会在发出前被拒绝，
  避免凭证被转发到未核实的主机。免 key 的 SearXNG 允许跟随重定向（常见的 http→https）。
- 返回的 URL 只接受绝对 `http(s)` 地址，其他一律丢弃，不会出现在给模型的结果里。
- `apiKey` 标记为 secret：设置页不回显，也不会进入模型上下文。
- 搜索结果是外部不可信内容，工具层会照常标注为 untrusted。

## 已知限制

- **没有「测试连接」按钮**。表单只做暂存与写入校验，不会去探测引擎是否可达；
  配错了表现为搜索报错，不是表单报错。
- **换引擎不会迁移密钥**。`apiKeyEnv` 留空时引用名跟着主引擎走（`brave` → `BRAVE_API_KEY`），
  所以从 Brave 换到 Tavily 要在表单里另填一个 key；旧的那个仍留在凭证服务里。
- `engine` 在 schema 里是 `union`，表单上是文本框 + 一排胶囊。填了 union 之外的值**保存会失败**，
  表单会保留草稿让你改（`SettingsForm` 的既定行为）。
- 仍可以把密钥明文写进 profile patch 的 `apiKey` 字段（只在本机），但推荐走表单/凭证服务。
- `ctx.web` 的搜索请求只有 `query` 和 `maxResults` 两个参数，所以**没有**时间范围、域名过滤、
  站点限定这类 provider 级控制（这是服务层的既定边界，不是本插件的取舍）。
- `search()` 是每次查询一次请求。`fallback` 里多个引擎串行尝试，最坏情况耗时是各超时之和。
- `available()` 必须是同步、离线的，所以只检查「key 是否配好」，不会去探测引擎是否可达；
  SearXNG 实例挂了会体现为搜索报错，而不是提供方不可用。

## 目录结构

```
dsh-custom-search/
├── index.js          宿主半侧：Config schema、provider 注册、凭证解析、兜底链
├── client.js         浏览器半侧：插件页的配置表单（plugins.row.config）
├── engines.js        引擎适配表：每个引擎的 build（怎么发请求）+ parse（怎么读响应）
├── cordis.patch.yml  组合包 patch：1 行 insert（本插件的行）+ 2 条对既有行的覆盖
├── package.json      dsh.bundle.patch + dsh.client 声明、icon、locale、files 白名单
├── locale/           面板显示用的中英文标题与描述
├── icon.svg
├── docs/             README 用的安装截图
└── dev/              离线验证套件（不随插件分发，files 白名单已排除）
    ├── smoke.mjs        13 项：provider 契约、归一化、去重、兜底、取消、错误码
    ├── validate.mjs     33 项：清单、patch 方言、行归属（insert / 覆盖）、patch 与 Config 对齐、浏览器半侧的契约与实跑
    ├── bundle-rows.mjs  对着任一份 patch 复现卸载判据（bundle-in-use），非本包的行会标出来
    └── asar.py          从 DSH 安装包里抽源码/依赖的解析脚本
```

## 开发

**装成本地目录**，之后改代码只需重启 Harness，不必反复卸载重装：
面板「+ 添加插件」填本仓库的绝对路径，或

```bash
dsh plugin --profile desktop add D:\code\self\all\dsh-custom-search
```

本地目录是 `link:` 而不是复制，所以 `index.js`（宿主半侧）改完重启生效，
`client.js`（浏览器半侧）改完重启后刷新页面即可。改稳定了再换回 `github:` 地址。

新增一个搜索引擎 = 在 `engines.js` 的 `ENGINES` 里加一个条目，声明 `build` 和 `parse`，
再到 `index.js` 的 `Config.engine` union 里加上这个 id，
最后在 `client.js` 的 `ENGINES` 里补一行（浏览器半侧够不到宿主半侧的源码，这张表是刻意重复的，
`validate.mjs` 会盯着两边不许漂移）。

### 验证

`dev/` 下的套件**直接 import 上级目录的真实代码**，没有副本需要同步：

```bash
cd dev
node smoke.mjs      # 起本地 mock server，用 stub ctx.web 驱动真实插件模块
node validate.mjs   # 清单、patch 方言、patch 与 Config 对齐，以及浏览器半侧的契约
node bundle-rows.mjs <某份 cordis.patch.yml>   # 复现宿主的卸载判据，定位「卸不掉」
```

`validate.mjs` 里浏览器半侧那段最值得一提：它**真的把 `client.js` 跑了一遍**——在 `vm` 里
用 stub 的 `require` 物化工厂，再拿一份假 `ctx` 调 `apply(ctx)`，然后检查它到底注册了什么。
断言覆盖两个槽位各自的寻址字段（`plugins.item` 用 `id`、`plugins.row.config` 用 `key`）、
卡片 id 不与官方占用的四个撞车、两个入口共用同一份表单，以及注入的 `hooks.<key>`
与组件读取的 `props.use<Key>()` 拼写一致。**这些全都只会静默失败**——写错一个字符，
插件行就只剩启停开关，界面上没有任何报错。

（把它写成实跑而不是正则断言，是因为"注册到底发生了没有"这件事，只有跑一遍才答得准。）

行归属那几项同理：脚本会照 `applyEntryPatches` 的语义把各层合成一遍，断言
`insert:` 里只有本包自己的行、合成后 `web` / `web-search-deepseek` 各只有一份。
把覆盖行误写进 `insert:` 时，运行期只表现为「卸载按钮报错」，这里会当场失败。
`bundle-rows.mjs` 是这条断言的**现场版**：同一套语义，但可以指向任意一份 patch ——
包括 profile 里那份已安装的副本，所以线上被卡住时也能直接查，不必先复现安装。

这些脚本需要 `js-yaml`、`@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit`
（已放在本目录的 `node_modules/`，被 `.gitignore` 忽略）。
`@deepseek-ai/*` 那几个是 DSH 自带的 vendor 包，可从本机安装里抽：

```bash
python dev/asar.py list "node_modules/@deepseek-ai/schemastery"
python dev/asar.py extract "node_modules/@deepseek-ai/schemastery" node_modules
```

> `asar.py` 默认指向 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`；
> 换机器时改脚本顶部的 `ASAR` 常量即可。

## 许可证

MIT
