# Kuroko RESTful API 规范文档

> **版本**：v1.0.0  
> **协议规范**：RESTful API  
> **数据交换格式**：JSON (`application/json; charset=utf-8`)  
> **文档维护者**：Kuroko 架构团队  

---

## 1. 基础规范

### 1.1 Base URL
所有 API 接口均带有统一的版本前缀：
```text
/api/v1
```

### 1.2 认证与鉴权 (Authentication)
- 系统使用 **Bearer Token (JWT)** 进行接口认证。
- 登录、首次初始化/初始化状态与健康检查接口公开；业务接口须在 HTTP Header 中携带身份令牌：
  ```http
  Authorization: Bearer <your_jwt_token>
  ```
- 若 Token 无效、缺失或过期，服务端将返回 HTTP `401 Unauthorized`。

### 1.3 统一响应格式

所有接口响应均封装为统一的 JSON 结构。

#### 1.3.1 成功响应 (Success)
HTTP 状态码通常为 `200 OK`（创建资源可为 `201 Created`）。
```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | integer | 业务状态码，固定为 `0` 代表成功 |
| `message` | string | 状态描述文本，成功时默认为 `"success"` |
| `data` | object / array / null | 业务数据主体 |

#### 1.3.2 错误响应 (Error)
HTTP 状态码相应为 `4xx` 或 `5xx`。
```json
{
  "code": 40001,
  "message": "参数校验失败: magnet_links 不能为空",
  "data": null
}
```
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | integer | 业务错误码（非 0，具体见业务错误码清单） |
| `message` | string | 错误详细描述信息，前端可直接展示 |
| `data` | null / array | 一般为 null；422 验证错误只包含字段位置与错误类型，不回显输入 |

---

## 2. 状态码与业务错误码清单

### 2.1 HTTP 状态码约定
| HTTP Code | 描述 | 使用场景 |
| :--- | :--- | :--- |
| `200 OK` | 请求成功 | 查询、更新或通用成功操作 |
| `201 Created` | 资源创建成功 | POST 新增存储分组、创建任务等 |
| `400 Bad Request` | 请求错误 | 请求参数验证失败、格式错误 |
| `401 Unauthorized` | 身份验证失败 | 未提供 Token、Token 过期或签名无效 |
| `403 Forbidden` | 权限不足 | 用户没有操作该资源的权限 |
| `404 Not Found` | 资源不存在 | 请求的 URL、任务、分组或番号不存在 |
| `422 Unprocessable Entity` | 实体不可处理 | Pydantic 请求体验证失败 |
| `500 Internal Server Error` | 服务器内部错误 | 未捕获的服务端异常 |
| `502 Bad Gateway` | 上游服务网关错误 | OpenList API 或 BT 解析服务连接失败或响应异常 |

### 2.2 业务错误码 (Business Error Code)
| 业务码 | 说明 |
| :--- | :--- |
| `0` | 成功 (Success) |
| `40001` | 请求参数缺失或格式校验不通过 |
| `40101` | 用户名或密码错误 |
| `40102` | Token 缺失、无效或已过期 |
| `40301` | 无权访问该资源 |
| `40401` | 指定资源不存在（任务、分组或番号记录） |
| `40901` | 资源冲突（如分组名称已存在） |
| `50001` | 系统未知内部异常 |
| `50201` | OpenList 接口调用失败或未连接 |
| `50202` | BT 解析服务不可用或解析超时 |

---

## 3. 模块 1: 认证 (Auth)

### 3.1 用户登录
- **路径**：`POST /api/v1/auth/login`
- **认证**：无需认证
- **描述**：验证管理员用户名与密码，成功后签发 JWT Token。

#### 请求参数 (Body)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `username` | string | 是 | 用户名，例如 `"admin"` |
| `password` | string | 是 | 密码 |

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your_secure_password"
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_at": "2026-09-07T19:56:26Z"
  }
}
```

#### 响应示例 (失败)
```json
{
  "code": 40101,
  "message": "用户名或密码错误",
  "data": null
}
```

---

