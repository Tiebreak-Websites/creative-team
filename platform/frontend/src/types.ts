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
  subtitle?: string
  button?: string
  brief?: string // the creative-director's per-size brief
  prompt?: string | null // the exact prompt sent to the image model
  prompt_override?: string | null // user-edited prompt (used verbatim); truthy = "edited"
  size: string
  mode: string
  phase: string
  status: string
  approval_status?: string | null // this version's gate state: awaiting | approved | rejected
  attempts: number
  gen_ms: number | null
  bytes: number
  error: string | null
  qa?: string | null // post-generation QA warning (size/blank/palette drift), else null
  url: string | null
  web_url?: string | null // ad-network weight-capped variant (≤150 KB) for display slots
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
  model?: string // image model used (e.g. gpt-image-2)
  quality?: string // low | medium | high
  total: number
  completed: number
  counts: { ok: number; failed: number; pending: number; running: number; cancelled: number }
  created_at: string
  updated_at: string
  created_by?: string // email of the user who started the run
  director?: RunDirector
  style?: string // the composed art-direction string fed to the generator
  art_tags?: { label: string; value: string }[] // Art-Director selections (display-only)
  banners: Banner[]
  cancelled?: boolean
  intent?: string
  intent_meta?: Record<string, unknown>
  logo?: unknown
  approval_state?: Record<string, string> // concept -> awaiting | approved | rejected
  awaiting_at?: string | null
}

export const TERMINAL_STATUSES = ['completed', 'partial', 'failed', 'cancelled']
