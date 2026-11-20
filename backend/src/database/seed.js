import { DateTime } from 'luxon';
import { pool, transaction } from './db.js';
import { priorities } from '../domain.js';
import { hashPassword } from '../services/password.js';
import { activity, notify } from '../services/events.js';
import { addBusinessMinutes } from '../services/calendar.js';
import { initializeTargets, updateTargets } from '../services/sla.js';

const people = [
  ['Mariana Costa', 'admin', 'admin'], ['Rafael Mendes', 'gestor', 'manager'], ['Camila Rocha', 'atendente', 'agent'],
  ['Felipe Nunes', 'felipe', 'agent'], ['Juliana Almeida', 'juliana', 'agent'], ['Bruno Martins', 'bruno', 'agent'],
  ['Beatriz Lima', 'solicitante', 'requester'], ['Gabriel Santos', 'gabriel', 'requester'], ['Laura Oliveira', 'laura', 'requester'],
  ['André Ribeiro', 'andre', 'requester'], ['Sofia Ferreira', 'sofia', 'requester'], ['Lucas Teixeira', 'lucas', 'requester']
];
const groups = [
  ['Service Desk', 'Atendimento inicial, acesso a contas e suporte ao usuário.'],
  ['Infraestrutura', 'Redes, dispositivos e disponibilidade de serviços.'],
  ['Sistemas Internos', 'Aplicativos corporativos, permissões e integrações.']
];
const topics = [
  ['Acesso e permissões', ['Acesso ao ERP bloqueado', 'Redefinição de senha corporativa', 'Permissão para pasta compartilhada', 'Ativação de acesso para novo colaborador', 'Erro ao validar autenticação em duas etapas', 'Solicitação de perfil de leitura no ERP']],
  ['Infraestrutura', ['Instabilidade na VPN corporativa', 'Wi-Fi intermitente na sala de reunião', 'Impressora do financeiro indisponível', 'Monitor externo sem sinal', 'Queda de rede no segundo andar', 'Substituição de teclado da recepção']],
  ['Sistemas internos', ['Falha na emissão de relatório mensal', 'Painel de vendas não atualiza', 'Integração de pedidos com ERP atrasada', 'Erro ao exportar planilha do portal', 'Atualização de cadastro no CRM', 'Erro ao conciliar lançamentos no sistema']],
  ['Software e licenças', ['Solicitação de licença do pacote Office', 'Instalação do aplicativo de reuniões', 'Licença de edição de PDF expirada', 'Atualização do navegador corporativo', 'Aplicativo de videoconferência sem áudio', 'Instalação de fonte para comunicação interna']],
  ['E-mail e colaboração', ['Caixa compartilhada não recebe mensagens', 'Restauração de arquivo compartilhado', 'Convites de calendário duplicados', 'Configuração de lista de distribuição', 'E-mail retido na caixa de saída', 'Inclusão em canal de projeto']]
];
const statusPattern = ['resolved','open','in_progress','waiting_requester','closed','triage','resolved','in_progress','waiting_third_party','resolved','open','resolved','cancelled','in_progress','closed','resolved'];
const recent = [
  [0, 0, 'high', 'open', 0], [1, 0, 'critical', 'in_progress', 1], [2, 0, 'medium', 'waiting_requester', 2],
  [3, 0, 'low', 'resolved', 0], [4, 0, 'high', 'triage', 0], [1, 2, 'medium', 'closed', 1]
];