### 3.2 刷新 Token
- **路径**：`POST /api/v1/auth/refresh`
- **认证**：需要 Bearer Token
- **描述**：使用当前未完全失效的 JWT Token 换取新 Token，延长会话有效期。

#### 请求参数
无 Body，通过 Header 携带现有 Token。

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/auth/refresh" \
  -H "Authorization: Bearer <existing_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_at": "2026-09-08T19:56:26Z"
  }
}
```

---

### 3.3 获取当前用户信息
- **路径**：`GET /api/v1/auth/me`
- **认证**：需要 Bearer Token
- **描述**：根据当前请求携带的 Token，获取登录用户的基本信息。

#### 请求参数
无

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/auth/me" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

---

## 4. 模块 2: 磁力链接 (Magnet)

### 4.1 解析磁力链接

`POST /api/v1/magnets/parse`，需要 Kuroko JWT Bearer 认证。

请求包含 1～100 条 `magnet_links`，每条最多 8192 字符。Hash 仅接受 40 位十六进制或 32 位 Base32，规范化为小写十六进制。后端保留原始输入，清洗结果仅含 `xt/dn`。

```json
{
  "magnet_links": [
    "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=ABC-123"
  ]
}
```

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "results": [{
      "original_magnet": "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=ABC-123",
      "cleaned_magnet": "magnet:?xt=urn%3Abtih%3A0123456789abcdef0123456789abcdef01234567&dn=ABC-123",
      "info_hash": "0123456789abcdef0123456789abcdef01234567",
      "dn_code": "ABC-123",
      "verified_code": "ABC-123",
      "total_files_count": 2,
      "total_size": 1073742848,
      "files": [{"name": "ABC-123.mkv", "size": 1073741824, "filtered": false}],
      "filtered_files": [{"name": "readme.txt", "size": 1024, "filtered": true, "filter_reason": "extension"}],
      "exists_in_library": false,
      "existing_location": null,
      "metadata_fallback": false,
      "fallback_reason": null,
      "metadata_name": "ABC-123"
    }]
  }
}
```

`total_size` 是整个种子的大小，包含过滤文件；过滤只用于番号提取和展示，不影响实际下载。元数据不可用时返回空文件列表、`total_size: 0`、`metadata_fallback: true`；此时 0 表示未知大小。`fallback_reason` 为 `bt_metadata_timeout`、`bt_metadata_unavailable`、`bt_metadata_invalid_request` 或 `bt_metadata_invalid_response`。

前端最多并发四条单磁力请求，保持输入顺序，单条等待时间高于后端最高 300 秒解析超时，并支持 AbortSignal。

### 4.2 批量提交离线下载

`POST /api/v1/magnets/batch-download`，需要认证。

| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `tasks` | array | 是 | 1～100 个任务 |
| `tasks[].magnet` | string | 是 | 有效磁力链接 |
| `tasks[].code` | string | 是 | 1～64 字符，禁止目录分隔符、控制字符与 `..` |
| `tasks[].force` | boolean | 否 | 默认 false，绕过番号库去重；不绕过同磁力同目录待处理任务检查 |
| `tasks[].target_path` | string | 否 | OpenList 绝对目录，最多 1024 字符，优先于分组 |
| `tasks[].target_group` | string / integer | 否 | 分组名称或 ID，目录留空时生效；省略使用 ID 最小的分组 |
| `tasks[].total_size` | integer | 否 | 兼容旧客户端；不会作为调度依据 |

```json
{
  "tasks": [{
    "magnet": "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=ABC-123",
    "code": "ABC-123",
    "target_path": "/OD/Video",
    "force": false
  }]
}
```

直接使用 `/OD/Video`，不添加番号或任务 ID 目录，不做文件整理。目录须属于正常工作的挂载，目标路径须可使用 PikPak；目录不存在时交 OpenList 创建。指定目录允许元数据降级，自动调度则必须由后端取得完整正数大小，并排除容量未知的节点。

