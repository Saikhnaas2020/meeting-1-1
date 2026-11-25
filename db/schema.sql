-- My 1:1 — PostgreSQL schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  initials      text NOT NULL CHECK (char_length(initials) BETWEEN 1 AND 3),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  department    text,
  job_title     text,
  manager_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  role          text NOT NULL CHECK (role IN ('employee', 'manager', 'hr')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE INDEX IF NOT EXISTS users_manager_idx ON users(manager_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- recipient_type = 'manager': recipient_id is the requester's direct manager.
-- recipient_type = 'hr': handled by the HR team; recipient_id is set to the HR
-- user who confirms / proposes a time.
CREATE TABLE IF NOT EXISTS meetings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_type   text NOT NULL CHECK (recipient_type IN ('manager', 'hr')),
  recipient_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  topics           text[] NOT NULL CHECK (cardinality(topics) BETWEEN 1 AND 6),
  note             text CHECK (char_length(note) <= 240),
  meeting_date     date NOT NULL,
  meeting_time     text NOT NULL CHECK (meeting_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  backup_time      text CHECK (backup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  proposed_time    text CHECK (proposed_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_minutes int  NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 15 AND 120),
  mode             text NOT NULL CHECK (mode IN ('in_person', 'teams')),
  status           text NOT NULL CHECK (status IN ('pending', 'proposed', 'confirmed', 'completed', 'cancelled')),
  request_key      uuid UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (recipient_type = 'hr' OR recipient_id IS NOT NULL),
  CHECK (status <> 'proposed' OR proposed_time IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS meetings_requester_idx ON meetings(requester_id);
CREATE INDEX IF NOT EXISTS meetings_recipient_idx ON meetings(recipient_id);
CREATE INDEX IF NOT EXISTS meetings_type_status_idx ON meetings(recipient_type, status);

CREATE TABLE IF NOT EXISTS meeting_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  from_status text,
  to_status   text,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_history_meeting_idx ON meeting_history(meeting_id);

-- Visible ONLY to author_id. Never joined into lists, metrics or other users' responses.
CREATE TABLE IF NOT EXISTS private_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, author_id)
);

CREATE TABLE IF NOT EXISTS action_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date     date,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS action_items_meeting_idx ON action_items(meeting_id);
CREATE INDEX IF NOT EXISTS action_items_owner_idx ON action_items(owner_id);

CREATE TABLE IF NOT EXISTS conversation_pulse (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  respondent_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating        int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  next_step     text NOT NULL CHECK (next_step IN ('yes', 'partly', 'no')),
  feedback      text CHECK (char_length(feedback) <= 500),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, respondent_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,
  message    text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  action      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_entity_idx ON activity_log(entity_type, entity_id);
