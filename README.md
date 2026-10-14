# Entrelinhas

Leitor bilíngue de livros para Android. Você importa livros, lê e traduz palavras ou parágrafos com IA (Gemini) ou offline (ML Kit). Também dá para ouvir o livro, destacar trechos, estudar o vocabulário com repetição espaçada, manter uma ofensiva diária e sincronizar tudo entre aparelhos.

## Estrutura

```
backend/             API em TypeScript (Node 24 roda o .ts direto) com Fastify e SQLite.
  src/
    auth/            conta do aparelho, cadastro e login (scrypt, JWT), guarda das rotas
    translate/       Gemini, prompts e cota diária
    sync/            snapshot e arquivos dos livros (upload em streaming)
    crashes/         relatórios de erro do app
    migrations/      SQL numerado, aplicado na subida
    app.ts           monta a API (erros, rate limit, rotas); server.ts sobe e desliga limpo
  test/              testes com app.inject (sem rede, banco temporário)
android/             Kotlin + Jetpack Compose (AGP 9.2.1, Gradle 9.4.1, minSdk 24).
docker-compose.yml   o backend no servidor; dados em ./storage
.github/             CI, APK por PR/Release, segurança e Dependabot (mesmo esquema do ReadUp)
```

## Backend

### No servidor (Docker)

```bash
cp .env.example .env     # preencha GEMINI_API_KEY e JWT_SECRET
docker compose up -d --build
docker compose logs -f api
```

- **Dados:** `./storage`, ou a pasta definida em `STORAGE_DIR` (ex.: `/mnt/dados/entrelinhas`), com o banco `leitor.db` e a pasta `files/`. É o que entra no backup do servidor.
- **Atualizar:** `git pull && docker compose up -d --build`. As migrações rodam sozinhas na subida.
- **Saúde:** o container tem healthcheck em `/health`. O `docker stop` termina as requisições em andamento e fecha o banco.
- **Logs:** em JSON no stdout (`docker compose logs`). Crashes do app aparecem como `app crash`.
- **Acesso de fora de casa:** coloque a API atrás de um proxy com HTTPS (Caddy, Nginx Proxy Manager ou Cloudflare Tunnel) e defina `TRUST_PROXY=true`, para o rate limit enxergar o IP real. O APK de produção só aceita `https://`.

### Desenvolvimento

```bash
cd backend
npm install
GEMINI_API_KEY=... npm run dev    # porta 8787, recarrega ao salvar; dados em backend/data/
npm test                          # testes
npm run typecheck                 # TypeScript
npm run lint                      # Biome (lint + formatação); npm run format corrige
```

| Variável | Padrão | |
|---|---|---|
| `GEMINI_API_KEY` | — | obrigatória em produção |
| `JWT_SECRET` | em dev, gerado e salvo em `DATA_DIR/jwt-secret` | obrigatória em produção (32+ caracteres) |
| `DATA_DIR` | `backend/data` (`/app/data` no container) | banco SQLite e arquivos dos livros |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | ~0,85 s por parágrafo; `gemini-3.7-flash` levou ~4 s e teve 503 nos testes |
| `DAILY_CHAR_LIMIT` | `200000` | caracteres por conta por dia |
| `MAX_ACCOUNT_BYTES` | 1 GB | espaço na nuvem por conta |
| `TRUST_PROXY` | `false` | `true` atrás de proxy reverso |
| `LOG_LEVEL` | `info` | |
| `PORT` | `8787` | |

Com `NODE_ENV=production` (que é o caso do container), o servidor não sobe se faltar `GEMINI_API_KEY` ou um `JWT_SECRET` forte.

### Contas

Todo aparelho tem uma conta anônima: o app gera um id e um segredo aleatórios e chama `POST /auth/device`. É essa conta que guarda a cota de tradução.

Para backup e sincronização, a pessoa cria uma conta com e-mail e senha:
- rotas `POST /auth/signup` e `POST /auth/login`;
- senha com scrypt e token JWT HS256 válido por 30 dias;
- e-mail inexistente e senha errada dão a mesma resposta;
- depois de 10 tentativas erradas, o e-mail fica bloqueado por 15 minutos;
- cada IP pode fazer até 20 chamadas de login por minuto.

Todas as rotas abaixo exigem `Authorization: Bearer <token>`. Os erros sempre vêm como `{success: false, error: {code, message}}`.

### Rotas

| Rota | Corpo / resposta |
|---|---|
| `POST /translate` | `{text, sourceLang, targetLang, context?}`; com `context` (a frase), traduz só a palavra no sentido da frase |
| `POST /translate/batch` | `{targetLanguage, sourceLanguage?, items:[{blockId, text}]}` |
| `GET /sync/snapshot` | `{version, snapshot}` |
| `PUT /sync/snapshot` | `{version, snapshot}`; responde 409 se outro aparelho enviou antes |
| `GET /sync/files` | sha256 dos livros guardados |
| `GET`, `PUT`, `DELETE /sync/files/<sha256>` | arquivo original do livro (até 80 MB, `application/octet-stream`) |
| `POST /crash` | `{report, appVersion}`; até 50 por conta por dia |

## Android

