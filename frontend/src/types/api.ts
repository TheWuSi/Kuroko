/**
 * Kuroko 统一 API 响应结构
 */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

/**
 * 认证与用户
 */
export interface User {
  id: number
  username: string
  created_at: string
}

export interface LoginResponse {
  token: string
  token_type: string
  expires_in: number
  user: User
}

export interface SystemStatus {
  initialized: boolean
  authenticated: boolean
  user: User | null
  version: string
}

/**
 * 磁力解析结果
 */
export interface ParsedFileItem {
  name: string
  size: number
  filtered: boolean
  filter_reason?: 'extension' | 'size' | 'blacklist_pattern' | null
}

export interface MagnetParseItem {
  original_magnet: string
  cleaned_magnet: string
  dn_code: string | null
  verified_code: string | null
  total_files_count: number
  files: ParsedFileItem[]
  filtered_files: ParsedFileItem[]
  exists_in_library: boolean
  existing_location: string | null
  metadata_fallback?: boolean
  fallback_reason?: string | null
}

export interface MagnetParseResponse {
  results: MagnetParseItem[]
}

export interface DownloadTaskSubmitItem {
  magnet: string
  code: string
  force?: boolean
  target_group?: string | number
}

export interface BatchDownloadResponse {
  submitted: Array<{
    code: string
    task_id: string
    target_path: string
    openlist_task_id: string
  }>
  skipped: Array<{
    code: string
    reason: string
    existing_location: string
  }>
}

/**
 * 离线下载任务
 */
export type TaskStatusType = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'

export interface DownloadTask {
  id: number
  task_id: string
  code: string
  magnet: string
  status: TaskStatusType
  progress: number
  speed: string | null
  total_size: number
  downloaded_size: number
  target_path: string
  openlist_task_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface TaskListResponse {
  total: number
  page: number
  page_size: number
  items: DownloadTask[]
}

/**
 * 番号归档
 */
export interface CodeRecord {
  code: string
  storage_path: string
  file_name: string
  file_size: number
  discovered_at: string
  source?: 'scan' | 'download'
}

export interface CodeListResponse {
  total: number
  page: number
  page_size: number
  items: CodeRecord[]
}

export interface ScanJobStatus {
  task_id: string
  status: 'pending' | 'scanning' | 'completed' | 'failed' | 'cancelled'
  scanned_files: number
  new_codes_found: number
  current_path: string | null
  progress_percent: number
  started_at: string
  completed_at: string | null
  error_message: string | null
}

/**
 * 存储管理
 */
export interface StorageNodeInfo {
  id: number
  mount_path: string
  driver: string
  status: string
  total_space: number | null
  used_space: number | null
  free_space: number | null
  space_source: 'openlist' | 'manual'
}

export interface StorageGroupPath {
  id: number
  storage_mount: string
  folder_path: string
}

export interface StorageGroup {
  id: number
  name: string
  paths: StorageGroupPath[]
  created_at: string
}

/**
 * 系统配置
 */
export interface OpenListConfig {
  base_url: string
  auth_type: 'password' | 'token'
  username?: string
  password?: string
  token?: string
}

export interface FilterConfig {
  allowed_extensions: string[]
  min_file_size_mb: number
  blacklist_patterns: string[]
}

export interface BtParserConfig {
  service_url: string
  token?: string
  timeout_seconds?: number
}

export interface ProbePathGroup {
  group_name: string
  paths: Array<{
    storage_mount: string
    folder: string
  }>
}

export interface SystemConfigData {
  openlist: OpenListConfig
  filter: FilterConfig
  bt_parser: BtParserConfig
  probe_paths: ProbePathGroup[]
}

export interface ConnectionTestResult {
  connected: boolean
  version?: string | null
  latency_ms?: number | null
  service_name?: string | null
}
