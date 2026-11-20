export async function activity(db, ticketId, actorId, action, changes = {}, internal = false, at = new Date()) {
  await db.query('INSERT INTO activity (ticket_id, actor_id, action, changes, internal, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [ticketId, actorId, action, changes, internal, at]);
}

export async function notify(db, ticket, type, message, options = {}) {
  const { actor = null, requester = true, team = false, ids = [] } = options;
  const recipients = [ticket.assignee_id, ...ids];
  if (requester) recipients.push(ticket.requester_id);
  if (team) {
    const { rows } = await db.query(`SELECT u.id FROM users u WHERE u.active AND (
      u.role = 'admin' OR (u.role = 'manager' AND EXISTS
        (SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = u.id)) OR
      ($2::integer IS NULL AND u.role = 'agent' AND EXISTS
        (SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = u.id)))`, [ticket.team_id, ticket.assignee_id]);
    recipients.push(...rows.map(row => row.id));
  }
  await db.query(`INSERT INTO notifications (user_id, ticket_id, type, message)
    SELECT id, $2, $3, $4 FROM users WHERE active AND id = ANY($1::integer[]) AND id IS DISTINCT FROM $5`,
  [recipients.filter(Boolean), ticket.id, type, message, actor]);
}