Abra `android/` no Android Studio, ou rode:

```bash
cd android
./gradlew assembleDebug testDebugUnitTest
./gradlew installDebug -PbackendUrl=https://seu-backend.onrender.com
```

Sem `-PbackendUrl`, o app usa `http://10.0.2.2:8787`, que é o backend rodando no seu PC visto de dentro do emulador.

### Release

```bash
./gradlew assembleRelease -PbackendUrl=https://seu-backend.onrender.com
```

O build de release:
- passa pelo R8 e encolhe os recursos;
- gera um APK por arquitetura (arm64 ~35 MB; o debug tem ~147 MB) e um universal;
- só libera HTTP sem TLS quando o `backendUrl` é `http://`.

Para assinar com a sua chave, crie `android/keystore.properties` (ele fica fora do git):

```properties
storeFile=../minha-chave.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Sem esse arquivo, o release é assinado com a chave de debug, o que serve para testar.

### Textos

Todos os textos do app ficam em `app/src/main/res/values/strings.xml`, em PT-BR. Para traduzir o app, crie `values-en/strings.xml` (ou outro idioma) com as mesmas chaves.

## Funcionalidades

- **Onboarding:** 6 páginas e uma de configuração (meta diária, lembrete, idioma e "Já tem conta? Entrar e restaurar")
- **Importação:**
  - EPUB, FB2/FBZ, PDF e TXT, pelo seletor de arquivos, por "Abrir com" / "Compartilhar" ou pela tela **Livros grátis**
  - Livros grátis: Gutenberg, Standard Ebooks, Wikisource e Internet Archive num navegador interno; o download entra direto na biblioteca
  - arquivos duplicados são detectados pelo sha256
- **PDF:** texto e imagens na ordem em que aparecem na página, capítulos do sumário do PDF e OCR (ML Kit, offline) em PDFs escaneados
- **Leitor:**
  - palavra traduzida no sentido da frase, com pronúncia e botão Salvar (guarda também a frase de exemplo)
  - tradução de parágrafo, que fica salva ao reabrir o livro; modo **Auto**
  - **Sumário** (EPUB nav/NCX, outline do PDF ou títulos de capítulo) e **Buscar** (sem diferenciar acentos); rolar continua passando de capítulo
  - **Ouvir o livro** (texto em voz, com velocidade ajustável)
  - **Destaques e notas**: pressione e segure uma frase
- **Cache de traduções:** a mesma tradução online nunca é paga duas vezes
- **Vocabulário:**
  - repetição espaçada (Leitner: 1, 3, 7, 14, 30 e 90 dias) com flashcard, frase de exemplo e pronúncia
  - exportação em CSV pronto para o Anki
- **Ofensiva:**
  - meta diária em minutos de leitura ativa, com escudos que cobrem dias sem leitura
  - lembrete diário por notificação, que só aparece se a meta ainda não foi batida
- **Conta e backup:** sincroniza livros (arquivos), progresso, vocabulário, destaques e estatísticas
  - em cada registro vence a alteração mais recente
  - exclusões são propagadas
  - as estatísticas do dia ficam com o maior valor, para nada contar duas vezes
- **Relatório de erros:** crashes são gravados no aparelho e enviados ao backend na abertura seguinte
- **Progresso:** ofensiva, tempo de leitura, gráfico de traduções e detalhes

## Testes e pipeline

- **`backend`:** `npm test`, com 15 testes (auth, token adulterado, rate limit, cota, falha do modelo, sync, arquivos, limite de espaço, crash, health).
- **`android`:** `./gradlew lintDebug testDebugUnitTest`, com 17 testes (parser de livros, Leitner, ofensiva, CSV e a mesclagem da sincronização).

No GitHub (`.github/`), no mesmo esquema do ReadUp, com as branches `master` (produção) e `homolog`:

| Workflow | O que faz |
|---|---|
| `ci.yml` | Backend: Biome, TypeScript, testes e build da imagem Docker. Android: lint, testes e build. |
| `android.yml` | APK de release (com R8) em todo PR, com o link comentado no PR; o merge vira Release. |
| `security.yml` | CodeQL (TypeScript e Kotlin), revisão de dependências nos PRs e `npm audit`. Roda também toda segunda-feira. |
| `dependabot.yml` | Atualizações semanais de actions, npm, Gradle e da imagem base do Docker. |

Para o `android.yml`, crie os Environments `production` e `homolog` no repositório:
- **Variável `API_URL`:** `https://...` na produção; a homolog aceita `http://` (backend na rede de casa).
- **Secrets opcionais:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`. Sem eles, o APK sai assinado com uma chave de debug que muda a cada execução, e é preciso desinstalar o app antes de atualizar.

## Fora do escopo (próximos passos)

- Play Billing, AdMob rewarded e Firebase
- PDF: diagramas vetoriais (que não estão embutidos como imagem) não aparecem
- a tradução não preserva negrito e itálico (o backend devolve texto puro)
- livros importados antes da versão com hash de conteúdo não entram na sincronização (basta importá-los de novo)
- traduções de parágrafo salvas não vão para a nuvem (são refeitas sob demanda e ficam no cache)
