PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 3000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  expires INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS members (
  family_id TEXT NOT NULL REFERENCES families ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (family_id, user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families ON DELETE CASCADE,
  expires INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  family_id TEXT REFERENCES families ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id)
) STRICT;

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  recipe_id TEXT UNIQUE NOT NULL REFERENCES recipes ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  snapshot TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  published_at INTEGER,
  reviewed_at INTEGER,
  reviewer_id TEXT REFERENCES users ON DELETE SET NULL
) STRICT;

CREATE TABLE IF NOT EXISTS recipe_photos (
  recipe_id TEXT NOT NULL REFERENCES recipes ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 3),
  jpeg BLOB NOT NULL,
  PRIMARY KEY (recipe_id, position)
) STRICT;

CREATE INDEX IF NOT EXISTS publication_state ON publications (state, published_at);

CREATE TABLE IF NOT EXISTS recipe_manuscripts (
  recipe_id TEXT PRIMARY KEY REFERENCES recipes ON DELETE CASCADE,
  jpeg BLOB NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS family_checks (
  recipe_id TEXT NOT NULL REFERENCES recipes ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES families ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (recipe_id, family_id, reviewer_id)
) STRICT;

CREATE TABLE IF NOT EXISTS recreations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  family_id TEXT REFERENCES families ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('private', 'family', 'public')),
  state TEXT NOT NULL CHECK (state IN ('approved', 'pending', 'rejected', 'withdrawn')),
  result TEXT NOT NULL,
  note TEXT NOT NULL,
  photo BLOB,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, request_id)
) STRICT;
CREATE INDEX IF NOT EXISTS recreations_target ON recreations (target_id, created_at);

CREATE TABLE IF NOT EXISTS family_meals (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families ON DELETE CASCADE,
  day TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('wish', 'breakfast', 'lunch', 'dinner', 'feast')),
  recipe_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  UNIQUE(family_id, day, slot, recipe_id, user_id)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS planned_meal ON family_meals (family_id,day,slot,recipe_id) WHERE slot<>'wish';

CREATE TABLE IF NOT EXISTS shopping_checks (
  family_id TEXT NOT NULL REFERENCES families ON DELETE CASCADE,
  period TEXT NOT NULL,
  item_key TEXT NOT NULL,
  PRIMARY KEY(family_id, period, item_key)
) STRICT;

CREATE TABLE IF NOT EXISTS cookbooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  family_id TEXT REFERENCES families ON DELETE CASCADE,
  title TEXT NOT NULL,
  introduction TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('private', 'pending', 'approved', 'rejected', 'withdrawn')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS cookbook_recipes (
  cookbook_id TEXT NOT NULL REFERENCES cookbooks ON DELETE CASCADE,
  recipe_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (cookbook_id, recipe_id)
) STRICT;

CREATE TABLE IF NOT EXISTS reactions (
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'save', 'follow', 'block')),
  target TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, target)
) STRICT;

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  target TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS reports (
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  target TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target)
) STRICT;

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  city TEXT NOT NULL,
  home TEXT NOT NULL,
  personalized INTEGER NOT NULL CHECK (personalized IN (0, 1))
) STRICT;
