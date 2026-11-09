import { useState } from 'react'
import { Button, Input, Popconfirm, Spin, Typography } from 'antd'
import type { SessionSummary } from '@suagent/shared/session'

interface SessionSidebarProps {
  sessions: SessionSummary[]
  currentSessionId: string | null
  isLoading: boolean
  isBusy: boolean
  onCreate: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => Promise<boolean>
  onDelete: (id: string) => void
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  isLoading,
  isBusy,
  onCreate,
  onSelect,
  onRename,
  onDelete,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const beginRename = (session: SessionSummary) => {
    setEditingId(session.id)
    setDraftTitle(session.title)
  }

  const saveRename = async (id: string) => {
    const saved = await onRename(id, draftTitle)
    if (saved) setEditingId(null)
  }

  return (
    <aside className="session-sidebar">
      <div className="session-sidebar-heading">
        <Typography.Title level={5}>会话</Typography.Title>
        <Button type="primary" onClick={onCreate} disabled={isBusy}>
          新建
        </Button>
      </div>
      {isLoading ? (
        <div className="session-loading">
          <Spin size="small" />
        </div>
      ) : (
        <div className="session-list">
          {sessions.length === 0 ? (
            <Typography.Text type="secondary">暂无会话</Typography.Text>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === currentSessionId
              const isEditing = session.id === editingId

              return (
                <div
                  className={`session-list-item${isActive ? ' active' : ''}`}
                  key={session.id}
                >
                  {isEditing ? (
                    <div className="session-title-editor">
                      <Input
                        autoFocus
                        aria-label="编辑会话标题"
                        maxLength={15}
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onPressEnter={() => void saveRename(session.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <Button
                        type="link"
                        disabled={!draftTitle.trim() || isBusy}
                        onClick={() => void saveRename(session.id)}
                      >
                        保存
                      </Button>
                      <Button type="link" onClick={() => setEditingId(null)}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="session-select"
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        disabled={isBusy}
                        onClick={() => onSelect(session.id)}
                      >
                        <Typography.Text className="session-title" ellipsis>
                          {session.title}
                        </Typography.Text>
                        <Typography.Text
                          className="session-activity"
                          type="secondary"
                        >
                          {new Date(session.lastActivityAt).toLocaleDateString()}
                        </Typography.Text>
                      </button>
                      <div className="session-actions">
                        <Button
                          type="text"
                          size="small"
                          disabled={isBusy}
                          onClick={() => beginRename(session)}
                        >
                          改名
                        </Button>
                        <Popconfirm
                          title="删除这个会话？"
                          description="删除后无法恢复。"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => onDelete(session.id)}
                        >
                          <Button type="text" size="small" danger disabled={isBusy}>
                            删除
                          </Button>
                        </Popconfirm>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </aside>
  )
}
