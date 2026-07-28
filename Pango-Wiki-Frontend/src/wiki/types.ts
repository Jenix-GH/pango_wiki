export interface WikiDocument {
  key: string
  group_key?: string
  code: string
  display_name?: string
  kind: string
  kind_label?: string
  title: string
  file_name: string
  section_key?: string
  section?: string
  series_key: string
  series: string
  version: string
  chunk_count: number
  size_bytes: number
  size_label: string
  updated_at: string
  source_status: string
  source_status_code?: 'ready' | 'processing' | 'unparsed' | 'failed' | string
  viewer_url: string
  document_url: string
  directory_keys?: string[]
  source_type?: 'ragflow' | 'synology' | string
  action_type?: 'read' | 'download'
  action_label?: string
  action_disabled?: boolean
}

export interface WikiSeries {
  key: string
  name: string
  section_key?: string
  document_count: number
  current_document_count?: number
  ug_count: number
  ds_count: number
  sw_count?: number
  kind_counts?: Record<string, number>
  documents: WikiDocument[]
}

export interface WikiDirectory {
  key: string
  name: string
  node_type: 'section' | 'dataset' | 'directory'
  section_key?: string
  dataset_key?: string
  children: WikiDirectory[]
}

export interface WikiDocumentType {
  key: string
  name: string
  label: string
  document_count: number
}

export interface WikiCatalog {
  document_count: number
  current_document_count?: number
  ug_count: number
  ds_count: number
  sw_count?: number
  document_types?: WikiDocumentType[]
  directories?: WikiDirectory[]
  series: WikiSeries[]
  source: string
  generated_at: string
  partial: boolean
  failed_dataset_count: number
  config_version?: number
  cloud?: {
    enabled?: boolean
    credentials_configured?: boolean
    status?: string
    stale?: boolean
    document_count?: number
    published_document_count?: number
    skipped_document_count?: number
    configured_folders?: number
    successful_folders?: number
    warning_count?: number
    scanned_at?: string
  }
}

export interface WikiDocumentGroup {
  id: string
  current: WikiDocument
  history: WikiDocument[]
}

export interface WikiFilterOption {
  key: string
  name: string
  count: number
  type: 'all' | 'kind' | 'directory'
}
