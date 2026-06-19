export type ToolStatus = 'available' | 'coming-soon' | 'desktop-only'

export interface SecretFlag {
  env: string
  label: string
  docs_url: string
  present: boolean
}

export interface Field {
  name: string
  label: string
  type: string
  required: boolean
  default: unknown
  help: string | null
  options: string[] | null
}

export interface Tool {
  id: string
  title: string
  description: string
  category: string
  icon: string
  status: ToolStatus
  version: string
  custom_ui: boolean
  docs_url: string | null
  fields: Field[]
  secrets: SecretFlag[]
}

export interface ToolsResponse {
  tools: Tool[]
  categories: string[]
}

export interface ButtonCombo {
  bg: string
  text: string
}

export interface ThinkingEffort {
  value: string
  label: string
}

export interface Meta {
  button_combos: ButtonCombo[]
  sizes: string[]
  master_size: string
  models: string[]
  qualities: string[]
  default_quality?: string
  thinking_efforts?: ThinkingEffort[]
  default_effort?: string
}

export interface Banner {
  label: string
  concept: string
  title: string
  size: string
  mode: string
  phase: string
  status: string
  attempts: number
  gen_ms: number | null
  bytes: number
  error: string | null
  url: string | null
}

export interface RunDirector {
  used: boolean
  model?: string
  effort?: string
  concepts?: number
  failed?: number
  sizes_directed?: number
  reason?: string
  error?: string | null
}

export interface RunData {
  run_id: string
  status: string
  error: string | null
  total: number
  completed: number
  counts: { ok: number; failed: number; pending: number; running: number }
  created_at: string
  updated_at: string
  director?: RunDirector
  banners: Banner[]
}

/** A concept as the user edits it in the form. */
export interface ConceptForm {
  key: string
  hook_phrase: string
  creative_brief: string
  button_bg: string | null // bg hex when a CTA is present, else null
}

/** A concept dict as returned by the AI-assist endpoint. */
export interface SuggestedConcept {
  key: string
  title: string
  locale: string
  hook_phrase: string
  creative_brief: string
  cta?: string
  button_combo?: [string, string]
}

export const TERMINAL_STATUSES = ['completed', 'partial', 'failed', 'cancelled']
