# dsh-plugin-unity-chat

Unity 编辑器内的 DSH 对话窗 ↔ DSH 会话桥。在 Unity 里直接说话，DSH 侧即时被唤醒并回复；支持多工程、自动部署脚本、最近工程心跳与 MCP 服务管理。

- 版本：**1.4.2**
- 仓库：`https://github.com/yigeness/dsh-plugin-unity-chat`（安装：`dsh plugin add github:yigeness/dsh-plugin-unity-chat#v1.4.2`）
- 类型：DSH bundle 插件（宿主 + Web 客户端设置页）
- 兼容：DSH Desktop ≥ 2.0（`dsh.compatibility.dsh: ">=0.2.0-rc.1"`）；Node 22.19+ / 24+；Unity 2020.1+（仅聊天，2022.3+ 才能配合 MCP 操作场景）
- 许可：MIT

---

## 1. 功能

| 功能 | 说明 |
|---|---|
| **Unity 内对话** | Unity 对话框写入 `chat.jsonl`，插件把新消息作为**真实用户回合**注入指定 DSH 会话，延迟 ≈1.8 秒 |
| **多工程** | `projects` 列表里的任意 Unity 工程都可使用；每个工程**独立聊天文件** |
| **脚本自动部署** | 插件内置唯一一份 `DSHChatWindow.cs`，启动时幂等写入各工程 `Assets/Editor/`，Unity 打开即自动弹窗 |
| **休眠降频** | 空闲 `idleMs` 后改用 `sleepPollMs` 低频检查；有新消息自动恢复 |
| **最近工程** | Unity 启动写心跳 → 插件汇总最近 3 个加载过对话窗的工程，并在**设置页直接显示**（不足补空白） |
| **MCP 服务管理** | 勾选启用后自动安装（必要时复制 exe）并启动 `gamedev-mcp-server`；取消勾选则停止 |
| **状态工具** | Agent 可调用 `unity_chat_status` 查看工程、最近工程、休眠与 MCP 状态 |

---

## 2. 安装

本插件是标准 DSH **bundle**（`dsh.bundle.patch` + 可选 `dsh.client` Web 设置页），
推荐用 DSH 自身的插件安装能力安装，**不要手写 profile 文件**。

### 2.1 一键安装（推荐）

在 DSH 里：

- 打开 **插件 → 添加插件**，粘贴 GitHub 地址（或仓库 tarball 地址）；
- 或在 **DSH 终端**执行：

```powershell
# 从 GitHub 仓库安装（分支默认 main）
dsh plugin add github:yigeness/dsh-plugin-unity-chat

# 或者用完整 git 地址
dsh plugin add https://github.com/yigeness/dsh-plugin-unity-chat

# 指定 tag / commit（版本锁定，推荐）
dsh plugin add github:yigeness/dsh-plugin-unity-chat#v1.4.2
```

安装完成后按提示**重启 DSH Desktop**。

### 2.2 首次配置

安装后插件会自动出现在 **设置 → Unity-Chat**（以及「插件 → 已安装」）。首次使用需要填两项：

1. **DSH 会话 ID**：当前要接收 Unity 消息的会话（会话 ID 可在会话信息里看到）
2. **Unity 工程路径**：每行一个工程根目录

其余项（轮询间隔、休眠、MCP）用默认值即可。保存后**热生效**，无需重启。

> 未配置时插件也能正常加载（不会报错），只是不会唤醒任何会话；宿主日志会给出配置提示。

### 2.3 开发/离线安装（备用）

如果要在本地开发调试，可以手动装进 profile（不推荐用于分发）：

```jsonc
// profile/package.json
{
  "dependencies": { "dsh-plugin-unity-chat": "file:E:/path/to/dsh-plugin-unity-chat" },
  "dsh": { "profile": { "bundles": ["dsh-plugin-unity-chat"] } }
}
```

```yaml
# profile/cordis.patch.yml —— bundle 已插入条目，这里只覆盖配置
- id: unity-chat
  config:
    sessionId: session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    projects:
      - 'E:\Games\MyProject'
```

> `bundles` 决定加载；`dependencies` 决定「插件 → 已安装」可见（管理器按 `pkg.installed` 过滤）。

---

## 3. 设置页（设置 → Unity-Chat）

