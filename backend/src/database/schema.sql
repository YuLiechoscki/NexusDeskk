CREATE TYPE role_type AS ENUM ('admin', 'manager', 'agent', 'requester');
CREATE TYPE priority_type AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE status_type AS ENUM ('open', 'triage', 'in_progress', 'waiting_requester', 'waiting_third_party', 'resolved', 'closed', 'cancelled');
CREATE TYPE sla_phase AS ENUM ('response', 'resolution');

CREATE TABLE teams (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role role_type NOT NULL DEFAULT 'requester',
  active boolean NOT NULL DEFAULT true,
  auth_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id integer REFERENCES teams ON DELETE CASCADE,
  user_id integer REFERENCES users ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members (user_id, team_id);

CREATE TABLE categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  workspace_name text NOT NULL DEFAULT 'Nexus Desk',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  business_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  business_start text NOT NULL DEFAULT '09:00',
  business_end text NOT NULL DEFAULT '18:00',
  pause_statuses status_type[] NOT NULL DEFAULT '{waiting_requester,waiting_third_party}',
  warning_minutes integer NOT NULL DEFAULT 60 CHECK (warning_minutes > 0)
);
INSERT INTO settings DEFAULT VALUES;

CREATE TABLE holidays (
  day date PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE sla_policies (
  priority priority_type PRIMARY KEY,
  response_minutes integer NOT NULL CHECK (response_minutes > 0),
  resolution_minutes integer NOT NULL CHECK (resolution_minutes >= response_minutes)
);
INSERT INTO sla_policies VALUES ('low', 480, 4320), ('medium', 240, 1440), ('high', 60, 480), ('critical', 15, 240);

CREATE SEQUENCE ticket_code_seq START 1001;
CREATE TABLE tickets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE DEFAULT ('NX-' || nextval('ticket_code_seq')),
  title text NOT NULL,
  description text NOT NULL,
  requester_id integer NOT NULL REFERENCES users,
  assignee_id integer REFERENCES users,
  team_id integer REFERENCES teams,
  category_id integer NOT NULL REFERENCES categories,
  priority priority_type NOT NULL DEFAULT 'medium',
  status status_type NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  escalated_at timestamptz,
  sla_cycle integer NOT NULL DEFAULT 1
);
CREATE INDEX tickets_created ON tickets (created_at DESC, id DESC);
CREATE INDEX tickets_requester ON tickets (requester_id);
CREATE INDEX tickets_assignee ON tickets (assignee_id);
CREATE INDEX tickets_team_status ON tickets (team_id, status);

CREATE TABLE sla_targets (
  ticket_id integer REFERENCES tickets ON DELETE CASCADE,
  cycle integer NOT NULL,
  phase sla_phase NOT NULL,
  budget_minutes integer NOT NULL,
  remaining_minutes double precision NOT NULL,
  calendar jsonb NOT NULL,
  running_since timestamptz,
  deadline timestamptz NOT NULL,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  breached_at timestamptz,
  warned_at timestamptz,
  PRIMARY KEY (ticket_id, cycle, phase)
);
CREATE INDEX sla_active_deadline ON sla_targets (deadline) WHERE completed_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL;

CREATE TABLE comments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets ON DELETE CASCADE,
  author_id integer REFERENCES users,
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_ticket ON comments (ticket_id, created_at);

CREATE TABLE attachments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets ON DELETE CASCADE,
  uploader_id integer NOT NULL REFERENCES users,
  filename text NOT NULL,
  size integer NOT NULL CHECK (size BETWEEN 1 AND 5242880),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_ticket ON attachments (ticket_id);

CREATE TABLE activity (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer REFERENCES tickets ON DELETE CASCADE,
  actor_id integer REFERENCES users,
  action text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}',
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_ticket ON activity (ticket_id, created_at DESC);

CREATE TABLE notifications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
  ticket_id integer REFERENCES tickets ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox ON notifications (user_id, created_at DESC);

CREATE TABLE sessions (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX sessions_expiry ON sessions (expire);