业务响应始终包含三个列表；单项失败不回滚之前已提交的任务：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "submitted": [{
      "index": 0,
      "magnet": "magnet:?xt=urn%3Abtih%3A0123456789abcdef0123456789abcdef01234567&dn=ABC-123",
      "code": "ABC-123",
      "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
      "target_path": "/OD/Video",
      "openlist_task_id": "openlist-task-42",
      "total_size": 1073742848,
      "metadata_fallback": false
    }],
    "skipped": [],
    "failed": []
  }
}
```

`skipped` 项包含 `index/magnet/code/reason/existing_location`，`reason` 为 `already_exists` 或 `already_submitted`，后者附带已有 `task_id`。`failed` 项包含 `index/magnet/code/task_id/message/reason`，原因包括 `invalid_target`、`upstream_error`、`submission_unknown`。

提交结果未知时，本地保留无上游 ID 的待处理记录；先核对 OpenList，禁止自动重试。提交成功仅代表离线任务已创建，不代表已入库。前端逐条提交并合并结果，服务端保守计入此前尚在等待/下载的任务容量。

## 5. 模块 3: 下载与转存任务 (Tasks)

### 5.1 获取离线任务

`GET /api/v1/tasks` 支持 `status`、`page`（默认 1）、`page_size`（默认 20，1～100）。响应 `data` 为 `{total, page, page_size, items}`。

`GET /api/v1/tasks/{task_id}` 返回单个本地离线任务，示例 `data`：

```json
{
  "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
  "openlist_task_id": "openlist-task-42",
  "code": "ABC-123",
  "magnet": "magnet:?xt=urn%3Abtih%3A0123456789abcdef0123456789abcdef01234567&dn=ABC-123",
  "status": "downloading",
  "progress": 25.0,
  "speed": null,
  "total_size": 1073741824,
  "downloaded_size": 268435456,
  "downloaded_size_is_estimate": true,
  "phase": "offline_download",
  "target_path": "/OD/Video",
  "error_message": null,
  "created_at": "2026-09-12T10:00:00",
  "updated_at": "2026-09-12T10:01:00"
}
```

`speed` 为 null 时显示未知；下载字节数按进度估算。离线任务 `completed` 仅表示离线阶段结束。缺失上游任务保留本地状态并显示可能被清理的提示。

### 5.2 手动同步

`POST /api/v1/tasks/sync`，无请求体。返回 `synced_count`（本次同步的全部任务数）、`completed_count`（其中本次确认离线完成的数量）与 `updated_tasks`（结构同 5.1）。后台默认每 30 秒同步，前端每 10 秒刷新本地结果；也可手动触发。

同步不生成番号文件记录，不推测真实文件名或跨盘转存结果。

### 5.3 取消离线任务

`DELETE /api/v1/tasks/{task_id}` 仅发送取消请求，不删除记录或文件。成功时 `data` 示例：

```json
{
  "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
  "status": "downloading",
  "cancel_requested": true,
  "deleted": false
}
```

等待上游确认后才变更为 `cancelled`。已结束任务返回 HTTP 409；已取消任务可返回 `cancel_requested: false`。`delete_files=true` 返回 HTTP 400。上游取消失败时本地状态不变；提交结果尚未确认的任务须先在 OpenList 核实。

### 5.4 独立转存列表

`GET /api/v1/tasks/transfers` 返回当前 OpenList 账号可见的全部离线转存任务。响应 `data` 为 `{items: [...]}`，单项包含：

```json
{
  "task_id": "transfer-42",
  "name": "转存到 /OD/Video/ABC-123.mkv",
  "phase": "offline_download_transfer",
  "state": 1,
  "status": "downloading",
  "status_detail": "转存中",
  "progress": 25.0,
  "total_size": 1073741824,
  "downloaded_size": 268435456,
  "downloaded_size_is_estimate": true,
  "error_message": null,
  "start_time": "2026-09-12T10:00:00Z",
  "end_time": null
}
```

不提供猜测的父任务关联。`DELETE /api/v1/tasks/transfers/{task_id}` 取消指定转存任务，返回 `{task_id, cancel_requested: true, deleted: false}`；终态返回 HTTP 409。所有任务接口均需要认证。

## 6. 模块 4: 存储管理 (Storage)

### 6.1 存储列表

`GET /api/v1/storages` 返回 `data.storages` 数组，使用 OpenList 的真实存储 ID。

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "storages": [{
      "id": 73,
      "mount_path": "/OD",
      "driver": "Onedrive",
      "status": "work",
      "total_space": 1099511627776,
      "used_space": null,
      "free_space": null,
      "space_source": "manual",
      "space_error": "手动配额已保存，但目录用量统计失败：OpenList 权限不足"
    }]
  }
}
```

