import { Fragment } from 'react'
import { BookIcon, ChevronIcon, DownloadIcon } from './icons'
import { documentLabel, formatDate, versionLabel } from './model'
import type { WikiDocument, WikiDocumentGroup } from './types'

interface WikiDocumentTableProps {
  groups: WikiDocumentGroup[]
  firstColumnLabel: string
  actionError: string
  expandedGroup: string
  historyGroups: Set<string>
  page: number
  totalPages: number
  totalCount: number
  onOpen: (document: WikiDocument) => void
  onDownload: (document: WikiDocument) => void
  onToggleExpanded: (groupId: string) => void
  onToggleHistory: (groupId: string) => void
  onPageChange: (page: number) => void
}

export default function WikiDocumentTable({
  groups,
  firstColumnLabel,
  actionError,
  expandedGroup,
  historyGroups,
  page,
  totalPages,
  totalCount,
  onOpen,
  onDownload,
  onToggleExpanded,
  onToggleHistory,
  onPageChange,
}: WikiDocumentTableProps) {
  return (
    <div className="wiki-table-wrap">
      {actionError ? <div className="wiki-action-error" role="alert">{actionError}</div> : null}
      <table className="wiki-table">
        <thead>
          <tr>
            <th>{firstColumnLabel}</th>
            <th>文档标题</th>
            <th>版本</th>
            <th>文档类型</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const expanded = expandedGroup === group.id
            const historyVisible = historyGroups.has(group.id)
            const statusClass = group.current.source_status_code || 'ready'
            const actionLabel = group.current.action_label
              || (group.current.action_type === 'download' ? '下载' : '在线阅读')
            const ActionIcon = group.current.action_type === 'download' ? DownloadIcon : BookIcon
            const downloadOnly = group.current.action_type === 'download'
            const canDownload = Boolean(group.current.download_url)
            return (
              <Fragment key={group.id}>
                <tr className={expanded || historyVisible ? 'is-expanded' : ''}>
                  <td className="wiki-cell-code" data-label={firstColumnLabel}>
                    <button type="button" className="wiki-code" onClick={() => onToggleExpanded(group.id)}>
                      {documentLabel(group.current)}
                    </button>
                  </td>
                  <td className="wiki-cell-title" data-label="文档标题">{group.current.title}</td>
                  <td className="wiki-cell-version" data-label="版本">
                    <span className="wiki-version">{versionLabel(group.current)}</span>
                    <span className="wiki-current-badge">当前</span>
                  </td>
                  <td className="wiki-cell-kind" data-label="文档类型">
                    <span className={`wiki-kind wiki-kind-${group.current.kind.toLowerCase()}`} title={group.current.kind_label}>
                      {group.current.kind}
                    </span>
                  </td>
                  <td className="wiki-cell-actions" data-label="操作">
                    <div className="wiki-row-actions">
                      <button
                        type="button"
                        className={downloadOnly ? 'wiki-download-action' : undefined}
                        onClick={() => downloadOnly ? onDownload(group.current) : onOpen(group.current)}
                        disabled={group.current.action_disabled}
                        title={group.current.action_disabled ? group.current.source_status : actionLabel}
                      >
                        <ActionIcon size={17} />{actionLabel}
                      </button>
                      {!downloadOnly && canDownload ? (
                        <button
                          type="button"
                          className="wiki-download-action"
                          onClick={() => onDownload(group.current)}
                          disabled={group.current.action_disabled}
                          title={group.current.action_disabled ? group.current.source_status : '下载'}
                        >
                          <DownloadIcon size={17} />下载
                        </button>
                      ) : null}
                      {group.history.length > 0 ? (
                        <button type="button" className="wiki-history-toggle" onClick={() => onToggleHistory(group.id)}>
                          历史版本 {group.history.length}<ChevronIcon expanded={historyVisible} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="wiki-expand"
                        onClick={() => onToggleExpanded(group.id)}
                        aria-label={expanded ? '收起文档详情' : '展开文档详情'}
                      >
                        <ChevronIcon expanded={expanded} />
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="wiki-detail-row">
                    <td className="wiki-detail-cell" colSpan={5}>
                      <div className="wiki-document-detail">
                        <dl>
                          <div><dt>文件名</dt><dd>{group.current.file_name}</dd></div>
                          <div><dt>所在目录</dt><dd>{group.current.section || group.current.series}</dd></div>
                          <div><dt>版本</dt><dd>{versionLabel(group.current)}</dd></div>
                          <div><dt>更新时间</dt><dd>{formatDate(group.current.updated_at, true)}</dd></div>
                          <div><dt>文档类型</dt><dd>{group.current.kind_label || group.current.kind}</dd></div>
                          <div><dt>文件大小</dt><dd>{group.current.size_label}</dd></div>
                          <div>
                            <dt>文档状态</dt>
                            <dd><span className={`wiki-status-dot wiki-status-${statusClass}`} />{group.current.source_status}</dd>
                          </div>
                          <div><dt>知识片段</dt><dd>{group.current.chunk_count || '—'}</dd></div>
                        </dl>
                        <div className="wiki-detail-actions">
                          <button
                            type="button"
                            className={`wiki-primary-action${downloadOnly ? ' wiki-download-action' : ''}`}
                            onClick={() => downloadOnly ? onDownload(group.current) : onOpen(group.current)}
                            disabled={group.current.action_disabled}
                            title={group.current.action_disabled ? group.current.source_status : actionLabel}
                          >
                            <ActionIcon size={17} />{actionLabel}
                          </button>
                          {!downloadOnly && canDownload ? (
                            <button
                              type="button"
                              className="wiki-primary-action wiki-download-action"
                              onClick={() => onDownload(group.current)}
                              disabled={group.current.action_disabled}
                              title={group.current.action_disabled ? group.current.source_status : '下载'}
                            >
                              <DownloadIcon size={17} />下载
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {historyVisible ? group.history.map((document) => {
                  const historyActionLabel = document.action_label
                    || (document.action_type === 'download' ? '下载' : '阅读此版本')
                  const HistoryActionIcon = document.action_type === 'download' ? DownloadIcon : BookIcon
                  const historyDownloadOnly = document.action_type === 'download'
                  const historyCanDownload = Boolean(document.download_url)
                  return (
                    <tr key={document.key} className="wiki-history-row">
                      <td className="wiki-cell-code" data-label={firstColumnLabel}><span className="wiki-history-label">历史</span>{documentLabel(document)}</td>
                      <td className="wiki-cell-title" data-label="文档标题">{document.title}<span className="wiki-history-file">{document.file_name}</span></td>
                      <td className="wiki-cell-version" data-label="版本">{versionLabel(document)}</td>
                      <td className="wiki-cell-kind" data-label="文档类型"><span className={`wiki-kind wiki-kind-${document.kind.toLowerCase()}`}>{document.kind}</span></td>
                      <td className="wiki-cell-actions" data-label="操作">
                        <div className="wiki-history-actions">
                          <button
                            type="button"
                            className={`wiki-history-read${historyDownloadOnly ? ' wiki-download-action' : ''}`}
                            onClick={() => historyDownloadOnly ? onDownload(document) : onOpen(document)}
                            disabled={document.action_disabled}
                            title={document.action_disabled ? document.source_status : historyActionLabel}
                          >
                            <HistoryActionIcon size={16} />{historyActionLabel}
                          </button>
                          {!historyDownloadOnly && historyCanDownload ? (
                            <button
                              type="button"
                              className="wiki-download-action"
                              onClick={() => onDownload(document)}
                              disabled={document.action_disabled}
                              title={document.action_disabled ? document.source_status : '下载此版本'}
                            >
                              <DownloadIcon size={16} />下载
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                }) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {totalCount === 0 ? <div className="wiki-empty">没有找到匹配的文档</div> : null}
      <div className="wiki-pagination">
        <span>共 {totalCount} 项当前版本</span>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} aria-label="上一页">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <strong>{page}</strong><span>/ {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))} aria-label="下一页">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
    </div>
  )
}
