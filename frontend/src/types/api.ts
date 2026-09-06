export type ApiResult<T> = { code: number; message: string; data: T }

export type User = { id: number; username: string; role: string; created_at?: string }

export type Task = {
  task_id: string
  code: string
  status: string
  progress: number
  target_path: string
  speed?: string | null
  error_message?: string | null
  magnet?: string
  total_size?: number
  downloaded_size?: number
  openlist_task_id?: string | null
  created_at?: string
  updated_at?: string
}

export type Config = {
  openlist: { base_url: string; auth_type: string; username: string; password?: string; token?: string }
  filter: { allowed_extensions: string[]; min_file_size_mb: number; blacklist_patterns: string[] }
  bt_parser: { service_url: string; token?: string }
  probe_paths: unknown[]
}

export type MagnetFile = { name: string; size: number; filtered?: boolean; filter_reason?: string }

export type MagnetResult = {
  cleaned_magnet: string
  verified_code?: string | null
  exists_in_library: boolean
  files: MagnetFile[]
}

export type CodeRecord = {
  code: string
  file_name: string
  storage_path: string
  file_size: number
  discovered_at: string
}

export type Storage = { id: number; mount_path: string; free_space?: number | null }
export type StorageGroup = { id: number; name: string; storage_paths: string[] }
