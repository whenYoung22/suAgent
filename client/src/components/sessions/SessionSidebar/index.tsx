import { useState } from 'react'
import { Button, Input, Modal, Spin, Typography } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  FormOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import type { SessionSummary } from '@suagent/shared/session'
import './index.css'

interface SessionSidebarProps {
  sessions: SessionSummary[]
  currentSessionId: string | null
  isLoading: boolean
  isBusy: boolean
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  onCreate: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  isLoading,
  isBusy,
  isCollapsed = false,
  onToggleCollapse,
  onCreate,
  onSelect,
  onRename,
  onDelete,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [deletingSession, setDeletingSession] =
    useState<SessionSummary | null>(null)

  const beginRename = (session: SessionSummary) => {
    setEditingId(session.id)
    setDraftTitle(session.title)
  }

  const saveRename = async (id: string) => {
    const saved = await onRename(id, draftTitle)
    if (saved) setEditingId(null)
  }

  return (
    <aside className={`session-sidebar${isCollapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-copy">
          <Typography.Text className="sidebar-brand-name">suAgent</Typography.Text>
          <Typography.Text className="sidebar-brand-caption">
            Agent Streaming Workspace
          </Typography.Text>
        </div>
        {onToggleCollapse && (
          <Button
            className="sidebar-toggle"
            type="text"
            aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
            title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
            icon={isCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggleCollapse}
          />
        )}
      </div>

      <div className="session-new-chat">
        <Button
          className="session-create-button"
          type="text"
          aria-label="新聊天"
          title="新聊天"
          onClick={onCreate}
          disabled={isBusy}
        >
          <FormOutlined aria-hidden="true" />
          <span>新聊天</span>
        </Button>
      </div>
      {isLoading ? (
        <div className="session-sidebar-loading">
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
                          <EditOutlined aria-hidden="true" />
                          改名
                        </Button>
                        <Button
                          type="text"
                          size="small"
                          danger
                          disabled={isBusy}
                          onClick={() => setDeletingSession(session)}
                        >
                          <DeleteOutlined aria-hidden="true" />
                          删除
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
      <div className="sidebar-user">
        <span className="sidebar-user-avatar">苏</span>
        <Typography.Text className="sidebar-user-name">苏小蕾</Typography.Text>
      </div>
      <Modal
        title={
          deletingSession
            ? `删除会话「${deletingSession.title}」？`
            : '删除这个会话？'
        }
        open={deletingSession !== null}
        centered
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: isBusy }}
        onCancel={() => setDeletingSession(null)}
        onOk={async () => {
          if (!deletingSession) return
          await onDelete(deletingSession.id)
          setDeletingSession(null)
        }}
      >
        <p>删除后无法恢复。</p>
      </Modal>
    </aside>
  )
}