配置也可在 **设置 → Unity-Chat** 中直接编辑保存（保存后热生效）。

### 3.1 配置模板（字段说明）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sessionId` | string | `''` | 要唤醒的 DSH 会话 ID（留空则只监听不唤醒） |
| `projects` | string[] | `[]` | Unity 工程根路径列表；每行一个（UI 里也支持分号分隔） |
| `chatFile` | string | `Library/DSH-Chat/chat.jsonl` | 聊天文件相对工程根的路径（每个工程各自独立） |
| `pollMs` | number | `1800` | 活跃期检查间隔（ms，最小 300）；推荐 500 / 1000 / 1800 / 5000 |
| `sleepPollMs` | number | `30000` | 休眠期低频检查间隔（ms，最小 1000） |
| `idleMs` | number | `300000` | 空闲多久进入休眠（ms）；`0` = 永不休眠 |
| `deployScript` | boolean | `true` | 是否自动把 `DSHChatWindow.cs` 部署到各工程 |
| `recentLimit` | number | `3` | 「最近工程」保留数量 |
| `recentProjects` | string[] | `[]` | **只读**：最近加载过对话窗的工程（插件自动写回，不足补空串） |
| `mcpEnabled` | boolean | `false` | 是否启用 MCP 服务（启用=安装+启动，关闭=停止） |
| `mcpPort` | number | `8080` | MCP 服务端口，需与 DSH 的 `mcp-unity` 客户端一致 |
| `mcpServerSource` | string | `''` | 安装来源：本地 `gamedev-mcp-server.exe` 路径；首次启用时复制到 `~/.dsh/unity-chat/bin/` |
| `mcpServerPath` | string | `''` | 已安装 exe 路径；留空使用插件 bin 目录 |

### 3.2 设置页示例值

```
DSH 会话 ID           session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Unity 工程路径        E:\Games\MyProject
                      C:\Users\me\OtherProject
自动部署对话窗脚本    ☑
活跃期检查间隔        1800
休眠期检查间隔        30000
空闲多久进入休眠      300000
「最近工程」数量      3
———————————————————————————
启用 MCP 服务         ☐
MCP 端口              8080
exe 来源路径          E:\...\gamedev-mcp-server.exe
已安装 exe 路径       （留空）
```

---

## 4. 消息协议（`chat.jsonl`）

一行一个 JSON：

```jsonc
{"role":"user","text":"给场景加个红色立方体","ts":"2026-10-18T04:00:00.000Z"}
{"role":"assistant","text":"已添加。","ts":"2026-10-18T04:00:02.000Z"}
```

- 编码：UTF-8 **无 BOM**；追加写；读取方容忍坏行
- 只有最后一行变化且 `role=user` 时才会唤醒
- 回复由 Agent 追加为 `role=assistant`

### 4.1 角色 → 行为

| 最后一行 | 插件行为 |
|---|---|
| `role=user` | 唤醒会话，提示中包含工程名与该工程聊天文件路径 |
| `role=assistant` | 不动作（避免自唤醒） |
| 坏行 / 空文本 | 跳过 |

---

## 5. 心跳与「最近工程」

Unity 在加载/打开对话框时写入：

```
%USERPROFILE%\.dsh\unity-chat\heartbeats\<项目名>-<稳定哈希>.json
{ projectPath, projectName, unityVersion, loadedAt }
```

插件每 15 秒汇总：按 `loadedAt` 倒序 → 按工程路径去重（统一分隔符 + 小写）→ 取前 `recentLimit` 个，不足补 `null`，写入：

```
%USERPROFILE%\.dsh\unity-chat\recent-projects.json
```

查看方式：对话中调用 `unity_chat_status`。

---

## 6. MCP 服务

| 动作 | 触发 | 实际行为 |
|---|---|---|
| 安装 | `mcpEnabled: true` 且 bin 目录无 exe | 从 `mcpServerSource` 复制到 `~/.dsh/unity-chat/bin/gamedev-mcp-server.exe` |
| 启动 | `mcpEnabled: true` | 以 detached 进程启动，环境变量：`UNITY_MCP_CONNECTION_MODE=Custom`、`UNITY_MCP_HOST=http://127.0.0.1:<mcpPort>`、`UNITY_MCP_START_SERVER=true`、`UNITY_MCP_TRANSPORT=streamableHttp` |
| 停止 | `mcpEnabled: false` | 结束记录的进程 |
| 状态 | — | `~/.dsh/unity-chat/mcp-server.json` + `unity_chat_status` |

