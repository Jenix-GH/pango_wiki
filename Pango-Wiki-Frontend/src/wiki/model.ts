import type {
  WikiCatalog,
  WikiDirectory,
  WikiDocument,
  WikiDocumentGroup,
  WikiFilterOption,
} from './types'

const VERSION_PATTERN = /\d+(?:\.\d+)*/
const DERIVED_COPY_PATTERN = /(?:^|[_-])clean[_-]?pages(?:[_\-.]|$)/i
const IP_GUIDE_PATTERN = /(?:^|[^A-Za-z0-9])IP(?:$|[^A-Za-z0-9])/i

export function catalogDocuments(catalog: WikiCatalog | null): WikiDocument[] {
  if (!catalog) return []
  return catalog.series.flatMap((series) => series.documents)
}

export function groupDocuments(documents: WikiDocument[]): WikiDocumentGroup[] {
  const groups = new Map<string, WikiDocument[]>()
  for (const document of documents) {
    const id = document.group_key || `${document.series_key}:${document.code}`
    const existing = groups.get(id)
    if (existing) existing.push(document)
    else groups.set(id, [document])
  }
  return Array.from(groups, ([id, versions]) => {
    const sorted = [...versions].sort(compareDocuments)
    return { id, current: sorted[0], history: sorted.slice(1) }
  })
}

export function catalogDirectories(catalog: WikiCatalog | null): WikiDirectory[] {
  if (!catalog) return []
  if (catalog.directories?.length) return catalog.directories
  return legacyDirectories(catalog)
}

export function directoryMap(nodes: WikiDirectory[]): Map<string, WikiDirectory> {
  const result = new Map<string, WikiDirectory>()
  const visit = (items: WikiDirectory[]) => {
    for (const item of items) {
      result.set(item.key, item)
      visit(item.children)
    }
  }
  visit(nodes)
  return result
}

export function directoryPath(nodes: WikiDirectory[], target: string): WikiDirectory[] {
  for (const node of nodes) {
    if (node.key === target) return [node]
    const childPath = directoryPath(node.children, target)
    if (childPath.length) return [node, ...childPath]
  }
  return []
}

export function directoryCounts(
  groups: WikiDocumentGroup[],
  nodes: WikiDirectory[],
): Map<string, number> {
  const counts = new Map<string, number>()
  const keys = new Set<string>()
  const collect = (items: WikiDirectory[]) => {
    for (const node of items) {
      keys.add(node.key)
      collect(node.children)
    }
  }
  collect(nodes)
  for (const group of groups) {
    const documentKeys = effectiveDirectoryKeys(group.current)
    for (const key of documentKeys) {
      if (keys.has(key)) counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return counts
}

export function groupMatchesDirectory(group: WikiDocumentGroup, key: string): boolean {
  return effectiveDirectoryKeys(group.current).includes(key)
}

export function filterOptions(
  groups: WikiDocumentGroup[],
  selectedNode: WikiDirectory | undefined,
  allTypes: Array<{ key: string; name: string }>,
  counts: Map<string, number>,
): WikiFilterOption[] {
  const all: WikiFilterOption = { key: 'all', name: '全部', count: groups.length, type: 'all' }
  if (selectedNode?.node_type !== 'section' && selectedNode?.children.length) {
    return [
      all,
      ...selectedNode.children.map((node) => ({
        key: node.key,
        name: node.name,
        count: counts.get(node.key) || 0,
        type: 'directory' as const,
      })),
    ]
  }

  const kindCounts = new Map<string, number>()
  for (const group of groups) {
    const kind = group.current.kind
    kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1)
  }
  const kinds = allTypes
    .filter((kind) => (kindCounts.get(kind.key) || 0) > 0)
    .map((kind) => ({
      key: `kind:${kind.key}`,
      name: kind.name,
      count: kindCounts.get(kind.key) || 0,
      type: 'kind' as const,
    }))
  return [all, ...kinds]
}

export function effectiveDirectoryKeys(document: WikiDocument): string[] {
  if (document.directory_keys?.length) return document.directory_keys
  const keys = [`section:device`, `dataset:${document.series_key}`]
  if (document.kind === 'DS') keys.push(`directory:${document.series_key}:datasheet`)
  if (document.kind === 'UG') {
    const isIp = IP_GUIDE_PATTERN.test(`${document.title}\n${document.file_name}`)
    keys.push(`directory:${document.series_key}:${isIp ? 'ip-guide' : 'device-guide'}`)
  }
  return keys
}

export function documentLabel(document: WikiDocument): string {
  return document.display_name || document.code
}

export function versionLabel(document: WikiDocument): string {
  return document.version && document.version !== '—' ? document.version : '未标注'
}

export function formatDate(value: string, includeTime = false): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date)
}

export function formatSyncTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (deltaSeconds < 60) return '刚刚'
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)} 分钟前`
  return formatDate(value, true)
}

export function isSoftwareScope(groups: WikiDocumentGroup[]): boolean {
  return groups.length > 0 && groups.every((group) => group.current.kind === 'SW')
}

function compareDocuments(left: WikiDocument, right: WikiDocument): number {
  const a = versionParts(left.version)
  const b = versionParts(right.version)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (b[index] || 0) - (a[index] || 0)
    if (delta !== 0) return delta
  }
  const artifactDelta = Number(isDerivedCopy(left)) - Number(isDerivedCopy(right))
  if (artifactDelta !== 0) return artifactDelta
  return Date.parse(right.updated_at || '') - Date.parse(left.updated_at || '')
}

function versionParts(value: string): number[] {
  const match = String(value || '').match(VERSION_PATTERN)
  return match ? match[0].split('.').map((part) => Number.parseInt(part, 10) || 0) : [0]
}

function isDerivedCopy(document: WikiDocument): boolean {
  return DERIVED_COPY_PATTERN.test(document.file_name || '')
}

function legacyDirectories(catalog: WikiCatalog): WikiDirectory[] {
  const series = catalog.series.map((item) => ({
    key: `dataset:${item.key}`,
    name: item.name,
    node_type: 'dataset' as const,
    dataset_key: item.key,
    children: [
      { key: `directory:${item.key}:device-guide`, name: '器件用户指南', node_type: 'directory' as const, dataset_key: item.key, children: [] },
      { key: `directory:${item.key}:ip-guide`, name: 'IP 用户指南', node_type: 'directory' as const, dataset_key: item.key, children: [] },
      { key: `directory:${item.key}:datasheet`, name: '数据手册', node_type: 'directory' as const, dataset_key: item.key, children: [] },
    ],
  }))
  return [{ key: 'section:device', name: '器件文档', node_type: 'section', section_key: 'device', children: series }]
}
