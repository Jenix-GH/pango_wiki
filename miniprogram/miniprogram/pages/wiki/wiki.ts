export {}

const app = getApp()
const CATALOG_URL = 'https://aiapp.pangomicro.com/wiki/api/catalog'
const PAGE_SIZE = 20
const ALLOWED_DOCUMENT_PATHS = [
  '/references/viewer',
  '/references/document',
  '/references/download',
  '/references/cloud/viewer',
  '/references/cloud/document',
  '/references/cloud/download',
]

interface WikiDocument {
  key: string
  group_key?: string
  code: string
  display_name?: string
  kind: string
  kind_label?: string
  title: string
  file_name: string
  section?: string
  series_key: string
  series: string
  version: string
  chunk_count: number
  size_label: string
  updated_at: string
  source_status: string
  source_status_code?: string
  viewer_url: string
  download_url?: string
  directory_keys?: string[]
  action_type?: 'read' | 'download' | string
  action_label?: string
  action_disabled?: boolean
}

interface WikiDirectory {
  key: string
  name: string
  node_type: string
  children?: WikiDirectory[]
}

interface WikiCatalog {
  document_count: number
  generated_at: string
  partial: boolean
  document_types?: Array<{ key: string; name: string }>
  directories?: WikiDirectory[]
  series: Array<{ documents: WikiDocument[] }>
}

interface DocumentGroup {
  id: string
  current: WikiDocument
  history: WikiDocument[]
}

interface DocumentCard extends WikiDocument {
  id: string
  label: string
  versionText: string
  actionText: string
  canDownload: boolean
  historyCount: number
  history: Array<WikiDocument & { label: string; versionText: string; actionText: string; updatedText: string; canDownload: boolean }>
  expanded: boolean
}

interface FilterOption {
  key: string
  name: string
  count: number
}

interface DirectoryOption {
  key: string
  name: string
  count: number
  indent: number
}

interface ValueEvent {
  detail: { value: string | number }
}

interface DatasetEvent {
  currentTarget: { dataset: Record<string, unknown> }
}

type DocumentFileType = 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'pdf'

function versionParts(value: string): number[] {
  const match = String(value || '').match(/\d+(?:\.\d+)*/)
  return match ? match[0].split('.').map(part => Number(part) || 0) : [0]
}

function compareVersions(left: WikiDocument, right: WikiDocument): number {
  const a = versionParts(left.version)
  const b = versionParts(right.version)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (b[index] || 0) - (a[index] || 0)
    if (delta !== 0) return delta
  }
  return Date.parse(right.updated_at || '') - Date.parse(left.updated_at || '')
}

function groupDocuments(documents: WikiDocument[]): DocumentGroup[] {
  const grouped: Record<string, WikiDocument[]> = {}
  documents.forEach(document => {
    const id = document.group_key || `${document.series_key}:${document.code}`
    if (!grouped[id]) grouped[id] = []
    grouped[id].push(document)
  })
  return Object.keys(grouped).map(id => {
    const versions = grouped[id].slice().sort(compareVersions)
    return { id, current: versions[0], history: versions.slice(1) }
  })
}

