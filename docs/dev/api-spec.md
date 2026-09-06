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
- 除登录接口 (`/api/v1/auth/login`) 外，所有请求均须在 HTTP Header 中携带身份令牌：
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
| `data` | null | 发生错误时固定为 `null` |

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
| `40002` | 非法的磁力链接格式 |
| `40003` | 目标存储空间不足 |
| `40101` | 用户名或密码错误 |
| `40102` | Token 缺失、无效或已过期 |
| `40301` | 无权访问该资源 |
| `40401` | 指定资源不存在（任务、分组或番号记录） |
| `40901` | 资源冲突（如分组名称已存在） |
| `50001` | 系统未知内部异常 |
| `50201` | OpenList 接口调用失败或未连接 |
| `50202` | BT 解析服务不可用或解析超时 |
| `50203` | OpenList 离线下载任务提交失败 |

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
- **路径**：`POST /api/v1/magnets/parse`
- **认证**：需要 Bearer Token
- **描述**：接收多个磁力链接，自动清理 tracker 参数、通过 `dn` 提取番号代码、调用后端/外部 BT 解析服务获取种子文件清单，并基于文件后缀、大小及黑名单规则进行过滤；同时与现有媒体库比对判断是否已下载。

#### 请求参数 (Body)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `magnet_links` | array[string] | 是 | 原始磁力链接数组，支持批量解析 |

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/magnets/parse" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "magnet_links": [
      "magnet:?xt=urn:btih:3b84175de6fbc02187f5d47e4b92b6a782b260f7&dn=ABC-123&tr=http://tracker.example.com/announce",
      "magnet:?xt=urn:btih:d3b07384d113edec49eaa6238ad5ff00&dn=DEF-456"
    ]
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "results": [
      {
        "original_magnet": "magnet:?xt=urn:btih:3b84175de6fbc02187f5d47e4b92b6a782b260f7&dn=ABC-123&tr=http://tracker.example.com/announce",
        "cleaned_magnet": "magnet:?xt=urn:btih:3b84175de6fbc02187f5d47e4b92b6a782b260f7&dn=ABC-123",
        "dn_code": "ABC-123",
        "verified_code": "ABC-123",
        "total_files_count": 2,
        "files": [
          {
            "name": "ABC-123.mp4",
            "size": 1073741824,
            "filtered": false
          }
        ],
        "filtered_files": [
          {
            "name": "promo_ad.txt",
            "size": 1024,
            "filtered": true,
            "filter_reason": "extension"
          }
        ],
        "exists_in_library": true,
        "existing_location": "/OD/Video1/ABC-123.mp4"
      },
      {
        "original_magnet": "magnet:?xt=urn:btih:d3b07384d113edec49eaa6238ad5ff00&dn=DEF-456",
        "cleaned_magnet": "magnet:?xt=urn:btih:d3b07384d113edec49eaa6238ad5ff00&dn=DEF-456",
        "dn_code": "DEF-456",
        "verified_code": "DEF-456",
        "total_files_count": 1,
        "files": [
          {
            "name": "DEF-456.mkv",
            "size": 2147483648,
            "filtered": false
          }
        ],
        "filtered_files": [],
        "exists_in_library": false,
        "existing_location": null
      }
    ]
  }
}
```

---

### 4.2 批量提交离线下载任务
- **路径**：`POST /api/v1/magnets/batch-download`
- **认证**：需要 Bearer Token
- **描述**：将选定的磁力任务提交至离线下载队列。系统会根据指定的存储分组智能选择可用空间最充足的存储节点，并将下载任务提交至 OpenList 客户端。若番号在库中已存在且 `force` 为 `false`，则自动跳过。

#### 请求参数 (Body)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `tasks` | array[object] | 是 | 任务列表 |
| `tasks[].magnet` | string | 是 | 磁力链接（推荐使用 cleaned_magnet） |
| `tasks[].code` | string | 是 | 识别的番号代码，如 `"ABC-123"` |
| `tasks[].force` | boolean | 否 | 是否强制重新下载（若已存在），默认为 `false` |
| `tasks[].target_group` | string / integer | 否 | 目标存储分组名称或 ID，不传则使用系统默认分组 |

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/magnets/batch-download" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "magnet": "magnet:?xt=urn:btih:d3b07384d113edec49eaa6238ad5ff00&dn=DEF-456",
        "code": "DEF-456",
        "force": false,
        "target_group": "group-1"
      },
      {
        "magnet": "magnet:?xt=urn:btih:3b84175de6fbc02187f5d47e4b92b6a782b260f7&dn=ABC-123",
        "code": "ABC-123",
        "force": false,
        "target_group": "group-1"
      }
    ]
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "submitted": [
      {
        "code": "DEF-456",
        "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
        "target_path": "/OD/Video1",
        "openlist_task_id": "op-task-88992"
      }
    ],
    "skipped": [
      {
        "code": "ABC-123",
        "reason": "already_exists",
        "existing_location": "/OD/Video1/ABC-123.mp4"
      }
    ]
  }
}
```

