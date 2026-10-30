export type ArchitectureDiagramStyle = 'enterprise' | 'engineering'

export const architectureStyleChoices = [
  { id: 'enterprise', label: '国内企业方案风格', detail: '分层分区、能力矩阵、汇报与方案展示' },
  { id: 'engineering', label: '国际工程架构风格', detail: '系统边界、真实依赖、C4 与工程评审' },
] as const

export const architectureStyleQuestion = '想画哪种架构图？国内企业方案风格（分层分区、功能模块），还是国际工程架构风格（C4/组件依赖、工程设计）？'

/** Only explicit style wording is authoritative; technologies and the project domain are not. */
export function detectArchitectureStyle(text: string): ArchitectureDiagramStyle | undefined {
  const enterprise = /国内企业方案(?:风格)?|中式(?:分层)?架构|政企(?:方案)?风格|功能(?:分层)?架构图|分层(?:式)?架构图|平台能力架构图|总体功能架构图/i.test(text)
  const engineering = /国际工程架构(?:风格)?|工程架构风格|C4(?:\s|[-:]|$|系统|容器|组件|架构)|Container Diagram|Component Diagram|系统上下文图/i.test(text)
  return enterprise === engineering ? undefined : enterprise ? 'enterprise' : 'engineering'
}
