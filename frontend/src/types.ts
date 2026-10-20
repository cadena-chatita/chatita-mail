// Chatita Mail v3.0 - shared types (mirror backend schemas)

export type EmailCategory =
  | "CRITICAL"
  | "IMPORTANT"
  | "MEDIUM"
  | "LOW"
  | "SPAM"
  | "NOISE"
  | "UNCLASSIFIED";

export type EmailStatus =
  | "INBOX"
  | "ARCHIVED"
  | "QUARANTINED"
  | "BLOCKED"
  | "DELETED"
  | "SENT";

export type RiskLevel = "safe" | "suspicious" | "dangerous";

export interface EmailListItem {
  id: string;
  account_id?: string | null;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  status: EmailStatus;
  is_read: boolean;
  received_at: string | null;
  thread_id: string | null;
  has_html: boolean;
  has_attachments: boolean;
  category: EmailCategory | null;
  confidence: number | null;
  is_newsletter: boolean;
  unsubscribe_url: string | null;
  risk_level: RiskLevel | null;
  risk_score: number | null;
  similarity?: number; // present only for semantic search results (0-1)
}

export interface ClassificationDetail {
  category: EmailCategory;
  confidence: number;
  stage: string;
  reasoning: string | null;
  is_newsletter: boolean;
  unsubscribe_url: string | null;
}

export interface SecurityDetail {
  risk_score: number;
  risk_level: RiskLevel;
  explanation: string | null;
  risk_factors: string[];
  recommended_action: string;
}

export interface Attachment {
  filename?: string;
  mime_type?: string;
  size?: number;
  [k: string]: unknown;
}

export interface Task {
  id: string;
  email_id: string;
  description: string;
  task_type: string | null;
  priority: string | null;
  deadline: string | null;
  status: string;
  created_at: string | null;
}

export interface Commitment {
  id: string;
  email_id: string;
  who: string;
  what: string;
  deadline: string | null;
  status: string;
  created_at: string | null;
}

export interface EmailDetail {
  id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  attachments: Attachment[];
  status: EmailStatus;
  is_read: boolean;
  thread_id: string | null;
  received_at: string | null;
  classification: ClassificationDetail | null;
  security: SecurityDetail | null;
  tasks: Task[];
  commitments: Commitment[];
}

export interface InboxStats {
  total: number;
  unread: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  open_tasks: number;
  open_commitments: number;
  time_saved_minutes: number;
}

export interface SyncResult {
  pulled?: number;
  upserted?: number;
  triaged?: number;
  [k: string]: unknown;
}

export type AccountProvider = "gmail" | "microsoft" | "imap" | "icloud";
export type AccountStatus = "connected" | "pending_auth" | "error" | "disabled";

export interface Account {
  id: string;
  provider: AccountProvider;
  email_address: string;
  display_name: string | null;
  color: string | null;
  auth_type: string | null;
  status: AccountStatus;
  is_active: boolean;
  is_default: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  email_count: number;
  unread_count: number;
  oauth_ready: boolean;
}