---

## 5. 模块 3: 下载任务 (Tasks)

### 5.1 获取所有下载任务列表
- **路径**：`GET /api/v1/tasks`
- **认证**：需要 Bearer Token
- **描述**：分页获取下载任务列表，支持按任务运行状态过滤。

#### 查询参数 (Query)
| 字段 | 类型 | 必选 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `status` | string | 否 | `null` | 任务状态筛选：`pending`, `downloading`, `completed`, `failed`, `cancelled` |
| `page` | integer | 否 | `1` | 当前页码，起始为 1 |
| `page_size` | integer | 否 | `20` | 每页记录数，最大不超过 100 |

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/tasks?status=downloading&page=1&page_size=20" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "items": [
      {
        "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
        "openlist_task_id": "op-task-88992",
        "code": "ABC-123",
        "magnet": "magnet:?xt=urn:btih:3b84175de6fbc02187f5d47e4b92b6a782b260f7&dn=ABC-123",
        "status": "downloading",
        "progress": 45.5,
        "speed": "2.4 MB/s",
        "target_path": "/OD/Video1",
        "total_size": 1073741824,
        "downloaded_size": 488552529,
        "error_message": null,
        "created_at": "2026-09-06T19:30:00Z",
        "updated_at": "2026-09-06T19:45:00Z"
      }
    ]
  }
}
```

---

### 5.2 获取单个任务详情
- **路径**：`GET /api/v1/tasks/{task_id}`
- **认证**：需要 Bearer Token
- **描述**：根据任务 UUID 查询具体任务的详细状态信息。

#### 路径参数 (Path)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 任务唯一标识 UUID |

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/tasks/4b7b2520-7b5c-4433-85f2-1bfa4430e7bb" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
    "openlist_task_id": "op-task-88992",
    "code": "ABC-123",
    "magnet": "magnet:?xt=urn:btih:3b84175de6fbc02187f5d47e4b92b6a782b260f7&dn=ABC-123",
    "status": "downloading",
    "progress": 45.5,
    "speed": "2.4 MB/s",
    "target_path": "/OD/Video1",
    "total_size": 1073741824,
    "downloaded_size": 488552529,
    "error_message": null,
    "created_at": "2026-09-06T19:30:00Z",
    "updated_at": "2026-09-06T19:45:00Z"
  }
}
```

#### 响应示例 (404 错误)
```json
{
  "code": 40401,
  "message": "任务不存在: 4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
  "data": null
}
```

---

### 5.3 取消/删除下载任务
- **路径**：`DELETE /api/v1/tasks/{task_id}`
- **认证**：需要 Bearer Token
- **描述**：取消并删除指定的下载任务。系统将调用 OpenList API 中止下载流程并清理临时记录。

#### 路径参数 (Path)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 任务唯一标识 UUID |

#### 查询参数 (Query)
| 字段 | 类型 | 必选 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `delete_files` | boolean | 否 | `false` | 是否同时删除已产生的未完成临时文件 |

#### 请求示例
```bash
curl -X DELETE "http://localhost:8000/api/v1/tasks/4b7b2520-7b5c-4433-85f2-1bfa4430e7bb?delete_files=true" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
    "status": "cancelled",
    "deleted": true
  }
}
```

---

