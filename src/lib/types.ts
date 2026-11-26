export interface AssetInfo {
  id: string
  symbol: string
  name: string
  kind: 'stock' | 'etf'
  sector: string | null
  description: string | null
  price: number | null
  prev_price: number | null
}

export interface HistoryItem {
  id: string
  trading_date: string
  action: 'buy' | 'sell' | 'hold'
  asset_id: string | null
  quantity: number | null
  status: 'pending' | 'settled'
  expectation: string
  reasoning: string
  evidence: string
  risks: string
  order_status: 'executed' | 'rejected' | null
  reject_reason: string | null
  price: number | null
  reflection: { convincing: string; overlooked: string; would_change: string } | null
  feedback: { comment: string | null } | null
}

export interface Overview {
  member: boolean
  pseudonym?: string
  class_name?: string
  assets: AssetInfo[]
  round?: null | {
    id: string
    name: string
    status: 'active' | 'ended'
    starting_capital: number
    is_demo: boolean
    data_mode: 'simulated' | 'external'
    timezone: string
  }
  next_trading_date?: string | null
  deadline?: string | null
  cash?: number
  holdings?: { asset_id: string; quantity: number; avg_cost: number; price: number | null }[]
  snapshots?: { date: string; total: number }[]
  pending_decision?: {
    action: 'buy' | 'sell' | 'hold'; asset_id: string | null; quantity: number | null
    expectation: string; reasoning: string; evidence: string; risks: string
  } | null
  history?: HistoryItem[]
}

export interface TeacherRound {
  id: string
  name: string
  status: 'draft' | 'active' | 'ended'
  is_demo: boolean
  data_mode: 'simulated' | 'external'
  starting_capital: number
  deadline_time: string
  start_date: string | null
  next_trading_date: string | null
  deadline: string | null
  settled_days: number
}

export interface TeacherClass {
  id: string
  name: string
  join_code: string
  join_open: boolean
  member_count: number
  rounds: TeacherRound[]
}

export interface TeacherDecision {
  id: string
  pseudonym: string
  trading_date: string
  action: 'buy' | 'sell' | 'hold'
  symbol: string | null
  quantity: number | null
  status: 'pending' | 'settled'
  expectation: string
  reasoning: string
  evidence: string
  risks: string
  order_status: 'executed' | 'rejected' | null
  reject_reason: string | null
  price: number | null
  reflection: { convincing: string; overlooked: string; would_change: string } | null
  feedback: {
    comment: string | null
    score_reasoning: number | null; score_evidence: number | null
    score_risk: number | null; score_reflection: number | null
  } | null
}

export interface RoundDetail {
  next_trading_date: string | null
  students: { student_id: string; pseudonym: string; cash: number | null; total: number | null; submitted_today: boolean }[]
  counts_next: { buy: number; sell: number; hold: number } | null
  counts_last: { date: string | null; buy: number; sell: number; hold: number } | null
  decisions: TeacherDecision[]
}

export interface ReadingTip {
  id: string
  title: string
  source: string | null
  url: string
  created_at: string
}

export interface PriceStatus {
  data_mode: 'simulated' | 'external'
  status: 'draft' | 'active' | 'ended'
  date: string
  closed: boolean
  missing: string[]
  symbols: { symbol: string; name: string; last: number | null }[]
}
