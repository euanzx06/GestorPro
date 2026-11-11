# GestorPro — controle financeiro pessoal

A primeira versão do GestorPro será para organizar suas próprias contas bancárias e entender entradas e saídas. O app salva alterações no navegador e agora inclui uma integração local com o sandbox da Pluggy para desenvolver o fluxo de Open Finance com dados fictícios. A conexão com bancos reais exige acesso de produção da Pluggy e consentimento no banco.

## Escopo da primeira versão

- Cadastrar contas e informar saldos manualmente.
- Registrar entradas e saídas com categoria, conta, valor e data.
- Consultar um painel com saldo somado e resultado do mês.
- Buscar lançamentos e consultar relatórios simples por categoria.
- Baixar uma cópia de segurança local em JSON.
- Testar o fluxo de conexão e a leitura de contas e transações pelo sandbox Pluggy.
- Usar um chat OpenAI para sugerir categorias e reconhecer transferências entre contas próprias.
- Planejar limites de gastos e acompanhar uma meta de reserva.
- Proteger cada registro para que só o usuário autenticado possa acessá-lo.

Não armazenar senhas bancárias, códigos de autenticação, números completos de cartão ou credenciais do internet banking. No fluxo Open Finance, a autorização é realizada no banco; o GestorPro recebe dados autorizados por meio da Pluggy. Nunca coloque o Client Secret da Pluggy em arquivos do navegador nem o envie pelo chat.

## Telas

| Tela | Conteúdo |
| --- | --- |
| Visão geral | Saldo somado, entradas, saídas, resultado do mês e lançamentos recentes |
| Minhas contas | Contas cadastradas e saldos informados |
| Lançamentos | Histórico, busca e registro manual de entradas e saídas |
| Assistente | Conversa para sugerir categorias e revisar transferências |
| Open Finance | Conexão Pluggy em sandbox e consulta de contas e movimentações |
| Planejamento | Limite mensal e objetivo de reserva (valores demonstrativos) |
| Relatórios | Totais do mês e gastos agrupados por categoria |
| Configurações | Preferências e informações sobre armazenamento |

## Ideia para uma fase futura

Depois de validar o uso pessoal, o projeto pode evoluir para uma versão GestorPro para estabelecimentos, com empresas, clientes, vendas, financeiro e isolamento multiempresa. Essa futura versão terá modelo de dados e políticas separados dos dados pessoais para não misturar os dois produtos.

## Arquivos

- `index.html`: estrutura e navegação.
- `styles.css`: identidade escura, detalhes azuis e layout responsivo.
- `gestorpro-client.js`: telas navegáveis, dados de demonstração e persistência local no navegador.
- `server.mjs`: servidor local e endpoints protegidos para a integração Pluggy.
- `.env.example`: modelo das credenciais da Pluggy; copie para `.env` e preencha localmente.
- `package.json`: comando para iniciar o servidor local.
- `supabase/schema.sql`: estrutura inicial de contas, lançamentos, limites e políticas RLS por usuário.
- `personal.css`: estilos das contas e do chat de categorização.
- `supabase-config.js`: URL e chave publicável do Supabase (sem segredos de servidor).
- `supabase/functions/categorize-transaction/index.ts`: função protegida que chama a Responses API e devolve uma resposta estruturada.

## Como conferir o protótipo

### Rodar com o sandbox Open Finance

1. No Dashboard da Pluggy, crie uma aplicação e copie o `CLIENT_ID` e `CLIENT_SECRET`.
2. Abra o arquivo `.env` na pasta do projeto e preencha `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`. Mantenha `PLUGGY_INCLUDE_SANDBOX=true` para usar dados fictícios. Esse arquivo é ignorado pelo Git. Não compartilhe o Client Secret.
3. No terminal integrado do VS Code, execute `npm start`.
4. Abra `http://127.0.0.1:4173`, entre em **Open Finance** e clique em **Conectar instituição**. Para o conector Pluggy Bank de teste, a documentação indica `user-ok`, senha `password-ok` e, se pedir MFA, `123456`.
5. Após a conexão, o GestorPro consulta as contas e as movimentações pelo servidor local. O identificador da conexão fica no armazenamento local do navegador; as credenciais da Pluggy ficam apenas no `.env`.

O sandbox não acessa contas bancárias reais. A produção exige que a Pluggy habilite o acesso e que você autorize o compartilhamento no fluxo do banco. Para rodar apenas o restante do GestorPro, sem Open Finance, abra `index.html` ou use outro servidor local; os dados de exemplo permanecem locais. Sem URL/chave Supabase, sessão autenticada e função publicada, o chat usa sugestões locais de demonstração. Ainda não há sincronização entre dispositivos. A integração OpenAI recebe apenas o texto digitado no chat e não consulta transações bancárias.

