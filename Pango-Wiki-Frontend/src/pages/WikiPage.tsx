import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isMiniProgramEntry, returnToMiniProgramQa } from '../utils/miniProgramBridge'
import { openReferenceUrl } from '../utils/referenceUrl'
import { loadWikiCatalog } from '../wiki/api'
import { BookIcon, ChatIcon, DocumentIcon, RefreshIcon, SearchIcon } from '../wiki/icons'
import {
  catalogDirectories,
  catalogDocuments,
  directoryCounts,
  directoryMap,
  directoryPath,
  filterOptions,
  formatSyncTime,
  groupDocuments,
  groupMatchesDirectory,
  isSoftwareScope,
} from '../wiki/model'
import type { WikiCatalog, WikiDocument, WikiDocumentGroup } from '../wiki/types'
import WikiDirectoryTree from '../wiki/WikiDirectoryTree'
import WikiDocumentTable from '../wiki/WikiDocumentTable'
import pangoLogo from '../../Logo.png'
import './WikiPage.css'

type SortMode = 'code' | 'updated'

const PAGE_SIZE = 20

export default function WikiPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const wikiMainRef = useRef<HTMLElement>(null)
  const [catalog, setCatalog] = useState<WikiCatalog | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedDirectory, setSelectedDirectory] = useState('all')
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<Set<string>>(() => new Set())
  const [activeFilter, setActiveFilter] = useState('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sortMode, setSortMode] = useState<SortMode>('code')
  const [page, setPage] = useState(1)
  const [expandedGroup, setExpandedGroup] = useState('')
  const [historyGroups, setHistoryGroups] = useState<Set<string>>(() => new Set())
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [miniProgramClient, setMiniProgramClient] = useState(isMiniProgramEntry)
  const [returningToMiniProgram, setReturningToMiniProgram] = useState(false)
  const [navigationError, setNavigationError] = useState('')

  useEffect(() => {
    if (miniProgramClient) return
    const detectMiniProgram = () => {
      if (isMiniProgramEntry()) setMiniProgramClient(true)
    }
    const detectionTimer = window.setTimeout(detectMiniProgram, 500)
    document.addEventListener('WeixinJSBridgeReady', detectMiniProgram)
    return () => {
      window.clearTimeout(detectionTimer)
      document.removeEventListener('WeixinJSBridgeReady', detectMiniProgram)
    }
  }, [miniProgramClient])

  const applyCatalog = useCallback((nextCatalog: WikiCatalog) => {
    const nextDirectories = catalogDirectories(nextCatalog)
    const nextDirectoryMap = directoryMap(nextDirectories)
    setCatalog(nextCatalog)
    setLoadError('')
    setSelectedDirectory((current) => current === 'all' || nextDirectoryMap.has(current) ? current : 'all')
    setExpandedDirectoryKeys((current) => {
      const next = new Set(current)
      nextDirectories.forEach((node) => next.add(node.key))
      return next
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadWikiCatalog({ signal: controller.signal })
      .then(applyCatalog)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : '文档目录暂时不可用')
      })
    return () => controller.abort()
  }, [applyCatalog])

  const directories = useMemo(() => catalogDirectories(catalog), [catalog])
  const nodesByKey = useMemo(() => directoryMap(directories), [directories])
  const allDocuments = useMemo(() => catalogDocuments(catalog), [catalog])
  const allGroups = useMemo(() => groupDocuments(allDocuments), [allDocuments])
  const counts = useMemo(() => directoryCounts(allGroups, directories), [allGroups, directories])
  const selectedNode = selectedDirectory === 'all' ? undefined : nodesByKey.get(selectedDirectory)

  const scopedGroups = useMemo(
    () => selectedDirectory === 'all'
      ? allGroups
      : allGroups.filter((group) => groupMatchesDirectory(group, selectedDirectory)),
    [allGroups, selectedDirectory],
  )

  const availableTypes = useMemo(() => {
    if (catalog?.document_types?.length) {
      return catalog.document_types.map((item) => ({ key: item.key, name: item.name }))
    }
    return Array.from(new Set(allGroups.map((group) => group.current.kind)))
      .map((kind) => ({ key: kind, name: kind }))
  }, [allGroups, catalog])

  const filters = useMemo(
    () => filterOptions(scopedGroups, selectedNode, availableTypes, counts),
    [availableTypes, counts, scopedGroups, selectedNode],
  )

  useEffect(() => {
    if (!filters.some((filter) => filter.key === activeFilter)) setActiveFilter('all')
  }, [activeFilter, filters])

  const visibleGroups = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('zh-CN')
    const filtered = scopedGroups.filter((group) => {
      if (activeFilter.startsWith('kind:') && group.current.kind !== activeFilter.slice(5)) return false
      if (activeFilter !== 'all' && !activeFilter.startsWith('kind:') && !groupMatchesDirectory(group, activeFilter)) return false
      if (!normalizedQuery) return true
      const searchable = [group.current, ...group.history]
        .map((document) => [
          document.code,
          document.display_name,
          document.title,
          document.file_name,
          document.series,
          document.section,
          document.version,
        ].join(' '))
        .join(' ')
        .toLocaleLowerCase('zh-CN')
      return searchable.includes(normalizedQuery)
    })

    return [...filtered].sort((left, right) => {
      if (sortMode === 'updated') {
        return Date.parse(right.current.updated_at || '') - Date.parse(left.current.updated_at || '')
      }
      const leftLabel = left.current.display_name || left.current.code
      const rightLabel = right.current.display_name || right.current.code
      return leftLabel.localeCompare(rightLabel, 'zh-CN', { numeric: true })
    })
  }, [activeFilter, deferredQuery, scopedGroups, sortMode])

  const totalPages = Math.max(1, Math.ceil(visibleGroups.length / PAGE_SIZE))
  const pagedGroups = useMemo(
    () => visibleGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, visibleGroups],
  )

  useEffect(() => {
    setPage(1)
    setExpandedGroup('')
  }, [activeFilter, deferredQuery, selectedDirectory, sortMode])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const selectDirectory = useCallback((key: string) => {
    setSelectedDirectory(key)
    setActiveFilter('all')
    setDirectoryOpen(false)
    if (wikiMainRef.current) wikiMainRef.current.scrollTop = 0
    if (key === 'all') return
    const path = directoryPath(directories, key)
    setExpandedDirectoryKeys((current) => {
      const next = new Set(current)
      path.forEach((node) => next.add(node.key))
      return next
    })
  }, [directories])

  useEffect(() => {
    if (!directoryOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDirectoryOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [directoryOpen])

  const toggleDirectory = useCallback((key: string) => {
    setExpandedDirectoryKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const refreshCatalog = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setActionError('')
    try {
      applyCatalog(await loadWikiCatalog({ refresh: true }))
    } catch (error) {
      setActionError(error instanceof Error ? `目录刷新失败：${error.message}` : '目录刷新失败，请稍后重试。')
    } finally {
      setRefreshing(false)
    }
  }, [applyCatalog, refreshing])

  const openDocument = useCallback((document: WikiDocument) => {
    setActionError('')
    if (document.action_disabled) {
      setActionError(document.source_status || '该文件当前不可用，请刷新目录后重试。')
      return
    }
    if (miniProgramClient && document.action_type !== 'download') {
      navigate(`/wiki/reader?url=${encodeURIComponent(document.viewer_url)}`)
      return
    }
    if (!openReferenceUrl(document.viewer_url)) {
      setActionError('文档阅读链接无效，请稍后重试。')
    }
  }, [miniProgramClient, navigate])

  const downloadDocument = useCallback((document: WikiDocument) => {
    setActionError('')
    if (document.action_disabled) {
      setActionError(document.source_status || '该文件当前不可用，请刷新目录后重试。')
      return
    }
    const downloadUrl = document.download_url
      || (document.action_type === 'download' ? document.viewer_url : '')
    if (!downloadUrl || !openReferenceUrl(downloadUrl)) {
      setActionError('文档下载链接无效，请稍后重试。')
    }
  }, [])

  const toggleHistory = useCallback((groupId: string) => {
    setHistoryGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const toggleExpanded = useCallback((groupId: string) => {
    setExpandedGroup((current) => current === groupId ? '' : groupId)
  }, [])

  const openSmartQa = useCallback(async () => {
    setNavigationError('')
    if (!miniProgramClient) {
      navigate('/')
      return
    }
    if (returningToMiniProgram) return

    setReturningToMiniProgram(true)
    const result = await returnToMiniProgramQa()
    if (result === 'bridge-unavailable') {
      setNavigationError('当前页面未能连接小程序，请使用微信左上角返回按钮回到慧答。')
    } else if (result === 'navigation-failed') {
      setNavigationError('暂时无法返回小程序慧答，请使用微信左上角返回按钮后重试。')
    }
    setReturningToMiniProgram(false)
  }, [miniProgramClient, navigate, returningToMiniProgram])

  const openUserDestination = useCallback(() => {
    if (miniProgramClient) {
      void openSmartQa()
      return
    }
    navigate(user ? '/' : '/login')
  }, [miniProgramClient, navigate, openSmartQa, user])

  const selectedPath = useMemo(
    () => selectedDirectory === 'all' ? [] : directoryPath(directories, selectedDirectory),
    [directories, selectedDirectory],
  )
  const selectedTitle = selectedNode?.name || '全部文档'
  const selectedFilterName = filters.find((filter) => filter.key === activeFilter)?.name || '全部'
  const softwareScope = isSoftwareScope(scopedGroups)
  const firstColumnLabel = softwareScope
    ? '文档名称'
    : scopedGroups.some((group) => group.current.kind === 'SW')
      ? '文档编号/名称'
      : '文档编号'
  const searchPlaceholder = softwareScope
    ? '搜索软件工具、文档标题或版本'
    : '搜索文档编号、器件系列或功能模块'

  return (
    <div className={`wiki-page ${directoryOpen ? 'is-directory-open' : ''}`}>
      <header className="wiki-header">
        <button type="button" className="wiki-brand" onClick={() => selectDirectory('all')}>
          <img src={pangoLogo} alt="Pango" />
          <span>Pango 器件 Wiki</span>
        </button>
        <nav className="wiki-primary-nav" aria-label="主导航">
          <button type="button" className="active">
            <DocumentIcon />
            器件文档
          </button>
          <button
            type="button"
            onClick={() => void openSmartQa()}
            disabled={returningToMiniProgram}
            aria-busy={returningToMiniProgram}
            title={miniProgramClient ? '返回小程序慧答' : '进入智能问答'}
          >
            <ChatIcon />
            {returningToMiniProgram ? '正在返回' : miniProgramClient ? '返回慧答' : '智能问答'}
          </button>
        </nav>
        <div className="wiki-header-meta">
          <div className="wiki-kb-name"><BookIcon size={19} />知识库：Pango 官方文档知识库</div>
          <button
            type="button"
            className="wiki-user"
            onClick={openUserDestination}
            disabled={returningToMiniProgram}
            title={miniProgramClient ? '返回小程序慧答' : user ? '返回智能问答' : '登录'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
            </svg>
            <span>{user?.nickName || '访客'}</span>
          </button>
        </div>
      </header>

      <div className="wiki-shell">
        <aside id="wikiDirectoryPanel" className={`wiki-sidebar ${directoryOpen ? 'is-mobile-open' : ''}`} aria-label="文档目录">
          <div className="wiki-sidebar-title">
            <span>文档目录</span>
            <button type="button" className="wiki-mobile-directory-close" onClick={() => setDirectoryOpen(false)} aria-label="关闭文档目录">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="wiki-series-list">
            <WikiDirectoryTree
              nodes={directories}
              selectedKey={selectedDirectory}
              expandedKeys={expandedDirectoryKeys}
              counts={counts}
              totalCount={allGroups.length}
              onSelect={selectDirectory}
              onToggle={toggleDirectory}
            />
          </div>
          <div className="wiki-source-note">
            <div><span className="wiki-info-dot">i</span>文档来源：Pango 官方文档 <span className="wiki-online-dot" /></div>
            <div>目录同步：{catalog ? formatSyncTime(catalog.generated_at) : '—'}</div>
            {catalog?.partial ? <div className="wiki-partial">部分知识库暂未同步</div> : null}
          </div>
        </aside>

        <button
          type="button"
          className="wiki-mobile-directory-backdrop"
          onClick={() => setDirectoryOpen(false)}
          aria-label="关闭文档目录"
          hidden={!directoryOpen}
        />

        <main ref={wikiMainRef} className="wiki-main">
          {navigationError ? <div className="wiki-navigation-error" role="alert">{navigationError}</div> : null}
          <div className="wiki-main-heading">
            <div className="wiki-main-title">
              <button
                type="button"
                className="wiki-mobile-directory-toggle"
                aria-controls="wikiDirectoryPanel"
                aria-expanded={directoryOpen}
                onClick={() => setDirectoryOpen(true)}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                目录
              </button>
              <h1>{selectedTitle}</h1>
            </div>
            <button type="button" className="wiki-refresh" onClick={refreshCatalog} disabled={refreshing}>
              <RefreshIcon className={refreshing ? 'is-spinning' : ''} />
              {refreshing ? '正在刷新' : '刷新目录'}
            </button>
          </div>

          <label className="wiki-search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>

          <div className="wiki-toolbar">
            <div className="wiki-kind-tabs" role="tablist" aria-label="文档筛选">
              {filters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={activeFilter === filter.key ? 'active' : ''}
                  onClick={() => setActiveFilter(filter.key)}
                  role="tab"
                  aria-selected={activeFilter === filter.key}
                >
                  {filter.name}<span>{filter.count}</span>
                </button>
              ))}
            </div>
            <label className="wiki-sort">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" />
              </svg>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="code">{softwareScope ? '文档名称' : '文档编号'}</option>
                <option value="updated">最近更新</option>
              </select>
            </label>
          </div>

          <div className="wiki-current-row">
            <span>当前位置：</span>
            {selectedPath.length ? selectedPath.map((node, index) => (
              <span key={node.key} className="wiki-breadcrumb-item">
                {index > 0 ? <span className="wiki-path-separator">/</span> : null}
                <strong>{node.name}</strong>
              </span>
            )) : <strong>全部文档</strong>}
            {activeFilter !== 'all' ? <><span className="wiki-path-separator">/</span><strong>{selectedFilterName}</strong></> : null}
            <span>（{visibleGroups.length}）</span>
            {catalog ? <span className="wiki-total-raw">共 {catalog.document_count} 份文档（含历史版本）</span> : null}
          </div>

          {loadError ? (
            <div className="wiki-state wiki-state-error">
              <h2>文档目录暂时不可用</h2>
              <p>{loadError}</p>
              <button type="button" onClick={() => window.location.reload()}>重新加载</button>
            </div>
          ) : !catalog ? (
            <div className="wiki-state">正在加载文档目录…</div>
          ) : (
            <WikiDocumentTable
              groups={pagedGroups}
              firstColumnLabel={firstColumnLabel}
              actionError={actionError}
              expandedGroup={expandedGroup}
              historyGroups={historyGroups}
              page={page}
              totalPages={totalPages}
              totalCount={visibleGroups.length}
              onOpen={openDocument}
              onDownload={downloadDocument}
              onToggleExpanded={toggleExpanded}
              onToggleHistory={toggleHistory}
              onPageChange={setPage}
            />
          )}
        </main>
      </div>
    </div>
  )
}
