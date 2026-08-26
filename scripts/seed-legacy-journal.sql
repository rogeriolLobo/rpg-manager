-- Fixture executada somente depois das migrations 0001..0041.
INSERT INTO users (
  id, email, email_normalized, display_name, password_hash,
  created_at, updated_at, password_changed_at
) VALUES (
  'legacy_user', 'legacy@example.com', 'legacy@example.com', 'Legacy User', 'hash',
  '2025-01-01T10:00:00.000Z', '2025-01-02T11:00:00.000Z', '2025-01-01T10:00:00.000Z'
);

INSERT INTO worlds (
  id, owner_user_id, name, slug, description, default_rpg_id, visibility, status,
  created_at, updated_at, archived_at
) VALUES
  ('legacy_world_1', 'legacy_user', 'Legacy World 1', 'legacy-world-1', 'W1', NULL, 'PRIVATE', 'ACTIVE', '2025-02-01T10:00:00.000Z', '2025-02-02T11:00:00.000Z', NULL),
  ('legacy_world_2', 'legacy_user', 'Legacy World 2', 'legacy-world-2', 'W2', NULL, 'PRIVATE', 'ACTIVE', '2025-03-01T10:00:00.000Z', '2025-03-02T11:00:00.000Z', NULL);

INSERT INTO journal_folders (id, world_id, parent_folder_id, name, sort_order, created_at, updated_at)
VALUES
  ('legacy_folder_root', 'legacy_world_1', NULL, 'NPCs', 4, '2025-04-01T10:00:00.000Z', '2025-04-02T11:00:00.000Z'),
  ('legacy_folder_child', 'legacy_world_1', 'legacy_folder_root', 'Aliados', 7, '2025-04-03T12:00:00.000Z', '2025-04-04T13:00:00.000Z'),
  ('legacy_folder_world_2', 'legacy_world_2', NULL, 'Locations', 2, '2025-05-01T10:00:00.000Z', '2025-05-02T11:00:00.000Z');

INSERT INTO journal_pages (id, world_id, folder_id, title, content, created_at, updated_at)
VALUES
  ('legacy_page_1', 'legacy_world_1', 'legacy_folder_child', 'King', 'King rules\nwith preserved content.', '2025-06-01T10:00:00.000Z', '2025-06-02T11:00:00.000Z'),
  ('legacy_page_2', 'legacy_world_2', 'legacy_folder_world_2', 'Tavern', 'Tavern place', '2025-07-01T10:00:00.000Z', '2025-07-02T11:00:00.000Z');