`status` 为 `work/disabled/error`，容量未知用 null 表示，前端不得显示成 0 B 或假百分比。`space_error` 为容量不可用的具体原因，可为 null。驱动的 `total_space=0` 不作为有效总配额，兼容 GoogleDrive 的无限配额。

### 6.2 设置总配额

`PUT /api/v1/storages/{storage_id}/space`，请求 `{"total_space_bytes": 1099511627776}`，总配额须为正整数且不超过 2^63−1。响应 `data` 为更新后的单个存储节点。

先读取原生 `mount_details`；列表缺失时再查挂载根目录。只有缺少已用容量时才统计当前挂载目录，查询/统计共享 30 秒预算，并限制 1000 个目录及 100000 个文件。有独立子挂载、读取失败、分页不完整或超预算时保持未知。配额保存成功与容量统计成功是两件事，界面需展示 `space_error`。

以上存储接口均需要认证，不返回 `addition`、账号密码或刷新令牌。

---

## 7. 模块 5: 存储分组 (Storage Groups)

分组路径按最长挂载前缀解析，支持多级挂载。响应同时提供完整 `storage_paths` 与结构化 `paths`（`id/storage_mount/folder_path`），前端请求使用 `/storage-groups`。

### 7.1 获取所有存储分组
- **路径**：`GET /api/v1/storage-groups`
- **认证**：需要 Bearer Token
- **描述**：获取系统中配置的所有存储分组及分组下绑定的挂载目录列表。

#### 请求参数
无

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/storage-groups" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "groups": [
      {
        "id": 1,
        "name": "主力组",
        "storage_paths": [
          "/OD/Video1",
          "/OD/Video2",
          "/OD1/Video1"
        ],
        "created_at": "2026-09-01T10:00:00Z",
        "updated_at": "2026-09-06T12:00:00Z"
      },
      {
        "id": 2,
        "name": "备用组",
        "storage_paths": [
          "/OD1/Video2"
        ],
        "created_at": "2026-09-02T11:00:00Z",
        "updated_at": "2026-09-02T11:00:00Z"
      }
    ]
  }
}
```

---

### 7.2 创建存储分组
- **路径**：`POST /api/v1/storage-groups`
- **认证**：需要 Bearer Token
- **描述**：创建新的存储分组，并关联指定的存储目录路径。

#### 请求参数 (Body)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `name` | string | 是 | 分组名称（唯一），如 `"主力组"` |
| `storage_paths` | array[string] | 是 | 包含的存储挂载路径列表，至少包含 1 个有效路径 |

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/storage-groups" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "主力组",
    "storage_paths": [
      "/OD/Video1",
      "/OD/Video2",
      "/OD1/Video1"
    ]
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "name": "主力组",
    "storage_paths": [
      "/OD/Video1",
      "/OD/Video2",
      "/OD1/Video1"
    ],
    "created_at": "2026-09-06T19:53:00Z",
    "updated_at": "2026-09-06T19:53:00Z"
  }
}
```

---

### 7.3 更新存储分组
- **路径**：`PUT /api/v1/storage-groups/{group_id}`
- **认证**：需要 Bearer Token
- **描述**：更新指定分组的名称或包含的存储目录路径。

#### 路径参数 (Path)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `group_id` | integer | 是 | 存储分组 ID |

#### 请求参数 (Body)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `name` | string | 否 | 分组名称 |
| `storage_paths` | array[string] | 否 | 存储挂载路径列表 |

#### 请求示例
```bash
curl -X PUT "http://localhost:8000/api/v1/storage-groups/1" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "主力核心组",
    "storage_paths": [
      "/OD/Video1",
      "/OD/Video2"
    ]
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "name": "主力核心组",
    "storage_paths": [
      "/OD/Video1",
      "/OD/Video2"
    ],
    "updated_at": "2026-09-06T19:54:00Z"
  }
}
```

