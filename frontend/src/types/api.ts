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
  role?: string
  created_at: string
}

export interface BootstrapStatus {
  initialized: boolean
}

export interface TokenData {
  token: string
  token_type: string
  expires_at: string
}

export interface LoginResponse {
  token: string
  refresh_token?: string
  token_type: string
  expires_at: string
  refresh_expires_at?: string
}

export interface SystemStatus {
  initialized: boolean
  authenticated: boolean
  user: User | null
  version?: string
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

export type CodeVariant = 'original' | 'C' | 'UC' | 'U'

export interface TargetScope {
  target_group?: string | number
  target_path?: string
}

export interface DuplicateDecision {
  exists_in_library: boolean
  duplicate_blocked: boolean
  duplicate_allowed: boolean
  existing_location: string | null
  scope_group_ids?: number[]
  dedup_scope?: 'group' | 'directory' | 'unselected'
}

export interface MagnetParseItem extends DuplicateDecision {
  original_magnet: string
  cleaned_magnet: string
  dn_code: string | null
  verified_code: string | null
  variant: CodeVariant
  part_numbers: number[] | null
  total_files_count: number
  total_size: number
  info_hash: string
  files: ParsedFileItem[]
  filtered_files: ParsedFileItem[]
  exists_in_library: boolean
  existing_location: string | null
  metadata_fallback?: boolean
  fallback_reason?: string | null
}

export interface MagnetParseResponse {
  results: MagnetParseItem[]
  errors?: Array<{ index: number; magnet: string; message: string }>
}

export interface DownloadTaskSubmitItem {
  magnet: string
  code: string
  variant?: CodeVariant
  force?: boolean
  target_group?: string | number
  target_path?: string
}

export interface BatchDownloadResponse {
  submitted: Array<{
    index: number
    magnet: string
    code: string
    task_id: string
    target_path: string
    openlist_task_id: string
    total_size: number
    metadata_fallback: boolean
  }>
  skipped: Array<{
    index: number
    magnet: string
    code: string
    reason: string
    existing_location: string
    task_id?: string
  }>
  failed: Array<{
    index: number
    magnet: string
    code: string
    reason: string
    message: string
    task_id?: string | null
  }>
}

/**
 * 离线下载任务
 */
export type TaskStatusType = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'

export interface DownloadTask {
  task_id: string
  code: string
  variant: CodeVariant
  part_numbers: number[] | null
  magnet: string
  status: TaskStatusType
  progress: number
  speed: string | null
  total_size: number
  downloaded_size: number
  downloaded_size_is_estimate: boolean
  phase: 'offline_download'
  target_path: string
  openlist_task_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface TransferTask {
  task_id: string
  name: string
  phase: 'offline_download_transfer'
  status: TaskStatusType
  state: number
  status_detail: string
  progress: number
  total_size: number
  downloaded_size: number
  downloaded_size_is_estimate: boolean
  error_message: string | null
  start_time: string | null
  end_time: string | null
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
  id: number
  code: string
  variant: CodeVariant
  part_number: number | null
  storage_path: string
  file_name: string
  file_size: number
  discovered_at: string
  source?: 'scan' | 'download'
}

export interface CodeListResponse {
  total: number
  total_codes: number
  page: number
  page_size: number
  items: CodeRecord[]
}

export interface ScanJobStatus {
  task_id: string
  group_id: number | null
  status: 'pending' | 'scanning' | 'completed' | 'failed' | 'cancelled'
  scanned_files: number
  scanned_dirs: number
  total_roots: number
  completed_roots: number
  scan_paths: string[]
  cancel_requested: boolean
  new_codes_found: number
  duplicates_found: number
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
  space_error?: string | null
  ignored: boolean
}

export interface StorageMemberInput {
  storage_id: number
  download_path: string
  archive_paths: string[]
  priority: number
}

export interface StorageMember extends Omit<StorageMemberInput, 'storage_id'> {
  id: number
  storage_id: number | null
  storage_mount: string
}

export interface StorageIgnore {
  storage_id: number
  storage_mount: string
}

export interface DirectoryListing {
  path: string
  mount_path: string
  directories: Array<{ name: string; path: string }>
}

export interface StorageGroupPath {
  id: number
  storage_mount: string
  folder_path: string
  priority: number
}

export interface StorageGroup {
  id: number
  name: string
  paths: StorageGroupPath[]
  members: StorageMember[]
  storage_paths: string[]
  created_at: string
}

export interface DuplicateGroup {
  group_id: number
  group_name: string
  code: string
  variants: CodeVariant[]
  allowed_variants: CodeVariant[]
  ignored: boolean
  can_ignore: boolean
  reason: 'same_version' | 'version_combination'
  files: Array<CodeRecord & { directory_matches: DirectoryMatch[] }>
}

export interface DirectoryMatch {
  storage_id: number | null
  storage_mount: string
  kind: 'download' | 'archive' | 'probe'
  path: string
}

export interface StorageRevision {
  source_id: string
  revision: number
}

export interface DuplicateAllowance {
  id: number
  group_id: number
  group_name: string
  code: string
  variants: CodeVariant[]
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
  stats?: {
    active_torrents?: number
    active_locks?: number
    dlq_entries?: number
    active_itorrents_requests?: number
  }
}
