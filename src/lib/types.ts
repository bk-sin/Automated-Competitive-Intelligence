export type ClientStatus = "onboarding" | "active" | "paused";
export type ExtractionStatus = "success" | "failed" | "unchanged";
export type AlertPriority = "ALTA_PRIORIDAD" | "MEDIA" | "BAJA";
export type OnboardingStatus = "received" | "in_setup" | "active" | "rejected";
export type EventLevel = "info" | "warning" | "error";

export type ClientRow = {
  id: string;
  user_id: string;
  email: string;
  company_name: string;
  timezone: string;
  tracking_goals: string;
  status: ClientStatus;
  weekly_digest_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type CompetitorRow = {
  id: string;
  client_id: string;
  name: string;
  url: string;
  is_active: boolean;
  crawl_interval_days: number;
  last_crawled_at: string | null;
  created_at: string;
};

export type ExtractionRow = {
  id: string;
  competitor_id: string;
  status: ExtractionStatus;
  markdown: string | null;
  content_hash: string | null;
  http_status: number | null;
  error_message: string | null;
  duration_ms: number | null;
  extracted_at: string;
};

export type AnalysisRow = {
  id: string;
  extraction_id: string;
  competitor_id: string;
  client_id: string;
  priority: AlertPriority;
  has_meaningful_change: boolean;
  headline: string;
  precios: string[];
  posicionamiento: string[];
  productos: string[];
  reasoning: string | null;
  model: string | null;
  tokens_used: number | null;
  created_at: string;
};

export type AlertRow = {
  id: string;
  client_id: string;
  competitor_id: string;
  analysis_id: string | null;
  priority: AlertPriority;
  subject: string;
  body: string;
  sent_at: string | null;
  send_error: string | null;
  created_at: string;
};

export type OnboardingRequestRow = {
  id: string;
  email: string;
  company_name: string;
  competitor_urls: string[];
  goals: string;
  status: OnboardingStatus;
  note: string | null;
  created_at: string;
};

/** Validated output of the LLM step (see src/lib/llm.ts). */
export type AnalysisResult = {
  hasMeaningfulChange: boolean;
  priority: AlertPriority;
  headline: string;
  precios: string[];
  posicionamiento: string[];
  productos: string[];
  reasoning?: string;
};

/** What the extraction job hands to the email layer. */
export type Finding = AnalysisResult & {
  competitorId: string;
  competitorName: string;
  competitorUrl: string;
  detectedAt: Date;
};
