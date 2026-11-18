-- 创建 ai_primitive 表
CREATE TABLE IF NOT EXISTS ai_primitive (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL,
  primitive_type TEXT NOT NULL,
  intent_tags TEXT NOT NULL,
  source_resource_ids TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  contract_json TEXT,
  adapter_json TEXT,
  validation_json TEXT,
  quality_score REAL,
  owner TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_deleted INTEGER
);

-- 扩展 onescience_resource 表
ALTER TABLE onescience_resource ADD COLUMN resource_type TEXT;
ALTER TABLE onescience_resource ADD COLUMN trust_level TEXT DEFAULT 'user';
ALTER TABLE onescience_resource ADD COLUMN license TEXT;
ALTER TABLE onescience_resource ADD COLUMN version TEXT;
ALTER TABLE onescience_resource ADD COLUMN owner TEXT;
ALTER TABLE onescience_resource ADD COLUMN metadata TEXT;
ALTER TABLE onescience_resource ADD COLUMN verification_state TEXT DEFAULT 'draft';
ALTER TABLE onescience_resource ADD COLUMN verified_at INTEGER;
ALTER TABLE onescience_resource ADD COLUMN verified_by TEXT;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ai_primitive_status ON ai_primitive(status);
CREATE INDEX IF NOT EXISTS idx_ai_primitive_domain ON ai_primitive(domain);
CREATE INDEX IF NOT EXISTS idx_ai_primitive_type ON ai_primitive(primitive_type);
CREATE INDEX IF NOT EXISTS idx_ai_primitive_slug ON ai_primitive(slug);
