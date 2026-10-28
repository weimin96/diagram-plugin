/**
 * 对话跟随的纯决策：面板每 1.3s 读到一次 `diagram.threadState`，由这里判断该不该切换图表。
 *
 * 关键不变量：跟随失败必须能被区分。旧实现在 `dirty` 时直接静默返回，用户看不到任何信号，
 * 一次未保存的编辑就会让面板永久停在旧图上；这里把「暂停」和「忽略」拆成不同结果，
 * 并把「消费 revision」和「切换」分开——只有真正处理完的结果才允许调用方推进 updatedAt。
 */
export type ThreadFollowInput = {
  /** 服务端当前对话状态的时间戳；空值表示对话里还没有图表活动。 */
  updatedAt: string | undefined
  /** 面板已经处理过的时间戳。 */
  lastUpdatedAt: string | undefined
  /** 服务端当前候选的 revision。 */
  proposalRevision: string | undefined
  /** 面板已经加载的候选 revision。 */
  knownProposalRevision: string | undefined
  /** 面板刚打开、需要一次性跳过恢复的对话选中项。 */
  skipRestored: boolean
  /** 用户是否打开「跟随」按钮。 */
  followEnabled: boolean
  /** 面板里是否存在未保存修改。 */
  dirty: boolean
  /** 对话状态里记录的当前图。 */
  activePath: string | undefined
  /** 面板当前选中的图。 */
  selectedPath: string | undefined
}

export type ThreadFollowDecision =
  /** 没有新状态，或状态与候选都没变：什么都不做，也不消费。 */
  | { kind: 'ignore' }
  /** 一次性跳过恢复的选中项，消费当前 revision。 */
  | { kind: 'skip' }
  /** 用户主动关闭跟随，消费当前 revision，恢复后不补跳。 */
  | { kind: 'user-paused' }
  /** 有未保存修改：不消费 revision，保存或撤销后自动补上这次跟随。 */
  | { kind: 'dirty-paused' }
  /** 对话里已经没有当前图，需要刷新列表并处理被删除的选中项。 */
  | { kind: 'no-active' }
  /** 对话仍指向同一张图，只刷新焦点。 */
  | { kind: 'focus' }
  /** 切换到对话指向的图。 */
  | { kind: 'switch'; path: string }

export function decideThreadFollow(input: ThreadFollowInput): ThreadFollowDecision {
  if (!input.updatedAt) return { kind: 'ignore' }
  const stateUnchanged = input.updatedAt === input.lastUpdatedAt
  const proposalUnchanged = input.proposalRevision === input.knownProposalRevision
  if (stateUnchanged && proposalUnchanged) return { kind: 'ignore' }
  if (input.skipRestored) return { kind: 'skip' }
  if (!input.followEnabled) return { kind: 'user-paused' }
  if (input.dirty) return { kind: 'dirty-paused' }
  if (!input.activePath) return { kind: 'no-active' }
  if (input.activePath === input.selectedPath) return { kind: 'focus' }
  return { kind: 'switch', path: input.activePath }
}