---

### 7.4 删除存储分组
- **路径**：`DELETE /api/v1/storage-groups/{group_id}`
- **认证**：需要 Bearer Token
- **描述**：根据分组 ID 删除存储分组。

#### 路径参数 (Path)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `group_id` | integer | 是 | 存储分组 ID |

#### 请求示例
```bash
curl -X DELETE "http://localhost:8000/api/v1/storage-groups/1" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "deleted": true
  }
}
```

---

## 8. 模块 6: 番号统计 (Codes)

### 8.1 获取番号统计列表
- **路径**：`GET /api/v1/codes`
- **认证**：需要 Bearer Token
- **描述**：分页查询已发现并归档在库中的番号记录，支持按分组过滤及关键字模糊搜索。

#### 查询参数 (Query)
| 字段 | 类型 | 必选 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `group_id` | integer | 否 | `null` | 存储分组 ID 筛选 |
| `search` | string | 否 | `null` | 番号关键字模糊匹配（如 `"ABC"`） |
| `page` | integer | 否 | `1` | 当前页码 |
| `page_size` | integer | 否 | `50` | 每页返回条数，最大 200 |

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/codes?group_id=1&search=ABC&page=1&page_size=50" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 100,
    "page": 1,
    "page_size": 50,
    "items": [
      {
        "code": "ABC-123",
        "storage_path": "/OD/Video1",
        "file_name": "ABC-123.mp4",
        "file_size": 1073741824,
        "discovered_at": "2026-09-06T15:30:00Z"
      },
      {
        "code": "ABC-124",
        "storage_path": "/OD/Video1",
        "file_name": "ABC-124.mkv",
        "file_size": 2147483648,
        "discovered_at": "2026-09-06T15:31:00Z"
      }
    ]
  }
}
```

---

### 8.2 触发番号扫描
- **路径**：`POST /api/v1/codes/scan`
- **认证**：需要 Bearer Token
- **描述**：异步启动扫描后台任务，根据系统配置中的探测路径 (`probe_paths`) 遍历指定存储分组下的网盘文件，解析提取番号并存入统计数据库。

#### 请求参数 (Body)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `group_id` | integer | 否 | 指定需扫描的存储分组 ID；若不传或传 `null`，则扫描全部配置的分组 |

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/codes/scan" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "group_id": 1
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "scan-e41ac820-21a1-460d-9b57-61c0d54a2a11",
    "status": "scanning",
    "group_id": 1
  }
}
```

---

### 8.3 获取扫描任务状态
- **路径**：`GET /api/v1/codes/scan/status`
- **认证**：需要 Bearer Token
- **描述**：查询当前正在进行中或最近一次完成的番号探测扫描任务进度。

#### 查询参数 (Query)
| 字段 | 类型 | 必选 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `task_id` | string | 否 | `null` | 扫描任务 ID；不传则返回最新一次扫描任务的状态 |

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/codes/scan/status" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "scan-e41ac820-21a1-460d-9b57-61c0d54a2a11",
    "status": "scanning",
    "scanned_files": 1250,
    "new_codes_found": 86,
    "current_path": "/OD/Video1/Archive",
    "progress_percent": 65.4,
    "started_at": "2026-09-06T19:50:00Z",
    "completed_at": null,
    "error_message": null
  }
}
```

---

### 8.4 从统计表删除指定番号
- **路径**：`DELETE /api/v1/codes/{code}`
- **认证**：需要 Bearer Token
- **描述**：从番号统计表中移除某个番号的记录（注意：该操作仅清理数据库元数据记录，不会删除物理文件）。

#### 路径参数 (Path)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `code` | string | 是 | 番号字符串，例如 `"ABC-123"` |

#### 请求示例
```bash
curl -X DELETE "http://localhost:8000/api/v1/codes/ABC-123" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "code": "ABC-123",
    "deleted": true
  }
}
```

---

## 9. 模块 7: 在线配置 (Config)

### 9.1 读取与局部保存

`GET /api/v1/config` 返回 `openlist/filter/bt_parser/probe_paths`。密码与令牌使用固定掩码 `****`，空值仍为空字符串。

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "openlist": {"base_url": "http://openlist:5244", "auth_type": "password", "username": "admin", "password": "****", "token": ""},
    "filter": {"allowed_extensions": [".mp4", ".mkv", ".avi", ".ts", ".wmv"], "min_file_size_mb": 100, "blacklist_patterns": [], "code_patterns": []},
    "bt_parser": {"service_url": "http://magnet-metadata-api:8080", "token": "", "timeout_seconds": 45},
    "probe_paths": []
  }
}
```

