import type { WikiDirectory } from './types'
import { BookIcon, ChevronIcon, DocumentIcon, FolderIcon } from './icons'

interface WikiDirectoryTreeProps {
  nodes: WikiDirectory[]
  selectedKey: string
  expandedKeys: Set<string>
  counts: Map<string, number>
  totalCount: number
  onSelect: (key: string) => void
  onToggle: (key: string) => void
}

export default function WikiDirectoryTree({
  nodes,
  selectedKey,
  expandedKeys,
  counts,
  totalCount,
  onSelect,
  onToggle,
}: WikiDirectoryTreeProps) {
  return (
    <div className="wiki-directory-tree" role="tree" aria-label="Wiki 文档目录">
      <button
        type="button"
        role="treeitem"
        aria-selected={selectedKey === 'all'}
        className={`wiki-tree-row wiki-tree-all ${selectedKey === 'all' ? 'active' : ''}`}
        onClick={() => onSelect('all')}
      >
        <span className="wiki-tree-indent" />
        <BookIcon size={19} />
        <span className="wiki-tree-name">全部文档</span>
        <span className="wiki-count">{totalCount}</span>
      </button>
      {nodes.map((node) => (
        <DirectoryNode
          key={node.key}
          node={node}
          level={0}
          selectedKey={selectedKey}
          expandedKeys={expandedKeys}
          counts={counts}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

interface DirectoryNodeProps {
  node: WikiDirectory
  level: number
  selectedKey: string
  expandedKeys: Set<string>
  counts: Map<string, number>
  onSelect: (key: string) => void
  onToggle: (key: string) => void
}

function DirectoryNode({
  node,
  level,
  selectedKey,
  expandedKeys,
  counts,
  onSelect,
  onToggle,
}: DirectoryNodeProps) {
  const expandable = node.children.length > 0
  const expanded = expandable && expandedKeys.has(node.key)
  const active = selectedKey === node.key
  const Icon = node.node_type === 'section'
    ? DocumentIcon
    : node.node_type === 'dataset'
      ? FolderIcon
      : DocumentIcon

  const handleSelect = () => {
    onSelect(node.key)
  }

  return (
    <div className={`wiki-tree-node wiki-tree-node-${node.node_type}`} role="none">
      <button
        type="button"
        role="treeitem"
        aria-level={level + 1}
        aria-selected={active}
        aria-expanded={expandable ? expanded : undefined}
        className={`wiki-tree-row wiki-tree-level-${Math.min(level, 3)} ${active ? 'active' : ''}`}
        onClick={handleSelect}
      >
        <span
          className={`wiki-tree-chevron ${expandable ? '' : 'is-empty'}`}
          onClick={(event) => {
            if (!expandable) return
            event.stopPropagation()
            onToggle(node.key)
          }}
        >
          {expandable ? <ChevronIcon expanded={expanded} size={15} /> : null}
        </span>
        <Icon size={18} />
        <span className="wiki-tree-name">{node.name}</span>
        <span className="wiki-count">{counts.get(node.key) || 0}</span>
      </button>
      {expanded ? (
        <div className="wiki-tree-children" role="group">
          {node.children.map((child) => (
            <DirectoryNode
              key={child.key}
              node={child}
              level={level + 1}
              selectedKey={selectedKey}
              expandedKeys={expandedKeys}
              counts={counts}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