### 5.4 手动同步 OpenList 离线下载进度
- **路径**：`POST /api/v1/tasks/sync`
- **认证**：需要 Bearer Token
- **描述**：主动触发从 OpenList 后端拉取所有离线下载任务的最新进度与状态，更新本地数据库记录并完成归档（若已下载完成）。

#### 请求参数
无

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/tasks/sync" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "synced_count": 2,
    "updated_tasks": [
      {
        "task_id": "4b7b2520-7b5c-4433-85f2-1bfa4430e7bb",
        "code": "ABC-123",
        "status": "completed",
        "progress": 100.0,
        "updated_at": "2026-09-06T19:50:00Z"
      },
      {
        "task_id": "8f12cc20-1122-3344-5566-778899aabbcc",
        "code": "DEF-456",
        "status": "downloading",
        "progress": 72.3,
        "updated_at": "2026-09-06T19:50:00Z"
      }
    ]
  }
}
```

---

## 6. 模块 4: 存储管理 (Storage)

### 6.1 获取所有存储节点信息
- **路径**：`GET /api/v1/storages`
- **认证**：需要 Bearer Token
- **描述**：从 OpenList 获取当前所有已挂载的存储节点列表，并综合本地空间统计信息，展示存储容量、剩余空间及配额获取来源。

#### 请求参数
无

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/storages" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "storages": [
      {
        "id": 1,
        "mount_path": "/OD",
        "driver": "PikPak",
        "status": "active",
        "total_space": 16106127360,
        "used_space": 10737418240,
        "free_space": 5368709120,
        "space_source": "openlist",
        "modified_at": "2026-09-06T18:00:00Z"
      },
      {
        "id": 2,
        "mount_path": "/OD1",
        "driver": "PikPak",
        "status": "active",
        "total_space": 21474836480,
        "used_space": 12884901888,
        "free_space": 8589934592,
        "space_source": "manual",
        "modified_at": "2026-09-06T18:20:00Z"
      }
    ]
  }
}
```
> **字段说明**：
> - `space_source`：空间来源枚举，`"openlist"` 表示由 OpenList API 自动汇报；`"manual"` 表示由用户手动覆盖标记。

---

### 6.2 手动标记存储库总空间
- **路径**：`PUT /api/v1/storages/{storage_id}/space`
- **认证**：需要 Bearer Token
- **描述**：针对部分网盘驱动无法通过 OpenList 准确获取总容量的情况，允许管理员手动设置该存储库的总容量（单位：字节）。

#### 路径参数 (Path)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `storage_id` | integer | 是 | 存储节点 ID |

#### 请求参数 (Body)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `total_space_bytes` | integer | 是 | 总容量大小（单位：Bytes），必须大于 0 |

#### 请求示例
```bash
curl -X PUT "http://localhost:8000/api/v1/storages/1/space" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "total_space_bytes": 16106127360
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "mount_path": "/OD",
    "driver": "PikPak",
    "total_space": 16106127360,
    "used_space": 10737418240,
    "free_space": 5368709120,
    "space_source": "manual",
    "updated_at": "2026-09-06T19:52:00Z"
  }
}
```

---

## 7. 模块 5: 存储分组 (Storage Groups)

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

## 9. 模块 7: 系统配置 (Config)

### 9.1 获取所有可编辑配置
- **路径**：`GET /api/v1/config`
- **认证**：需要 Bearer Token
- **描述**：获取当前系统生效的所有配置参数，包括 OpenList 连接参数、文件过滤规则、BT 解析服务配置以及番号探测扫描路径。

#### 请求参数
无

#### 请求示例
```bash
curl -X GET "http://localhost:8000/api/v1/config" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "openlist": {
      "base_url": "http://localhost:5244",
      "auth_type": "password",
      "username": "admin",
      "token": ""
    },
    "filter": {
      "allowed_extensions": [
        ".mp4",
        ".mkv",
        ".avi"
      ],
      "min_file_size_mb": 100,
      "blacklist_patterns": [
        ".*广告.*",
        ".*@.*"
      ]
    },
    "bt_parser": {
      "service_url": "http://localhost:8080"
    },
    "probe_paths": [
      {
        "group_name": "OD组",
        "paths": [
          {
            "storage_mount": "/OD",
            "folder": "/Video1"
          },
          {
            "storage_mount": "/OD",
            "folder": "/Video2"
          }
        ]
      }
    ]
  }
}
```

