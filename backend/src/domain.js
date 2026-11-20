export const priorities = ['low', 'medium', 'high', 'critical'];
export const statuses = ['open', 'triage', 'in_progress', 'waiting_requester', 'waiting_third_party', 'resolved', 'closed', 'cancelled'];
export const roles = ['admin', 'manager', 'agent', 'requester'];
export const terminal = ['resolved', 'closed', 'cancelled'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function allow(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'Você não tem permissão para esta ação.');
    next();
  };
}

export function ticketScope(user, params, alias = 't') {
  if (user.role === 'admin') return 'TRUE';
  const self = `$${params.push(user.id)}`;
  if (user.role === 'requester') return `${alias}.requester_id = ${self}`;
  const team = `${alias}.team_id IN (SELECT tm.team_id FROM team_members tm WHERE tm.user_id = ${self})`;
  const assignment = user.role === 'manager' ? team : `${team} AND (${alias}.assignee_id IS NULL OR ${alias}.assignee_id = ${self})`;
  return `(${alias}.requester_id = ${self} OR ${alias}.assignee_id = ${self} OR (${assignment}))`;
}

export function ticketActions(user, ticket) {
  const assigned = user.id === ticket.assignee_id;
  const onTeam = user.team_ids.includes(ticket.team_id);
  const manage = user.role === 'admin' || (user.role === 'manager' && onTeam);
  const work = manage || (user.role === 'agent' && (assigned || (onTeam && ticket.assignee_id === null)));
  const own = user.id === ticket.requester_id;
  return { work, manage, own, comment: work || own, attach: work || own };
}