> 仅管理 **MCP server 进程**。Unity 侧仍需工程里安装 `com.ivanmurzak.unity.mcp` 才能在场景中操作。

---

## 7. 目录结构

```
dsh-plugin-unity-chat/
├─ package.json            dsh.bundle.patch + dsh.client（Web 设置页）
├─ cordis.patch.yml        bundle 插入条目（id=unity-chat）
├─ index.js                宿主：编排、休眠状态机、Config schema、状态工具
├─ config.js               配置规范化
├─ chat-file.js            单聊天文件读取与去重
├─ waker.js                resolveAgent + followup 唤醒会话
├─ deploy.js               幂等部署 DSHChatWindow.cs
├─ heartbeat.js            心跳汇总 → 最近工程
├─ mcp.js                  MCP 服务安装/启动/停止
├─ lib/client.js           设置页「Unity-Chat」客户端插件
├─ assets/DSHChatWindow.cs 唯一一份 Unity 端脚本
└─ test/                   21 个单元测试
```

运行时产物：

```
<工程>\Assets\Editor\DSHChatWindow.cs     部署的脚本
<工程>\Library\DSH-Chat\chat.jsonl        每工程聊天文件
~/.dsh/unity-chat/heartbeats/*.json       工程心跳
~/.dsh/unity-chat/recent-projects.json    最近工程
~/.dsh/unity-chat/mcp-server.json         MCP 进程状态
~/.dsh/unity-chat/bin/                    MCP 可执行文件
```

---

## 8. 排障

| 现象 | 原因 / 处理 |
|---|---|
| 「插件 → 已安装」看不到 | 没写进 profile `dependencies`（仅写 bundles 不够） |
| 设置页左侧有 Unity-Chat 但内容空白 | 客户端插件 `inject` 必须含 `"remote"`、`"remote.settings"`；改完要重启 DSH |
| Unity 不弹对话框 | 脚本已写入但 Unity 未导入：点一下 Unity 窗口 / `Assets → Refresh`；检查 `DSHChatWindow.cs.meta` 是否存在 |
| 消息发出没反应 | ① `sessionId` 是否是当前会话；② DSH 日志搜 `unity-chat`；③ 聊天文件最后一行是否 `role=user` |
| 改了插件代码不生效 | Node ESM 模块缓存；换包名或重启 DSH |
| MCP 连不上 | `mcpEnabled` 是否打开、端口是否与 `mcp-unity` 客户端一致、Unity 是否运行 |
| 唤醒日志报错 | 检查宿主日志中的 `[unity-chat] 唤醒失败`；常见为 sessionId 无效 |

日志位置：

```
C:\Users\<用户>\AppData\Roaming\DSH Desktop\logs\host\dsh-YYYY-MM-DD.log
```

---

## 9. 开发与测试

```powershell
# 单元测试（沙箱里不要用 node --test，会因 spawn 管道报 EPERM）
node test/config.test.js && node test/chat-file.test.js && node test/waker.test.js && node test/heartbeat.test.js
```

修改后安装到 profile：

```powershell
$src = '<仓库路径>\dsh-plugin-unity-chat'
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-unity-chat"
Copy-Item "$src\*.js","$src\package.json","$src\cordis.patch.yml" $dst -Force
Copy-Item "$src\lib\client.js" "$dst\lib\client.js" -Force
Copy-Item "$src\assets\*" "$dst\assets" -Force
# 宿主代码 / 客户端 UI 改动需重启 DSH Desktop
```

---

## 10. 变更记录

