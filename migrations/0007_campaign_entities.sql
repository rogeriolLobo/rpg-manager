CREATE TABLE campaign_entities (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE RESTRICT,
  usage_type TEXT NOT NULL DEFAULT 'REFERENCE' CHECK(usage_type IN ('REFERENCE','ACTIVE')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id, entity_id)
);
CREATE INDEX idx_campaign_entities_entity ON campaign_entities(entity_id, campaign_id);

ALTER TABLE campaigns ADD COLUMN adventure_entity_id TEXT REFERENCES vault_entities(id) ON DELETE RESTRICT;
CREATE INDEX idx_campaigns_adventure ON campaigns(adventure_entity_id);