---

### 9.2 更新配置（部分更新）
- **路径**：`PUT /api/v1/config`
- **认证**：需要 Bearer Token
- **描述**：更新系统配置项。采用局部覆盖 (Patch) 机制，客户端只需传输需要更改的顶级模块或字段，未传递的字段将保持不变。更新后即时生效并持久化。

#### 请求参数 (Body)
可包含 `openlist`, `filter`, `bt_parser`, `probe_paths` 中的任意一项或多项。

#### 请求示例 (只修改过滤规则)
```bash
curl -X PUT "http://localhost:8000/api/v1/config" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "allowed_extensions": [".mp4", ".mkv", ".ts"],
      "min_file_size_mb": 200,
      "blacklist_patterns": [".*广告.*", ".*@.*", ".*t.me.*"]
    }
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "openlist": {
      "base_url": "http://localhost:5244",
      "auth_type": "password",
      "username": "admin",
      "token": ""
    },
    "filter": {
      "allowed_extensions": [
        ".mp4",
        ".mkv",
        ".ts"
      ],
      "min_file_size_mb": 200,
      "blacklist_patterns": [
        ".*广告.*",
        ".*@.*",
        ".*t.me.*"
      ]
    },
    "bt_parser": {
      "service_url": "http://localhost:8080"
    },
    "probe_paths": [
      {
        "group_name": "OD组",
        "paths": [
          {
            "storage_mount": "/OD",
            "folder": "/Video1"
          },
          {
            "storage_mount": "/OD",
            "folder": "/Video2"
          }
        ]
      }
    ]
  }
}
```

---

### 9.3 测试 OpenList 连接
- **路径**：`POST /api/v1/config/test-connection`
- **认证**：需要 Bearer Token
- **描述**：测试 Kuroko 与 OpenList 实例的连通性与版本兼容性。支持传参临时测试（如在保存前验证表单输入），也可不传参直接测试当前已持久化的配置。

#### 请求参数 (Body - 可选)
| 字段 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `base_url` | string | 否 | OpenList 访问地址，如 `"http://localhost:5244"` |
| `auth_type` | string | 否 | `"password"` 或 `"token"` |
| `username` | string | 否 | 认证用户名 |
| `password` | string | 否 | 密码（若使用 password 方式） |
| `token` | string | 否 | OpenList API Token（若使用 token 方式） |

#### 请求示例
```bash
curl -X POST "http://localhost:8000/api/v1/config/test-connection" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "http://localhost:5244",
    "auth_type": "password",
    "username": "admin",
    "password": "password123"
  }'
```

#### 响应示例 (成功)
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "connected": true,
    "version": "3.42.0",
    "latency_ms": 18
  }
}
```

#### 响应示例 (失败)
```json
{
  "code": 50201,
  "message": "无法连接到 OpenList 服务: Connection refused at http://localhost:5244",
  "data": null
}
```

---

## 10. 附录：数据字典与枚举定义

### 10.1 任务状态 (`TaskStatus`)
| 枚举值 | 描述 |
| :--- | :--- |
| `pending` | 等待调度/准备中 |
| `downloading` | 离线下载进行中 |
| `completed` | 下载完成并归档完毕 |
| `failed` | 下载失败或 OpenList 离线错误 |
| `cancelled` | 用户主动取消并终止 |

### 10.2 存储空间来源 (`SpaceSource`)
| 枚举值 | 描述 |
| :--- | :--- |
| `openlist` | 由 OpenList API 自动汇报获取 |
| `manual` | 由管理员手动指定并锁定 |

### 10.3 过滤原因 (`FilterReason`)
| 枚举值 | 描述 |
| :--- | :--- |
| `extension` | 文件扩展名不在允许列表 (`allowed_extensions`) 中 |
| `size` | 文件大小低于最小限制 (`min_file_size_mb`) |
| `blacklist_pattern` | 文件名命中广告或黑名单正则表达式 (`blacklist_patterns`) |