function directoryKeys(document: WikiDocument): string[] {
  if (document.directory_keys && document.directory_keys.length) return document.directory_keys
  return [`section:device`, `dataset:${document.series_key}`]
}

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function resolveDocumentUrl(rawUrl: string): string {
  const candidate = String(rawUrl || '').trim().replace(/&amp;/g, '&')
  if (!candidate) return ''
  const origin = String(app.globalData.referenceHost || '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//i.test(origin)) return ''

  let resolved = candidate
  if (candidate.startsWith('//')) {
    resolved = `${origin.startsWith('https:') ? 'https:' : 'http:'}${candidate}`
  } else if (candidate.startsWith('/')) {
    resolved = `${origin}${candidate}`
  } else if (!/^https?:\/\//i.test(candidate)) {
    resolved = `${origin}/${candidate.replace(/^\.\//, '')}`
  }

  const normalizedOrigin = origin.toLowerCase()
  const normalizedUrl = resolved.toLowerCase()
  if (normalizedUrl !== normalizedOrigin && !normalizedUrl.startsWith(`${normalizedOrigin}/`)) return ''
  const pathWithQuery = resolved.slice(origin.length)
  const path = pathWithQuery.split(/[?#]/, 1)[0]
  return ALLOWED_DOCUMENT_PATHS.includes(path) ? resolved : ''
}

function documentFileType(document: WikiDocument): DocumentFileType | undefined {
  const match = String(document.file_name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  const extension = match ? match[1] : ''
  const supported: DocumentFileType[] = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf']
  return supported.includes(extension as DocumentFileType) ? extension as DocumentFileType : undefined
}

function flattenDirectories(nodes: WikiDirectory[], groups: DocumentGroup[], level = 0): DirectoryOption[] {
  const result: DirectoryOption[] = []
  nodes.forEach(node => {
    result.push({
      key: node.key,
      name: node.name,
      indent: Math.min(level, 3) * 28,
      count: groups.filter(group => directoryKeys(group.current).includes(node.key)).length,
    })
    result.push(...flattenDirectories(node.children || [], groups, level + 1))
  })
  return result
}

Page({
  data: {
    loading: true,
    refreshing: false,
    loadError: '',
    actionError: '',
    catalog: null as WikiCatalog | null,
    allGroups: [] as DocumentGroup[],
    cards: [] as DocumentCard[],
    filters: [] as FilterOption[],
    directories: [] as DirectoryOption[],
    selectedDirectory: 'all',
    selectedDirectoryName: '全部文档',
    activeFilter: 'all',
    query: '',
    sortMode: 'code',
    sortLabel: '文档编号',
    sortOptions: ['文档编号', '最近更新'],
    page: 1,
    totalPages: 1,
    resultCount: 0,
    directoryOpen: false,
    expandedId: '',
  },

  onLoad() {
    this.loadCatalog(false)
  },

  openChat() {
    wx.switchTab({ url: '/pages/main/main' })
  },

  openLicense() {
    wx.switchTab({ url: '/pages/license/license' })
  },

  noop() {},

  loadCatalog(refresh: boolean) {
    if (refresh) this.setData({ refreshing: true, actionError: '' })
    else this.setData({ loading: true, loadError: '' })
    const separator = CATALOG_URL.includes('?') ? '&' : '?'
    wx.request<WikiCatalog>({
      url: refresh ? `${CATALOG_URL}${separator}refresh=true` : CATALOG_URL,
      method: 'GET',
      header: refresh ? { 'Cache-Control': 'no-cache' } : {},
      success: result => {
        if (result.statusCode < 200 || result.statusCode >= 300 || !result.data) {
          this.setData({ loadError: `文档目录请求失败（${result.statusCode}）` })
          return
        }
        const catalog = result.data
        const documents = (catalog.series || []).reduce<WikiDocument[]>((all, series) => all.concat(series.documents || []), [])
        const allGroups = groupDocuments(documents)
        const directories = flattenDirectories(catalog.directories || [], allGroups)
        this.setData({ catalog, allGroups, directories, loadError: '' }, () => this.applyFilters(1))
      },
      fail: error => {
        console.error('文档目录加载失败', error)
        this.setData({ loadError: '文档目录暂时不可用，请检查网络后重试。' })
      },
      complete: () => this.setData({ loading: false, refreshing: false }),
    })
  },

  refreshCatalog() {
    if (!this.data.refreshing) this.loadCatalog(true)
  },

  retryCatalog() {
    this.loadCatalog(false)
  },

  applyFilters(page: number) {
    const query = this.data.query.trim().toLocaleLowerCase()
    const selectedDirectory = this.data.selectedDirectory
    let scoped = this.data.allGroups.filter(group => selectedDirectory === 'all' || directoryKeys(group.current).includes(selectedDirectory))
    const kindCounts: Record<string, number> = {}
    scoped.forEach(group => {
      const kind = group.current.kind || 'OTHER'
      kindCounts[kind] = (kindCounts[kind] || 0) + 1
    })
    const catalog = this.data.catalog as WikiCatalog | null
    const typeNames: Record<string, string> = {}
    ;(catalog?.document_types || []).forEach(type => { typeNames[type.key] = type.name })
    const filters: FilterOption[] = [{ key: 'all', name: '全部', count: scoped.length }]
    Object.keys(kindCounts).sort().forEach(kind => filters.push({ key: `kind:${kind}`, name: typeNames[kind] || kind, count: kindCounts[kind] }))
    const activeFilter = filters.some(filter => filter.key === this.data.activeFilter) ? this.data.activeFilter : 'all'
    if (activeFilter.startsWith('kind:')) scoped = scoped.filter(group => group.current.kind === activeFilter.slice(5))
    if (query) {
      scoped = scoped.filter(group => [group.current, ...group.history].some(document => [
        document.code,
        document.display_name,
        document.title,
        document.file_name,
        document.series,
        document.section,
        document.version,
      ].join(' ').toLocaleLowerCase().includes(query)))
    }
    scoped.sort((left, right) => {
      if (this.data.sortMode === 'updated') return Date.parse(right.current.updated_at || '') - Date.parse(left.current.updated_at || '')
      const a = left.current.display_name || left.current.code
      const b = right.current.display_name || right.current.code
      return a.localeCompare(b, 'zh-CN', { numeric: true })
    })
    const totalPages = Math.max(1, Math.ceil(scoped.length / PAGE_SIZE))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const cards = scoped.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE).map(group => ({
      ...group.current,
      id: group.id,
      label: group.current.display_name || group.current.code,
      versionText: group.current.version && group.current.version !== '—' ? group.current.version : '未标注',
      actionText: group.current.action_label || (group.current.action_type === 'download' ? '下载' : '在线阅读'),
      canDownload: group.current.action_type !== 'download' && Boolean(group.current.download_url),
      historyCount: group.history.length,
      history: group.history.map(document => ({
        ...document,
        label: document.display_name || document.code,
        versionText: document.version && document.version !== '—' ? document.version : '未标注',
        actionText: document.action_label || (document.action_type === 'download' ? '下载' : '阅读此版本'),
        updatedText: formatDate(document.updated_at),
        canDownload: document.action_type !== 'download' && Boolean(document.download_url),
      })),
      expanded: this.data.expandedId === group.id,
      updated_at: formatDate(group.current.updated_at),
    }))
    this.setData({ filters, activeFilter, cards, page: safePage, totalPages, resultCount: scoped.length })
  },

  inputSearch(event: ValueEvent) {
    this.setData({ query: String(event.detail.value || '') }, () => this.applyFilters(1))
  },

  selectFilter(event: DatasetEvent) {
    this.setData({ activeFilter: String(event.currentTarget.dataset.key || 'all'), expandedId: '' }, () => this.applyFilters(1))
  },

  openDirectory() {
    this.setData({ directoryOpen: true })
  },

  closeDirectory() {
    this.setData({ directoryOpen: false })
  },

  selectDirectory(event: DatasetEvent) {
    const key = String(event.currentTarget.dataset.key || 'all')
    const name = String(event.currentTarget.dataset.name || '全部文档')
    this.setData({ selectedDirectory: key, selectedDirectoryName: name, activeFilter: 'all', directoryOpen: false, expandedId: '' }, () => this.applyFilters(1))
  },

  changeSort(event: ValueEvent) {
    const updated = Number(event.detail.value) === 1
    this.setData({ sortMode: updated ? 'updated' : 'code', sortLabel: updated ? '最近更新' : '文档编号' }, () => this.applyFilters(1))
  },

  previousPage() {
    if (this.data.page > 1) this.applyFilters(this.data.page - 1)
  },

  nextPage() {
    if (this.data.page < this.data.totalPages) this.applyFilters(this.data.page + 1)
  },

  toggleCard(event: DatasetEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    this.setData({ expandedId: this.data.expandedId === id ? '' : id }, () => this.applyFilters(this.data.page))
  },

  openDocument(event: DatasetEvent) {
    this.setData({ actionError: '' })
    const key = String(event.currentTarget.dataset.key || '')
    const document = this.findDocument(key)
    if (!document) return
    if (document.action_disabled) {
      this.setData({ actionError: document.source_status || '该文件当前不可用。' })
      return
    }
    if (document.action_type === 'download') {
      this.downloadDocument(document)
      return
    }
    const viewerUrl = resolveDocumentUrl(document.viewer_url)
    if (!viewerUrl) {
      this.setData({ actionError: '文档阅读链接无效，请稍后重试。' })
      return
    }
    const webHost = String(app.globalData.qaHost || app.globalData.referenceHost || '').trim().replace(/\/$/, '')
    if (!/^https?:\/\//i.test(webHost)) {
      this.setData({ actionError: '文档阅读服务地址无效，请稍后重试。' })
      return
    }
    app.globalData._refViewerUrl = `${webHost}/docs/reader?client=miniprogram&entry=${Date.now()}&url=${encodeURIComponent(viewerUrl)}`
    wx.navigateTo({ url: '/pages/reference-viewer/reference-viewer' })
  },

  findDocument(key: string): WikiDocument | null {
    for (const group of this.data.allGroups) {
      const found = [group.current, ...group.history].find(document => document.key === key)
      if (found) return found
    }
    return null
  },

  downloadDocument(document: WikiDocument) {
    this.setData({ actionError: '' })
    if (document.action_disabled) {
      this.setData({ actionError: document.source_status || '该文件当前不可用。' })
      return
    }
    const downloadUrl = document.download_url
      || (document.action_type === 'download' ? document.viewer_url : '')
    const url = resolveDocumentUrl(downloadUrl)
    if (!url) {
      this.setData({ actionError: '文档下载链接无效，请稍后重试。' })
      return
    }
    wx.showLoading({ title: '正在下载', mask: true })
    wx.downloadFile({
      url,
      success: result => {
        if (result.statusCode < 200 || result.statusCode >= 300) {
          console.error('文档下载失败', result.statusCode, url)
          wx.showToast({ title: '下载失败', icon: 'none' })
          return
        }
        wx.openDocument({
          filePath: result.tempFilePath,
          fileType: documentFileType(document),
          showMenu: true,
          fail: error => {
            console.error('文档打开失败', error)
            wx.showToast({ title: '文档无法打开', icon: 'none' })
          },
        })
      },
      fail: error => {
        console.error('文档下载失败', error)
        wx.showToast({ title: '下载失败', icon: 'none' })
      },
      complete: () => wx.hideLoading(),
    })
  },

  downloadDocumentByKey(event: DatasetEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    const document = this.findDocument(key)
    if (document) this.downloadDocument(document)
  },
})
