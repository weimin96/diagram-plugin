import { FolderOpenIcon } from 'lucide-react'
import type { FeedbackActionId, FeedbackState } from './panelFeedback.js'

export interface FeedbackBarProps {
  feedback: FeedbackState
  onAction: (action: FeedbackActionId) => void
}

/**
 * One arbiter decides which message the panel is allowed to shout about
 * (`panelFeedback`); this only renders that decision — the primary banner plus
 * the rest collapsed into single rows so seven competing banners never stack.
 */
export function FeedbackBar({ feedback, onAction }: FeedbackBarProps) {
  return (
    <>
      {feedback.primary ? (
        <div className={`feedback-banner is-${feedback.primary.severity}`} data-feedback={feedback.primary.id} role={feedback.primary.severity === 'error' ? 'alert' : 'status'}>
          <div className="feedback-banner-copy">
            <strong>{feedback.primary.title}</strong>
            {feedback.primary.detail ? <span>{feedback.primary.detail}</span> : null}
          </div>
          {feedback.primary.actions.length ? (
            <div className="feedback-banner-actions">
              {feedback.primary.actions.map((action) => (
                <button key={action.id} className={action.primary ? 'primary-button compact' : undefined} type="button" disabled={action.disabled} onClick={() => onAction(action.id)}>{action.label}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {feedback.overflow.length ? (
        <div className="feedback-overflow" role="status">
          {feedback.overflow.map((item) => (
            <div key={item.id} className={`feedback-row is-${item.severity}`} data-feedback={item.id}>
              <span className="feedback-row-text">{item.title}{item.detail ? ` · ${item.detail}` : ''}</span>
              {item.actions.length ? (
                <span className="feedback-row-actions">
                  {item.actions.map((action) => (
                    <button key={action.id} className={action.primary ? 'primary-button compact' : undefined} type="button" disabled={action.disabled} onClick={() => onAction(action.id)}>{action.label}</button>
                  ))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

export interface EmptyStateProps {
  threadSurface: boolean
  onOpenList: () => void
  onCreate: () => void
  onGenerate: () => void
}

/** Nothing is open. The panel and the workspace offer the same three ways in. */
export function EmptyState({ threadSurface, onOpenList, onCreate, onGenerate }: EmptyStateProps) {
  return (
    <div className="main-empty">
      <div className="empty-graphic"><span /><span /><span /></div>
      <h2>{threadSurface ? '未打开图表' : '选择或创建一个图表'}</h2>
      <p>{threadSurface ? '打开当前项目中已保存的图表，或者新建画板。' : '结构化图使用 Mermaid；自由布局的架构草图和说明使用 Canvas 文档。'}</p>
      <div className="empty-actions">
        {threadSurface ? (
          <>
            <button className="primary-button" type="button" onClick={onOpenList}><FolderOpenIcon size={16} />打开已有图表</button>
            <button type="button" onClick={onCreate}>新建图表</button>
            <button type="button" onClick={onGenerate}>生成图表</button>
          </>
        ) : (
          <>
            <button className="primary-button" type="button" onClick={onCreate}>新建图表</button>
            <button type="button" onClick={onGenerate}>从代码生成</button>
          </>
        )}
      </div>
    </div>
  )
}
