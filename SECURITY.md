# Security Policy

## 概述

`dsh-plugin-unity-chat` 是本地运行的 DSH（DeepSeek Harness）插件，用于在 Unity 编辑器里与 DSH 会话对话。
本文件说明它的**信任边界、权限范围与已知风险**，便于使用者评估是否适合在自己的环境中安装。

## 权限与副作用（完整清单）

| 类别 | 行为 | 触发条件 |
|---|---|---|
| 本地网络监听 | **无**。插件本身不监听任何端口 | — |
| 外发网络请求 | **无**。不发送遥测/上报 | — |
| 启动外部进程 | 启动 `gamedev-mcp-server.exe`（第三方 MCP server），detached | `mcpEnabled: true` 且可执行文件路径校验通过 |
| 结束进程 | 结束自己记录的 pid | `mcpEnabled` 改为 `false` |
| 写文件 | 各工程 `Assets/Editor/DSHChatWindow.cs` | `deployScript: true`（默认） |
| 写文件 | `<工程>/Library/DSH-Chat/chat.jsonl`（由 Unity 端脚本写） | 打开对话窗 |
| 写文件 | `%USERPROFILE%\.dsh\unity-chat\`（心跳、最近工程、MCP 状态、bin） | 插件运行 |
| 写配置 | 通过 DSH `configEditor` 写回本插件配置字段 `recentProjects` | 最近工程变化 |
| 执行工具 | `unity_chat_status`（只读，返回状态 JSON） | Agent 调用 |

## 安全加固（1.4.2 起）

- **部署目标限制**：必须位于配置的 Unity 工程目录内，且扩展名必须是 `.cs`
- **chatFile 限制**：必须是工程内相对路径，禁止绝对路径与 `..`
- **MCP 可执行文件限制**：basename 必须是 `gamedev-mcp-server.exe`
- **聊天文件大小限制**：超过 4 MiB 只读取尾部，避免异常文件拖垮进程
- **配置默认值可激活**：缺少必填项时降级运行并记录日志，不会崩溃

## 信任边界与已知风险

### 1. 聊天文件可被本机任意进程写入（提示注入）

Unity 对话窗把消息追加到 `<工程>/Library/DSH-Chat/chat.jsonl`，插件再把最后一行 `role=user` 的内容作为**用户回合**注入 DSH 会话。
因此：**任何能写该文件的本机进程，都能让 Agent 收到任意文本**。

缓解措施与建议：

- 该文件位于工程 `Library/`（Unity 自动生成目录），请勿放在多用户可写或网络共享位置
- 注入的消息在 DSH 会话中以普通用户消息出现，**可见、可核对**
- 不要把高权限工具/凭据暴露给无人值守的会话
- 如不需外部写入，可把 `deployScript` 关掉并自行控制 `chat.jsonl` 来源

### 2. MCP server 是第三方程序

`gamedev-mcp-server` 由 [IvanMurzak/Unity-MCP](https://github.com/IvanMurzak/Unity-MCP) 提供，**不在本插件的许可证与责任范围内**。
本插件只负责按配置安装/启动/停止它；其行为、端口暴露（`127.0.0.1`）、日志与数据由该程序自身决定。
请在信任来源后再启用 `mcpEnabled`。

### 3. 配置即权限

`projects`、`chatFile`、`mcpServerPath`、`mcpServerSource` 等配置决定了插件读写/启动的目标。
能修改 `cordis.patch.yml` 或通过设置页改配置的人，等同于拥有这些能力；请保护好 DSH profile 目录的写权限。

## 报告漏洞

请通过 GitHub **Issues** 提交（或仓库的 Security Advisories），不要在公开 Issue 中贴出可直接利用的细节。
请包含：DSH 版本、插件版本、复现步骤、影响范围。

## 支持的版本

仅对**最新发布版本**提供安全修复；请保持 `package.json` 中的版本为最新 tag。