## Etapas seguintes

1. Criar um projeto Supabase, habilitar login por e-mail e senha e executar `supabase/schema.sql`.
2. Copiar a URL e a chave **publicável** do Supabase para `supabase-config.js`. Não colocar chave `secret`, `service_role` nem `OPENAI_API_KEY` nesse arquivo.
3. No Dashboard do Supabase, adicionar os segredos `OPENAI_API_KEY` e `GESTORPRO_ALLOWED_ORIGINS` em Edge Function Secrets. O último deve conter a origem do site, por exemplo `http://localhost:5500`; em produção, usar a origem do domínio publicado. Não envie a chave OpenAI no chat nem a coloque nos arquivos do navegador.
4. Pelo terminal, conectar a pasta ao projeto e publicar a função: `supabase link --project-ref SEU_PROJECT_REF` e `supabase functions deploy categorize-transaction`. A função mantém a verificação JWT ativada. Ela envia a mensagem e até oito mensagens anteriores do chat à OpenAI, valida o tamanho e recebe uma resposta de categoria em formato estruturado.
5. Entrar em **Configurações**, criar uma conta e depois testar o chat. Cada categoria sugerida ainda precisa da sua revisão antes de virar lançamento.
6. Conferir manualmente falhas de login, origem bloqueada, ausência da chave e mensagens ambíguas. Os dados bancários completos não devem ser copiados para o chat.
7. Depois migrar a persistência local das contas e lançamentos para o Supabase, com políticas de acesso por usuário. A chave OpenAI fica só na função do servidor; a OpenAI recomenda nunca expor essa chave em navegador ou aplicativo cliente ([orientação de segurança de chaves](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)).
8. Solicitar à Pluggy o acesso de produção; configurar `PLUGGY_INCLUDE_SANDBOX=false` somente depois da ativação e testar a autorização real com consentimento no aplicativo do banco.

Para desenvolvimento local, copie `supabase/functions/.env.example` para `supabase/functions/.env`, substitua o valor de `OPENAI_API_KEY` e use um servidor HTTP local na porta `5500`. O `.env` local é ignorado pelo Git. Para produção, configure os valores em Edge Function Secrets no Supabase. A função usa a OpenAI Responses API com resposta estruturada e exige sessão Supabase válida; a API key fica no ambiente da função ([Responses API](https://developers.openai.com/api/docs/guides/text), [saídas estruturadas](https://developers.openai.com/api/docs/guides/structured-outputs), [segredos de Edge Functions](https://supabase.com/docs/guides/functions/secrets), [autorização de Edge Functions](https://supabase.com/docs/guides/functions/auth-headers)).

## Acesso pela internet com sua conta Google

A hospedagem pronta está descrita em `render.yaml`. Ela configura a aplicação para receber tráfego da internet, exigir uma sessão Supabase e aceitar somente o login Google `ruandiasmaiasilva@gmail.com`. O servidor verifica essa identidade antes de liberar as rotas da Pluggy; as tabelas também têm políticas RLS próprias para essa conta. O Client Secret Pluggy fica apenas nas variáveis privadas do serviço.

1. No Supabase, crie ou escolha um projeto ativo e rode `supabase/migrations/20261104_personal_finance_data.sql` no SQL Editor. A tabela guarda o resumo financeiro de cada usuário, e a política permite apenas o UUID associado ao e-mail Google autorizado.
2. Em **Authentication → Providers**, habilite Google. Configure o Client ID e o Client Secret OAuth do Google. No Google Cloud, inclua como URI de redirecionamento o callback mostrado pelo Supabase (`https://SEU-PROJETO.supabase.co/auth/v1/callback`). Desabilite os demais provedores de entrada.
3. Em **Authentication → URL Configuration**, configure o Site URL e a URL de redirecionamento permitida com o endereço HTTPS que o Render atribuir ao serviço.
4. Publique o repositório no Render usando o Blueprint `render.yaml`. Preencha as variáveis privadas `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` no painel do serviço. O e-mail autorizado já está no Blueprint. Não coloque segredos no navegador nem no Git.
5. No primeiro login Google, o GestorPro perguntará antes de enviar seus dados locais ao Supabase. Depois da confirmação, contas manuais, lançamentos, categorias, caixinhas e conexões Pluggy sincronizam entre aparelhos. Se houver dados locais e online divergentes, o app pede confirmação antes de mesclar ou substituir.

O plano gratuito do Render desliga o serviço após 15 minutos sem tráfego e não mantém arquivos locais entre implantações; os dados do GestorPro ficam no Supabase, não no disco do Render. Pode haver uma espera na primeira abertura após o serviço dormir. Consulte as [limitações do plano gratuito](https://render.com/docs/free) e a [configuração de serviços web](https://render.com/docs/web-services).