| 版本 | 变更 |
|---|---|
| 1.0.0 | bundle 化：多工程、独立聊天文件、心跳、状态工具 |
| 1.1.0 | 插件管理器注册（出现于「已安装」） |
| 1.2.0 | 设置页「Unity-Chat」（settings.section + remote.settings）；MCP 服务安装/启停集成 |
| **1.3.0** | **最近加载过的工程显示在设置页（宿主写回配置字段 + 刷新按钮）** |
| **1.3.1** | **Config 字段全部 `.volatile()`：设置命名空间才可见；配置热更新（不重启）** |
| **1.4.0** | **发布合规化：移除 `private`，补 license/repository/engines/peerDependencies、locale 显示元数据与 icon；默认配置可直接激活（缺 sessionId/projects 不再报错，改为降级+提示）；UI 全部改用主题 token** |
| **1.4.1** | **修复 volatile 配置引用未解包：projects 曾变成 `[object Object]` 并在错误目录部署脚本；新增 `unwrapConfigValue()` 与工程路径合法性校验** |
| **1.4.2** | **安全加固：部署目标必须位于工程目录内且为 `.cs`；MCP 只允许启动 `gamedev-mcp-server.exe`；聊天文件超大时只读尾部；chatFile 禁止绝对路径/`..`；新增 `SECURITY.md`** |

---

> 上传到 GitHub、打包发布、以及发布前检查清单，见工作区文档
> `DSH插件-GitHub上传与发布指南.md`。

---

## 11. 交接给其他会话：任务逻辑与已知坑

> 这一节写给"接手这个插件的下一个会话"。先读这一节，再改代码。

### 11.1 任务逻辑（一句话 + 一张流程）

**Unity 里说话 → DSH 被唤醒回复**：

```
Unity EditorWindow（DSHChatWindow.cs）
  │  用户输入
  ▼
<工程>\Library\DSH-Chat\chat.jsonl     ← 每个工程独立
  │  宿主插件每 pollMs 读最后一行
  ▼
宿主 index.js
  ├─ 新 role=user → sessionController.resolveAgent + agent.followup
  │                  （把消息作为真实用户回合注入会话）
  └─ 每 15s：读心跳 → recent-projects.json → 写回配置字段 recentProjects
  ▼
DSH 会话（Agent 被唤醒，可用 MCP 工具操作 Unity）
  │  回复
  ▼
追回同一 chat.jsonl（role=assistant）→ Unity 窗口显示
```

### 11.2 三条最重要的约定

| 约定 | 不遵守的后果 |
|---|---|
| **Config 每个字段都要 `.volatile()`** | 设置命名空间不会出现在 `describe()`，设置页报"未找到设置命名空间" |
| **客户端插件 `inject` 必须含 `slots` / `remote` / `remote.settings`** | 设置页左侧有标签、右侧**空白且无报错** |
| **profile 的 `dependencies` 和 `dsh.profile.bundles` 都要有本包** | 「插件 → 已安装」列表里看不到（只有 bundles 不够） |
| **volatile 配置字段取值前必须解包** | 拿到的是 `{ get(), … }` 引用对象，`String()` 得到 `[object Object]`，会把错误值写回配置、在错误目录部署脚本 |

### 11.3 已知坑（按踩坑顺序）

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 唤醒报 `throwIfAborted` | `sessionController.prompt()` 是 Typert 远程方法，宿主裸调缺 RPC 上下文 | 改用 `resolveAgent()` + `agent.followup(createUserMessage(...))` |
| 2 | 改了插件代码不生效 | Node ESM 模块缓存；patch 热重载只重挂载不重读文件 | 换包名或重启 DSH |
| 3 | 「已安装」看不到 | 插件管理器过滤条件 `pkg.installed` 来自 `dependencies` | profile `dependencies` 加 `file:` 路径 |
| 4 | 设置页只出现标签、右侧空白、控制台无错 | 客户端插件 `inject` 缺 `remote` / `remote.settings` | 补齐 inject（对照 `dsh-set-model`） |
| 5 | 面板渲染失败 `Cannot read properties of undefined (reading 'length')` | 前端初始状态对象缺字段（`EMPTY.recentProjects`） | 补字段 + `Array.isArray` 防御 |
| 6 | 设置页报"未找到设置命名空间" | Config 字段缺 `.volatile()` | 全部字段加 `.volatile()` |
| 7 | 设置页保存后配置不生效 | volatile 写入**不重跑 apply**，插件内的 `cfg` 快照过期 | 监听 `loader/volatile-update`，重新 `normalizeConfig` 并重建 readers/部署 |
| 8 | Unity 不弹对话框 | 脚本已写入但 Unity 未导入 | 点一下 Unity 窗口 / `Assets → Refresh`，检查 `.meta` 是否生成 |
| 9 | 最近工程一直空白 | 宿主写回配置后前端只读 `value`，覆盖层在 `user` | 前端合并 `base`/`value`/`user` 三层 |
| 10 | 工程列表变 `[object Object]`、脚本被部署到奇怪目录 | volatile 字段是引用包装对象，直接 `String()`/展开会丢值 | 取值与写回前都用 `unwrapConfigValue()` 解包 |