async function seed(db, hash) {
  await db.query('SELECT pg_advisory_xact_lock(514035)');
  const { rows: [existing] } = await db.query("SELECT 1 FROM users WHERE email='admin@nexus.demo'");
  if (existing) return false;
  const count = await db.query('SELECT 1 FROM users LIMIT 1');
  if (count.rowCount) throw new Error('Use um banco de demonstração vazio.');
  const users = [];
  for (const [name, email, role] of people) {
    const { rows: [user] } = await db.query('INSERT INTO users (name,email,role,password_hash) VALUES ($1,$2,$3,$4) RETURNING id', [name, `${email}@nexus.demo`, role, hash]);
    users.push(user.id);
  }
  const teams = [];
  for (const [name, description] of groups) {
    const { rows: [team] } = await db.query('INSERT INTO teams (name,description) VALUES ($1,$2) RETURNING id', [name, description]);
    teams.push(team.id);
  }
  for (const [teamIndex, members] of [[0,[1,2,3]], [1,[1,4]], [2,[1,5]]]) {
    await db.query('INSERT INTO team_members (team_id,user_id) SELECT $1,unnest($2::integer[])', [teams[teamIndex], members.map(index => users[index])]);
  }
  const categories = [];
  for (const [name] of topics) {
    const { rows: [category] } = await db.query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [name]);
    categories.push(category.id);
  }
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const owner = [users[2], users[4], users[5]];
  for (let index = 71; index >= 0; index--) {
    const sample = recent[index];
    const group = sample?.[0] ?? index % topics.length;
    const variant = sample?.[1] ?? (Math.floor(index / topics.length) % topics[group][1].length);
    const priority = sample?.[2] ?? priorities[[1, 0, 2, 1, 0, 1, 3, 2, 1, 0, 2][index % 11]];
    const status = sample?.[3] ?? statusPattern[index % statusPattern.length];
    const teamIndex = sample?.[4] ?? (group === 1 ? 1 : group === 2 ? 2 : 0);
    const age = sample ? 0 : 1 + Math.floor((index - recent.length) * 0.62);
    const rawDate = now.minus({ days: age, minutes: sample ? 75 + 55 * index : 0 });
    const opened = (sample ? rawDate : rawDate.set({ hour: 9 + index % 8, minute: (index * 17) % 60 })).toJSDate();
    const requester = users[6 + index % 6];
    const assignee = ['open','triage'].includes(status) && index % 2 === 0 ? null : (teamIndex === 0 && index % 3 === 0 ? users[3] : owner[teamIndex]);
    const team = index % 9 === 0 && !assignee ? null : teams[teamIndex];
    const title = topics[group][1][variant];
    const detail = `Precisamos de apoio com ${title.charAt(0).toLowerCase() + title.slice(1)}. A situação foi identificada durante a rotina da equipe e registrada para acompanhamento.\n\nO atendimento pode ser feito pelo portal. Se precisarem de informações adicionais, posso responder por aqui.`;
    const { rows: [ticket] } = await db.query(`INSERT INTO tickets (title,description,requester_id,assignee_id,team_id,category_id,priority,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [title, detail, requester, assignee, team, categories[group], priority, opened]);
    await initializeTargets(db, ticket, opened);
    await activity(db, ticket.id, requester, 'created', { title, priority }, false, opened);
    const { rows: [clock] } = await db.query("SELECT * FROM sla_targets WHERE ticket_id=$1 AND phase='response'", [ticket.id]);
    const replied = assignee && !['open','triage','cancelled'].includes(status);
    const closed = ['resolved','closed'].includes(status);
    const pause = ['waiting_requester','waiting_third_party'].includes(status);
    const onTime = index % 9 !== 7;
    const response = replied ? new Date(Math.min(+now - 90 * 60000, +addBusinessMinutes(opened, onTime ? Math.min(12, clock.budget_minutes - 1) : clock.budget_minutes + 70, clock.calendar))) : null;
    const resolution = closed ? new Date(Math.min(+now - 30 * 60000, +addBusinessMinutes(response ?? opened, index % 5 === 0 ? 720 : 50 + index % 45, clock.calendar))) : null;
    if (replied) {
      const first = new Date(Math.max(+opened + 60000, +response));
      await db.query('INSERT INTO comments (ticket_id,author_id,body,created_at) VALUES ($1,$2,$3,$4)', [ticket.id, assignee,
        'Recebemos sua solicitação e iniciamos a análise. Vou acompanhar o chamado por aqui e retorno com os próximos passos.', first]);
      await updateTargets(db, ticket, ticket, first, assignee, true);
      await activity(db, ticket.id, assignee, 'comment', {}, false, first);
      if (index % 4 === 0) await db.query('INSERT INTO comments (ticket_id,author_id,body,internal,created_at) VALUES ($1,$2,$3,true,$4)',
        [ticket.id, assignee, 'Verificar os registros com a equipe antes de confirmar o diagnóstico ao solicitante.', first]);
    }
    const changeTime = resolution ?? (pause ? new Date(Math.min(+now, +opened + 70 * 60000)) : new Date(+opened + 25 * 60000));
    await db.query('UPDATE tickets SET status=$2,first_response_at=$3,resolved_at=$4,updated_at=$5 WHERE id=$1', [ticket.id, status, response && new Date(Math.max(+opened + 60000, +response)), resolution, changeTime]);
    if (status !== 'open') {
      await updateTargets(db, ticket, { ...ticket, status }, changeTime, assignee ?? users[1]);
      await activity(db, ticket.id, assignee ?? users[1], 'updated', { status: { before: 'open', after: status } }, false, changeTime);
    }
    if (sample) await notify(db, ticket, 'created', `Novo chamado ${ticket.code}: ${title}`, { actor: requester, team: true });
  }
  return true;
}

try {
  if (process.env.DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production') throw new Error('Use DEMO_MODE=true em um banco local de demonstração.');
  const hash = await hashPassword('NexusDemo#2026');
  const created = await transaction(db => seed(db, hash));
  console.log(created ? 'Demonstração instalada: 72 chamados e 12 contas.' : 'Demonstração já instalada.');
} finally {
  await pool.end();
}
