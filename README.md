# Nexus Desk

Nexus Desk é uma central de atendimento em português para abrir, distribuir e resolver chamados. A interface usa HTML5, CSS3 e módulos JavaScript nativos. A API REST usa Node.js, Express e PostgreSQL. Os dois serviços se comunicam por HTTP e podem ser executados independentemente.

## Executar localmente

Requisitos: Node.js 22 ou superior, npm e PostgreSQL. O Compose fornece um PostgreSQL 17 local. Para usar um banco existente, ajuste `DATABASE_URL` no lugar de iniciar o serviço do Compose.

```sh
docker compose up -d --wait database
npm --prefix backend ci
```

Copie `backend/.env.example` para `backend/.env`. Defina `SESSION_SECRET` com pelo menos 32 caracteres aleatórios. Gere um valor com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

```sh
npm --prefix backend run db:migrate
```

Para experimentar a aplicação, defina `DEMO_MODE=true` em `backend/.env` e execute `npm --prefix backend run db:seed`. Para um banco próprio, mantenha `DEMO_MODE=false`, forneça `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` no ambiente e execute `npm --prefix backend run db:admin`. A senha inicial deve ter ao menos 12 caracteres. Cadastre as categorias em **Administração → Categorias** antes da abertura do primeiro chamado.

Execute os serviços em dois terminais, a partir da raiz do projeto.

```sh
npm --prefix backend start
```

```sh
npm --prefix frontend start
```

Acesse [http://localhost:3000](http://localhost:3000). A API atende em `http://localhost:4000/api` e a verificação de conexão com o banco está em `GET /api/health`. Para alterar portas ou endereços, alinhe `API_URL` no frontend e `FRONTEND_ORIGIN` no backend. Use `localhost` nos dois endereços padrão para que o navegador envie o cookie de sessão.

## Demonstração

A carga demonstrativa contém 72 chamados com datas relativas à execução, os oito status, quatro prioridades, três equipes, 12 contas, conversas, histórico e metas de SLA cumpridas e violadas. A tela de login oferece acesso por perfil quando o modo de demonstração está habilitado.

| Perfil | Conta |
| --- | --- |
| Administrador | `admin@nexus.demo` |
| Gestor | `gestor@nexus.demo` |
| Atendente | `atendente@nexus.demo` |
| Solicitante | `solicitante@nexus.demo` |

Todas as contas usadas para demonstração ultilizam da senha `NexusDemo#2026`. Execute a carga em uma base local vazia. A carga pode ser repetida após a instalação inicial.

## Fluxos e permissões

| Perfil | Acesso |
| --- | --- |
| Administrador | Todos os chamados, fila global, usuários, equipes, categorias, configuração de SLA e auditoria. |
| Gestor | Atendimento, atribuição e transferência de chamados das equipes das quais participa. |
| Atendente | Atendimento dos chamados atribuídos a si e dos chamados ainda sem responsável nas próprias equipes. |
| Solicitante | Criação e acompanhamento dos próprios chamados e troca de mensagens públicas com a equipe. |

Todo chamado sem equipe passa pela fila global. Para atribuir um responsável, selecione a equipe no painel do chamado. Vínculos entre pessoas e equipes são editados em **Usuários**. Para preservar referências e históricos, contas, equipes e categorias podem ser desativadas.

Na lista, combine filtros, ordene, pagine e selecione chamados autorizados para aplicar alterações em lote. No Kanban, arraste um cartão entre colunas ou altere o status no menu de ações do cartão. Abra a pesquisa global com `Ctrl+K` ou `⌘+K`. As preferências de tema, navegação, período e visualização ficam no navegador.

## SLA e indicadores

| Prioridade | Primeira resposta | Resolução |
| --- | ---: | ---: |
| Baixa | 8 horas úteis | 72 horas úteis |
| Média | 4 horas úteis | 24 horas úteis |
| Alta | 1 hora útil | 8 horas úteis |
| Crítica | 15 minutos úteis | 4 horas úteis |

O expediente inicial é de segunda a sexta, das 9h às 18h, em `America/Sao_Paulo`. Cada novo ciclo guarda uma cópia do calendário e do orçamento inicial. Na mudança de prioridade, uma meta ativa recebe o orçamento da nova prioridade com desconto do tempo útil consumido. Aguardando solicitante e Aguardando terceiro pausam o saldo por padrão. Alterações nos status de pausa são aplicadas na próxima movimentação do chamado. A primeira mensagem pública de atendimento conclui a meta de resposta. Uma resolução conclui a meta de resolução. Ao reabrir, inicia-se outro ciclo com histórico preservado.

O servidor verifica os prazos a cada 30 segundos e em operações que afetam a meta. O indicador visual usa o prazo devolvido pela API. A antecedência do alerta e a contagem exibida até a data de vencimento usam tempo corrido. Chamados críticos ativos podem ser escalados nos detalhes ou nas ações da lista.

Dashboard e relatórios usam janelas de 7, 30 ou 90 dias e o fuso do workspace. Os totais de status classificam os chamados abertos no período pelo estado atual. O gráfico de evolução usa as datas de abertura e resolução. O cumprimento do SLA divide metas cumpridas pela soma de metas cumpridas e violadas. O CSV inclui os mesmos filtros do relatório e usa separador `;`.

## Organização e validação

- `frontend/css` contém os tokens do tema, layout, componentes e regras responsivas. `frontend/js` contém a navegação, o cliente HTTP e os módulos das páginas.
- `backend/src/routes` valida as requisições REST. `backend/src/services` concentra as regras de tickets, eventos, autenticação e calendário. `backend/src/database` contém a migração e os utilitários de administração.
- `npm --prefix backend test` executa os testes do calendário, incluindo feriados, fins de semana, frações de minuto e horário de verão.
- O histórico, as mudanças de SLA e as notificações relacionadas a mutações de chamados são gravados em transações no PostgreSQL.

Para implantação, configure `NODE_ENV=production`, `FRONTEND_ORIGIN` com a origem HTTPS e `API_URL` com o endereço HTTPS da API no mesmo site. Se houver um proxy reverso confiável, ajuste `TRUST_PROXY_HOPS` ao número de proxies. Use uma base própria, credenciais distintas das do Compose e um segredo dedicado para sessões. Mantenha `DEMO_MODE=false`.