### 11.4 继续开发的标准流程

```powershell
$src = '<插件源码目录>\dsh-plugin-unity-chat'
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-unity-chat"

# 1) 改 $src 下的文件（唯一源码）
# 2) 校验
node --check "$src\index.js"; node --check "$src\lib\client.js"
cd $src; node test/config.test.js; node test/chat-file.test.js
# 3) 安装
Copy-Item "$src\*.js","$src\package.json" $dst -Force
Copy-Item "$src\lib\client.js" "$dst\lib\client.js" -Force
Copy-Item "$src\assets\*" "$dst\assets" -Force
# 4) 宿主代码 / 客户端 UI 改动 → 重启 DSH；仅改配置值 → 热更新生效
# 5) 验证：设置页表单、最近工程、MCP 启停日志
```

**验证清单**

- [ ] 设置 → Unity-Chat 表单有值、可保存并提示"已保存并热生效"
- [ ] 「最近加载过对话窗的工程」显示真实工程名（不是全空白）
- [ ] 勾选/取消 MCP 服务：日志出现 `MCP 服务已启动/已停止`，8080 端口监听/释放
- [ ] Unity 对话框发消息 → 2 秒内被唤醒 → 回复写回对应 chat.jsonl
- [ ] 宿主日志无 `[unity-chat] 唤醒失败` / `写入最近工程配置失败`

### 11.5 当前遗留 TODO

1. "最近 3 个工程"目前靠写回配置字段实现，值变化会写一次配置；若要更实时，可改 typert RPC
2. 只监听聊天文件最后一行：快速连发多条可能只处理最后一条（可改字节游标）
3. `sessionId` 仍单会话绑定；多会话映射未做
4. 未注册 `unity_chat_*` 管理工具（目前只有 `unity_chat_status`）
5. 未打包发布（当前以本地 `file:` 依赖方式安装）

### 11.6 三份文档的分工

| 文档 | 看什么 |
|---|---|
| 本文件 `README.md` | 插件功能、配置模板、**任务逻辑与坑（本节）** |
| `DSH-Unity对话桥插件-交接文档.md` | 架构演进、阶段记录、验证结果 |
| `DSH插件开发指南-以Unity对话桥为例.md` | 从零开发 DSH 插件的方法论 + **错误定位技巧** |

> 遇到问题先在本节 11.3 找现象；找不到时看宿主日志：
> `%APPDATA%\DSH Desktop\logs\host\dsh-YYYY-MM-DD.log`（搜 `unity-chat`）。

---

## 12. 安全与信任边界

完整说明见 [SECURITY.md](SECURITY.md)，要点：

| 项 | 说明 |
|---|---|
| **暴露的网络接口** | 无。插件不监听端口、不发起外部请求；只有可选的 `gamedev-mcp-server` 在 `127.0.0.1:<mcpPort>` 监听（本机回环，第三方程序） |
| **会执行的外部程序** | 仅 `mcpEnabled` 且路径 basename 为 `gamedev-mcp-server.exe` 时才启动；返回的 pid 记录在 `~/.dsh/unity-chat/mcp-server.json` |
| **会写入的文件** | ① 各工程 `Assets/Editor/DSHChatWindow.cs`（限定工程内、必须是 `.cs`）；② `<工程>\Library\DSH-Chat\chat.jsonl`；③ `~/.dsh/unity-chat/**`；④ 通过 settings 写回自身配置的 `recentProjects` |
| **路径穿越防护** | 部署目标必须落在配置的工程目录内；`chatFile` 禁止绝对路径与 `..` |
| **信任边界** | 能写 `chat.jsonl` 的本机进程可以让 Agent 收到任意文本（**提示注入**）。请把该文件视同"用户输入"，不要放在多用户可写目录；DSH 侧消息以普通用户回合出现，可人工核对 |
| **不收集数据** | 无遥测、无网络上报 |

发现安全问题请通过 GitHub Issues 报告（不要公开可利用细节）。
