# dsh-composer-cost

DeepSeek Harness 插件：在输入框下方那行统计条里，与「上下文已用」并排，显示**本轮花费**、**本会话累计花费**和**账号剩余余额**。

```
本轮 ¥0.0072 · 会话 ¥0.0081 · 余额 ¥123.46
```

鼠标悬停出明细：

```
本轮对话
输入 1,000 · 缓存命中 50,000 · 缓存写入 0 · 输出 1,300
计费：空闲价（deepseek-flash） — ¥0.0072

整个会话
输入 1,500 · 缓存命中 50,000 · 缓存写入 0 · 输出 1,400
计费：空闲价（deepseek-v4-pro） — ¥0.0081

账号钱包
¥123.46 · ¥5.00

单价按 DeepSeek 官网人民币价目；高峰时段为北京时间周一至周五 09:00–12:00、14:00–18:00。
```

## 装法

插件是一个 DSH bundle，靠 `dsh.bundle.patch` 插入一行、靠 `dsh.client` 注入一段浏览器端模块。两种装法选一种。

### A. 克隆目录（推荐，能跟着仓库更新）

```bash
git clone https://github.com/<你的账号>/dsh-composer-cost.git
```

然后在 Harness 里安装这个**绝对目录路径**（设置 → Plugins → 安装 bundle，或在对话里让 Agent 调 `plugin_manager`）：

```json
{ "action": "install_bundle", "target": "C:\\path\\to\\dsh-composer-cost" }
```

安装是 `pnpm link` 方式，之后 `git pull` 完文件即生效；Host 端有文件监视，浏览器端模块会自动热更。

### B. Release 里的 tgz

从 Releases 下载 `dsh-composer-cost-1.0.0.tgz`，把**文件路径**交给 `install_bundle`：

```json
{ "action": "install_bundle", "target": "C:\\downloads\\dsh-composer-cost-1.0.0.tgz" }
```

自己打包：

```bash
npm pack        # 产出 dsh-composer-cost-1.0.0.tgz
```

### 卸载

```json
{ "action": "remove_bundle", "target": "dsh-composer-cost" }
```

或者设置 → Plugins 里删掉。改动对同一 profile 下所有会话生效，重启后依旧。

## 前置条件

- DeepSeek Harness `0.2.x`（Desktop 或 `dsh web`）
- profile 里有 Web 表面：`@deepseek-ai/dsh-client-ui-conversation`（`dsh-base` + `dsh-web-app` 自带，官方默认装配就有）

## 计价表

单价写在 `client.js` 顶部的 `PRICES`，人民币 / 百万 token，取自 DeepSeek 官方价目：

| 模型 | 时段 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|---|
| `deepseek-flash` | 高峰 | 0.04 | 2 | 8 |
| `deepseek-flash` | 空闲 | 0.02 | 1 | 4 |
| `deepseek-v4-pro` | 高峰 | 0.30 | 9 | 27 |
| `deepseek-v4-pro` | 空闲 | 0.15 | 4.5 | 13.5 |

高峰 = 北京时间周一至周五 09:00–12:00、14:00–18:00，其余时段（含周末）按半价。缓存写入按「未命中」价计。模型从节点 usage 的 `routes` 里取真实路由名，`pro` 走 pro 行，其余走 flash 行。

改价直接改常量，存盘即热更，不用重启：

```js
const PRICES = {
  flash: { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  pro: { peak: { hit: 0.3, miss: 9, out: 27 }, off: { hit: 0.15, miss: 4.5, out: 13.5 } },
}
```

## 数据从哪来

| 显示项 | 来源 | 精度 |
|---|---|---|
| 本轮花费 | Chat 节点里 `turn` 最大的那组 assistant `usage`（输入 / 缓存命中 / 缓存写入 / 输出） | 精确，来自 provider 上报的 usage |
| 会话累计 | 持久投影 `tokenUsage`（整条会话日志折叠，压缩后仍然准） | 精确 |
| 余额 | `ctx.remote.account.getBalance`，Host 侧直连 DeepSeek 平台 | 服务端原始值，显示保留两位小数 |

余额 60 秒刷一次，每完成一轮也刷。未登录（用 API key 模式）或读取失败时只显示前两段，不占位。

## 隐私

插件不采集、不上报任何数据。余额请求从**本机 Host** 发往 DeepSeek 平台，凭证由 Host 的 credentials 服务管理，浏览器端拿不到 token。浏览器端只读本机会话的 token 计数。

## 目录结构

```
package.json        # dsh.bundle.patch + dsh.client 声明
cordis.patch.yml    # 插入的 Loader 行
index.js            # Host 半边（空 apply）
client.js           # 浏览器半边：统计、计价、渲染
locale/en.json      # 插件元数据（英文）
locale/zh.json      # 插件元数据（中文）
icon.svg            # 插件图标
```

## 已知限制

- 中国法定节假日按空闲价计费，插件无法感知节假日，那几天会按高峰价显示（偏高）
- 一次会话里换过模型时，会话累计按最新一次路由的模型单价折算
- 只算 token，不算网页搜索 / 抓取的按次费用（该计费从 2026-11-01 00:00 起按次收取，未计入本插件）
- 供应商若下发 `cacheWriteTokens`，按未命中价计（DeepSeek 无独立缓存写入价）

## 发布者：推到 GitHub

仓库本身已经 `git init` 并提交过一次，改完代码直接：

```powershell
.\push.ps1 -Repo https://github.com/<你的账号>/dsh-composer-cost.git
```

没装 git 就先装（装完重开一个终端）：

```powershell
winget install --id Git.Git -e --source winget
```

手动等价命令：

```bash
git add -A
git commit -m "chore: update"
git remote add origin https://github.com/<你的账号>/dsh-composer-cost.git
git push -u origin main
```

发版：

```bash
npm pack                                  # 产出 dsh-composer-cost-<version>.tgz
gh release create v1.0.0 --title v1.0.0 --notes "first release" dsh-composer-cost-*.tgz
```

## License

MIT