`PUT /api/v1/config` 仅更新显式提交的字段，嵌套字段同样保留未提交项。掩码回传表示保留原凭据，空字符串表示清空。URL 仅接受 http/https，禁止嵌入凭据、查询参数、片段和非法端口；解析超时范围为 1～300 秒。

例如只改变解析等待时间：

```json
{"bt_parser": {"timeout_seconds": 90}}
```

### 9.2 测试 OpenList

`POST /api/v1/config/test-connection` 接受可选的 `base_url/auth_type/username/password/token`。请求值与已保存配置合并，掩码保留已有凭据；不会保存测试参数。验证 OpenList 管理员权限，成功返回 `connected/version/latency_ms`；版本无法读取时为 null。

OpenList 上游请求使用原始 Authorization 令牌。该 Kuroko 接口自身仍使用 JWT Bearer 认证。失败为 HTTP 502、业务码 50201，不透传上游错误正文。

### 9.3 测试元数据服务

`POST /api/v1/config/test-bt-parser` 支持临时 `service_url/token/timeout_seconds`；省略字段使用已保存配置，同样不写入数据库。

```json
{"service_url": "http://magnet-metadata-api:8080", "token": "", "timeout_seconds": 45}
```

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "connected": true,
    "service_name": "magnet-metadata-api",
    "latency_ms": 25,
    "stats": {"active_torrents": 2, "active_locks": 1}
  }
}
```

上游检查端点为 `GET /api/v1/health`，返回 `status: ok` 与 `stats`。仅展示上游实际返回的计数，不伪造 DHT 连通状态。可选 token 仅用于外部认证代理；原始服务没有内建鉴权。失败为 HTTP 502、业务码 50202。所有配置接口均需要认证。

---

## 10. 附录：数据字典与枚举定义

### 10.1 任务状态 (`TaskStatus`)
| 枚举值 | 描述 |
| :--- | :--- |
| `pending` | 等待调度/准备中 |
| `downloading` | 离线下载进行中 |
| `completed` | 当前阶段完成；离线完成不代表转存完成或已入库 |
| `failed` | 下载失败或 OpenList 离线错误 |
| `cancelled` | OpenList 已确认取消 |

### 10.2 存储空间来源 (`SpaceSource`)
| 枚举值 | 描述 |
| :--- | :--- |
| `openlist` | 由 OpenList API 自动汇报获取 |
| `manual` | 总配额由管理员指定，剩余空间仍依赖完整用量 |

### 10.3 过滤原因 (`FilterReason`)
| 枚举值 | 描述 |
| :--- | :--- |
| `extension` | 文件扩展名不在允许列表 (`allowed_extensions`) 中 |
| `size` | 文件大小低于最小限制 (`min_file_size_mb`) |
| `blacklist_pattern` | 文件名命中广告或黑名单正则表达式 (`blacklist_patterns`) |


### 10.4 OpenList 数字状态映射

| state | Kuroko 状态 | 处理 |
| :--- | :--- | :--- |
| 0、5、8、9 | pending | 等待、出错后待重试等非终态，继续同步 |
| 1、3、6 | downloading | 运行、取消中、重试中，继续同步 |
| 2 | completed | 仅当前阶段成功 |
| 4 | cancelled | 已确认取消 |
| 7 | failed | 重试耗尽，失败终态 |

接口基线与上游 HTTP 契约见 [架构设计](architecture.md#5-上游接入与任务边界)。
