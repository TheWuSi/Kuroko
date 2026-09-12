# OpenList 与磁力元数据接入约定

本文件记录当前接入实现及验证范围，接口细节见 [API 规范](api-spec.md)，分层与任务边界见 [架构设计](architecture.md)。

## 兼容基线

- OpenList **v4.2.6**：[官方接口索引](https://fox.oplist.org/llms.txt)、[对应版本源码](https://github.com/OpenListTeam/OpenList/tree/v4.2.6)。
- magnet-metadata-api **0.1.0**：[项目源码](https://github.com/felipemarinho97/magnet-metadata-api/tree/72b1b11a24b5e06bedd023c859ac64b2c52bf5af)。
- OpenList 任务状态：[tache v0.2.2](https://github.com/OpenListTeam/tache/blob/v0.2.2/state.go)。

## 实现要求

1. OpenList 使用原始 Authorization 令牌，检查响应体业务码；密码模式鉴权失效最多重新登录一次。文件与存储列表完整分页，使用真实存储 ID。
2. 离线请求固定 `tool: "PikPak"` 与 `delete_policy: "delete_always"`，从 `data.tasks[0].id` 读取任务 ID。提交前保存本地记录，逐条保留结果，不自动重试不确定的提交。
3. 用户指定目录时原样使用规范化后的目录；未指定才启用分组调度。目录不附加番号或任务 ID，不做刮削、重命名或整理。完整种子大小由后端获取，过滤结果不能代表实际下载体积。
4. 元数据请求使用 `POST /api/v1/metadata`，校验 Hash、相对路径、总大小、文件大小与偏移。单文件种子的空 `files` 由 `name/size` 补齐。区分超时、不可用、请求被拒绝与响应无效。
5. 元数据健康检查使用 `GET /api/v1/health`，只展示实际统计值。健康成功不证明 DHT 可解析任意磁力。
6. 离线与转存采用独立接口和列表。数字状态控制终态，描述文字不用于推断完成；取消请求需等待上游确认。离线完成不伪造文件记录，番号库通过定向扫描维护。
7. 配置测试合并当前表单与已保存配置，不写入数据库。局部更新不重置未提交字段；返回掩码并兼容掩码回传，错误信息不回显凭据。
8. 原生容量优先读取存储 `mount_details`，缺失时查询挂载根目录；手动配额缺少用量时才递归统计。OneDrive 若关闭原生统计或扫描超时，返回具体 `space_error` 并保留未知容量；GoogleDrive 的无限配额不当作零容量。

## 验证范围

后端契约测试覆盖真实端点、鉴权、分页、数据验证、元数据降级和健康接口；SQLite 集成测试覆盖配置合并、存储分组、OneDrive 容量回退、完整大小调度、批量部分失败、取消语义及数字任务状态。前端执行类型检查、lint 与生产构建，并验证关键页面请求。

部署配置固定元数据镜像版本，持久化 `/app/cache`，映射 DHT/Peer 的 TCP/UDP 端口，配置 Redis 与元数据服务健康检查。验证应使用隔离环境；真实 PikPak 离线和跨盘转存仍需可用的 OpenList/PikPak 实例确认。
