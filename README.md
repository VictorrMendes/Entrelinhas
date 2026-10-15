<a id="readme-top"></a>

[![CI][ci-shield]][ci-url]
[![APK][apk-shield]][apk-url]
[![Security][security-shield]][security-url]
[![Último commit][commit-shield]][commit-url]
[![Issues][issues-shield]][issues-url]

<br />
<div align="center">
  <a href="https://github.com/VictorrMendes/Entrelinhas">
    <img src="docs/logo.png" alt="Logo" width="96" height="96">
  </a>

  <h3 align="center">Entrelinhas</h3>

  <p align="center">
    Leitor bilíngue de livros para Android: leia no original, entenda cada frase e treine o ouvido.
    <br />
    <a href="#como-usar"><strong>Ver como funciona »</strong></a>
    <br />
    <br />
    <a href="https://github.com/VictorrMendes/Entrelinhas/releases">Baixar APK</a>
    &middot;
    <a href="https://github.com/VictorrMendes/Entrelinhas/issues/new?labels=bug">Reportar bug</a>
    &middot;
    <a href="https://github.com/VictorrMendes/Entrelinhas/issues/new?labels=enhancement">Pedir recurso</a>
  </p>
</div>

<details>
  <summary>Sumário</summary>
  <ol>
    <li>
      <a href="#sobre-o-projeto">Sobre o projeto</a>
      <ul>
        <li><a href="#funcionalidades">Funcionalidades</a></li>
        <li><a href="#feito-com">Feito com</a></li>
      </ul>
    </li>
    <li>
      <a href="#primeiros-passos">Primeiros passos</a>
      <ul>
        <li><a href="#requisitos">Requisitos</a></li>
        <li><a href="#backend">Backend</a></li>
        <li><a href="#android">Android</a></li>
      </ul>
    </li>
    <li><a href="#como-usar">Como usar</a></li>
    <li><a href="#arquitetura">Arquitetura</a></li>
    <li><a href="#testes-e-pipeline">Testes e pipeline</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contribuindo">Contribuindo</a></li>
    <li><a href="#licença">Licença</a></li>
    <li><a href="#contato">Contato</a></li>
    <li><a href="#agradecimentos">Agradecimentos</a></li>
  </ol>
</details>

## Sobre o projeto

<div align="center">

| Biblioteca | Modo Entrelinhas | Explicar com IA | Progresso |
|:---:|:---:|:---:|:---:|
| <img src="docs/screenshots/biblioteca.png" width="200" alt="Biblioteca com nível CEFR dos livros"> | <img src="docs/screenshots/entrelinhas.png" width="200" alt="Tradução de cada frase logo abaixo dela"> | <img src="docs/screenshots/explicar.png" width="200" alt="Explicação de uma expressão pela IA"> | <img src="docs/screenshots/progresso.png" width="200" alt="Nível, XP e estatísticas"> |

</div>

O Entrelinhas é um leitor de livros para quem está aprendendo outro idioma. Você lê o livro no original e, quando trava, toca na palavra: a tradução vem no sentido daquela frase. Se quiser, a tradução de cada frase aparece logo abaixo dela, nas entrelinhas.

Por que ele existe:
* **Ler no original é o melhor treino**, mas parar a leitura para abrir o dicionário cansa e faz desistir.
* **Tradutor comum erra o sentido:** em "a bright cold day", "bright" é "claro", não "brilhante". O app traduz a palavra olhando a frase inteira.
* **Ler não basta para ouvir bem.** Por isso o app também lê em voz alta, faz ditado e dá nota para a sua pronúncia.
* **O que você aprende fica com você.** Palavras salvas viram revisão espaçada e são sublinhadas sempre que voltam no livro.

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

### Funcionalidades

**Leitura**
- EPUB, FB2/FBZ, PDF e TXT, importados pelo seletor de arquivos, por "Abrir com" / "Compartilhar" ou pela tela **Livros grátis**
- **Livros grátis:** Gutenberg, Standard Ebooks, Wikisource e Internet Archive num navegador interno; o download entra direto na biblioteca
- **PDF:** texto e imagens na ordem da página, capítulos do sumário do PDF e OCR (ML Kit, offline) em PDFs escaneados
- **Sumário** e links internos (EPUB nav/NCX, FB2, outline do PDF ou títulos de capítulo) e **Buscar** sem diferenciar acentos
- **Aa:**
  - temas claro, sépia, escuro e noite;
  - tamanho da letra, espaçamento, margens e fonte (Literata ou Nunito);
  - voz de leitura.
- **Destaques e notas**

**Tradução e IA**
- Palavra traduzida no sentido da frase, online (Gemini) ou offline (ML Kit)
- **Expressões:** as setas ‹ › incluem a palavra anterior ou a próxima ("gave up", "on the other hand")
- **Explicar:** a IA explica o sentido na frase, a gramática e dá um exemplo novo
- **Modo Entrelinhas:** tradução de cada frase logo abaixo dela, ou do parágrafo inteiro; fica salva ao reabrir o livro
- **Nível CEFR** de cada livro (A1–C2), estimado pela IA uma vez por livro
- **Cache:** a mesma tradução online nunca é paga duas vezes

**Escuta**
- **Ouvir o livro:**
  - a palavra falada fica marcada no texto;
  - barra com frase anterior/próxima e velocidade;
  - "só ouvido", que esconde o texto até você tocar.
- **Pressione e segure uma frase:**
  - ouvir em loop e mais devagar;
  - traduzir e explicar;
  - ditado de 10 frases;
  - falar a frase e receber uma nota de pronúncia.
- **Vozes:** as do próprio Android (gratuitas e offline), escolhidas por idioma

**Vocabulário**
- Repetição espaçada (Leitner: 1, 3, 7, 14, 30 e 90 dias) com flashcard, frase de exemplo e pronúncia
- **Treinar escuta:** flashcards que começam pelo áudio e ditado com as frases de exemplo
- Palavras e expressões salvas aparecem sublinhadas no livro
- Exportação em CSV pronto para o Anki

**Hábito e progresso**
- **Ofensiva:** meta diária em minutos de leitura ativa, com escudos que cobrem dias sem leitura
- **Lembrete diário:** só aparece se a meta ainda não foi batida
- **XP, nível e 10 conquistas**, com aviso ao desbloquear
- **Gráfico de traduções**, tempo de leitura e detalhes por período

**Biblioteca e nuvem**
- **Estantes:** criadas pelo menu do livro, viram filtros na biblioteca
- **Conta com e-mail:** "Esqueci minha senha" por código enviado no e-mail
- **Sincronização:** livros (arquivos), progresso, vocabulário, destaques, estantes e estatísticas
  - vence a alteração mais recente de cada registro;
  - exclusões são propagadas;
  - estatísticas do dia ficam com o maior valor, para nada contar duas vezes.
- **Relatório de erros:** crashes são gravados no aparelho e enviados na abertura seguinte

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

### Feito com

* [![Kotlin][kotlin-badge]][kotlin-url] [![Jetpack Compose][compose-badge]][compose-url] [![ML Kit][mlkit-badge]][mlkit-url]
* [![Node.js][node-badge]][node-url] [![TypeScript][ts-badge]][ts-url] [![Fastify][fastify-badge]][fastify-url] [![SQLite][sqlite-badge]][sqlite-url]
* [![Gemini][gemini-badge]][gemini-url] [![NVIDIA][nvidia-badge]][nvidia-url]
* [![Docker][docker-badge]][docker-url] [![GitHub Actions][actions-badge]][actions-url]

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Primeiros passos

### Requisitos

* **Android:** Android Studio (ou JDK 17+). O Gradle vem no projeto (`gradlew`). O app roda do Android 7 (API 24) em diante.
* **Backend:**
  * Node.js 24, que roda o `.ts` direto, sem build;
  * ou Docker, no servidor.
* **Chave do Gemini:** gratuita em [Google AI Studio](https://aistudio.google.com/apikey).
* **Opcional:**
  * chave da NVIDIA em [build.nvidia.com](https://build.nvidia.com);
  * conta de e-mail com SMTP, para o "Esqueci minha senha".

```sh
git clone https://github.com/VictorrMendes/Entrelinhas.git
cd Entrelinhas
```

### Backend

#### No servidor (Docker)

```sh
cp .env.example .env     # preencha GEMINI_API_KEY e JWT_SECRET
docker compose up -d --build
docker compose logs -f api
```

- **Dados:** ficam em `./storage`, ou na pasta definida em `STORAGE_DIR` (ex.: `/mnt/dados/entrelinhas`). Lá estão o banco `leitor.db` e a pasta `files/`, e é isso que deve entrar no backup do servidor.
- **Atualizar:** `git pull && docker compose up -d --build`. As migrações rodam sozinhas na subida.
- **Saúde:** o container tem healthcheck em `/health`. O `docker stop` termina as requisições em andamento e fecha o banco.
- **Logs:** em JSON no stdout (`docker compose logs`). Crashes do app aparecem como `app crash`.
- **Acesso de fora de casa:** coloque a API atrás de um proxy com HTTPS (Caddy, Nginx Proxy Manager ou Cloudflare Tunnel) e defina `TRUST_PROXY=true`, para o rate limit enxergar o IP real. O APK de produção só aceita `https://`.

#### Desenvolvimento

```sh
cd backend
npm install
GEMINI_API_KEY=... npm run dev    # porta 8787, recarrega ao salvar; dados em backend/data/
npm test                          # testes
npm run typecheck                 # TypeScript
npm run lint                      # Biome (lint + formatação); npm run format corrige
```

#### Variáveis de ambiente

| Variável | Padrão | |
|---|---|---|
| `GEMINI_API_KEY` | — | obrigatória em produção |
| `JWT_SECRET` | em dev, gerado e salvo em `DATA_DIR/jwt-secret` | obrigatória em produção (32+ caracteres) |
| `DATA_DIR` | `backend/data` (`/app/data` no container) | banco SQLite e arquivos dos livros |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | ~0,85 s por parágrafo; `gemini-3.7-flash` levou ~4 s e teve 503 nos testes |
| `NVIDIA_API_KEY` | — | opcional; modelos gratuitos da NVIDIA (40 req/min) calculam o nível dos livros e respondem quando o Gemini está no limite |
| `NVIDIA_MODEL` | `moonshotai/kimi-k3` | o `deepseek-v4.1-flash` passou de 120 s sem responder nos testes |
| `SMTP_URL` | — | envia o código do "Esqueci minha senha"; sem ele, em produção a rota responde `RESET_UNAVAILABLE` (em dev o código aparece no log) |
| `MAIL_FROM` | `Entrelinhas <no-reply@localhost>` | remetente dos e-mails |
| `DAILY_CHAR_LIMIT` | `200000` | caracteres por conta por dia |
| `MAX_ACCOUNT_BYTES` | 1 GB | espaço na nuvem por conta |
| `TRUST_PROXY` | `false` | `true` atrás de proxy reverso |
| `LOG_LEVEL` | `info` | |
| `PORT` | `8787` | |

Com `NODE_ENV=production`, que é o caso do container, o servidor não sobe se faltar `GEMINI_API_KEY` ou um `JWT_SECRET` forte.

Para o e-mail do "Esqueci minha senha" sair pelo Gmail, crie uma [senha de app](https://myaccount.google.com/apppasswords) e preencha no `.env`:

```env
SMTP_URL=smtps://seu.email%40gmail.com:senha-de-app@smtp.gmail.com:465
MAIL_FROM=Entrelinhas <seu.email@gmail.com>
```

### Android

Abra `android/` no Android Studio ou rode:

```sh
cd android
./gradlew assembleDebug testDebugUnitTest
./gradlew installDebug -PbackendUrl=https://seu-backend.exemplo.com
```

Sem `-PbackendUrl`, o app usa `http://10.0.2.2:8787`, que é o backend rodando no seu PC visto de dentro do emulador.

#### Release

```sh
./gradlew assembleRelease -PbackendUrl=https://seu-backend.exemplo.com
```

O build de release:
- passa pelo R8 e encolhe os recursos;
- gera um APK por arquitetura (arm64 ~35 MB; o debug tem ~147 MB) e um universal;
- só libera HTTP sem TLS quando o `backendUrl` é `http://`.

Para assinar com a sua chave, crie `android/keystore.properties`, que fica fora do git:

```properties
storeFile=../minha-chave.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Sem esse arquivo, o release é assinado com a chave de debug, o que serve para testar.

#### Textos

Todos os textos do app ficam em `app/src/main/res/values/strings.xml`, em PT-BR. Para traduzir o app, crie `values-en/strings.xml` (ou outro idioma) com as mesmas chaves.

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Como usar

1. **Adicione um livro:**
   - pelo **Adicionar livro**;
   - pelo "Abrir com" de outro app;
   - ou pelos **Livros grátis**.

   O nível CEFR aparece no cartão depois de alguns segundos.
2. **Toque numa palavra** para ver a tradução no sentido da frase. Use ‹ › para formar uma expressão, **Explicar** para entender a gramática e **Salvar** para estudar depois.
3. **Pressione e segure uma frase** para ouvi-la em loop ou mais devagar, traduzir, explicar, fazer um ditado, treinar a pronúncia ou destacar.
4. No **Aa**, escolha o tema, a fonte, o espaçamento, a voz e se a tradução vem frase por frase (modo Entrelinhas) ou por parágrafo.
5. No **▶**, ouça o livro com a palavra marcada no texto. Ative o modo **só ouvido** para treinar sem ler.
6. No **Vocabulário**, revise as palavras do dia, treine a escuta com ditados e exporte para o Anki.
7. No **Progresso**, acompanhe a ofensiva, o XP e as conquistas. Em **Ajustes**, entre com e-mail para sincronizar entre aparelhos.

### Contas

Todo aparelho tem uma conta anônima: o app gera um id e um segredo aleatórios e chama `POST /auth/device`. É essa conta que guarda a cota de tradução.

Para backup e sincronização, a pessoa cria uma conta com e-mail e senha:
- rotas `POST /auth/signup` e `POST /auth/login`;
- senha com scrypt e token JWT HS256 válido por 30 dias;
- e-mail inexistente e senha errada dão a mesma resposta;
- depois de 10 tentativas erradas, o e-mail fica bloqueado por 15 minutos;
- cada IP pode fazer até 20 chamadas de login por minuto;
- **Esqueci minha senha:**
  - `POST /auth/password/forgot` manda por e-mail um código de 6 dígitos, válido por 15 minutos, e responde igual para e-mails sem conta;
  - `POST /auth/password/reset` recebe `{email, code, password}` e devolve um token novo;
  - o código aceita 5 tentativas;
  - a troca de senha derruba as sessões abertas antes dela.

### API

Todas as rotas abaixo exigem `Authorization: Bearer <token>`. Os erros sempre vêm como `{success: false, error: {code, message}}`.

| Rota | Corpo / resposta |
|---|---|
| `POST /translate` | `{text, sourceLang, targetLang, context?}`; com `context` (a frase), traduz só a palavra no sentido da frase |
| `POST /translate/batch` | `{targetLanguage, sourceLanguage?, items:[{blockId, text}]}`; usada pelo modo Entrelinhas, frase por frase |
| `POST /explain` | `{text, sentence, sourceLang, targetLang}` → `{explanation}`; Gemini primeiro (rápido), NVIDIA de reserva |
| `POST /level` | `{sample, language}` → `{level}` (A1–C2); NVIDIA primeiro (trabalho de fundo), Gemini de reserva |
| `GET /sync/snapshot` | `{version, snapshot}` |
| `PUT /sync/snapshot` | `{version, snapshot}`; responde 409 se outro aparelho enviou antes |
| `GET /sync/files` | sha256 dos livros guardados |
| `GET`, `PUT`, `DELETE /sync/files/<sha256>` | arquivo original do livro (até 80 MB, `application/octet-stream`) |
| `POST /crash` | `{report, appVersion}`; até 50 por conta por dia |

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Arquitetura

```
backend/             API em TypeScript (Node 24 roda o .ts direto) com Fastify e SQLite
  src/
    auth/            conta do aparelho, cadastro, login, recuperação de senha e guarda das rotas
    translate/       Gemini, NVIDIA (com reserva entre os dois), prompts e cota diária
    sync/            snapshot e arquivos dos livros (upload em streaming)
    crashes/         relatórios de erro do app
    migrations/      SQL numerado, aplicado na subida
    mail.ts          envio de e-mail por SMTP
    app.ts           monta a API (erros, rate limit, rotas); server.ts sobe e desliga limpo
  test/              testes com app.inject (sem rede, banco temporário)
android/             Kotlin + Jetpack Compose (AGP 9.2.1, Gradle 9.4.1, minSdk 24)
docs/                logo e capturas de tela deste README
docker-compose.yml   o backend no servidor; dados em ./storage
.github/             CI, APK por PR/Release, segurança e Dependabot
```

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Testes e pipeline

- **`backend`:** `npm test`, com 21 testes:
  - auth, token adulterado e rate limit;
  - recuperação de senha;
  - cota, falha do modelo, Explicar com reserva e nível do livro;
  - sync, arquivos e limite de espaço;
  - crash e health.
- **`android`:** `./gradlew lintDebug testDebugUnitTest`, com 25 testes:
  - parser de livros, links e expressões;
  - Leitner, ofensiva, CSV, ditado e XP/conquistas;
  - mesclagem da sincronização;
  - testes de interface com Robolectric, que rodam na JVM, sem emulador, inclusive na CI.

No GitHub (`.github/`), as branches são `master` (produção) e `homolog`:

| Workflow | O que faz |
|---|---|
| `ci.yml` | Backend: Biome, TypeScript, testes e build da imagem Docker. Android: lint, testes e build. |
| `android.yml` | APK de release (com R8) em todo PR, com o link comentado no PR; o merge vira Release. |
| `security.yml` | CodeQL (TypeScript e Kotlin), revisão de dependências nos PRs e `npm audit`. Roda também toda segunda-feira. |
| `dependabot.yml` | Atualizações semanais de actions, npm, Gradle e da imagem base do Docker. |

Para o `android.yml`, crie os Environments `production` e `homolog` no repositório:
- **Variável `API_URL`:** `https://...` na produção; a homolog aceita `http://` (backend na rede de casa).
- **Secrets opcionais:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`. Sem eles, o APK sai assinado com uma chave de debug que muda a cada execução, e é preciso desinstalar o app antes de atualizar.

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Roadmap

- [x] Leitor de EPUB, FB2, PDF (com OCR) e TXT, com sumário, busca e links internos
- [x] Tradução por palavra, frase e parágrafo, online e offline
- [x] Modo Entrelinhas, expressões e Explicar com IA
- [x] Treino de escuta: leitura com a palavra marcada, loop, ditado e nota de pronúncia
- [x] Vocabulário com repetição espaçada e exportação para o Anki
- [x] Conta, sincronização entre aparelhos e recuperação de senha
- [x] XP, conquistas, estantes e nível CEFR dos livros
- [ ] Vozes neurais gratuitas com [Piper](https://github.com/OHF-Voice/piper1-gpl) no servidor do backend (offline, roda em CPU, ~35 idiomas)
- [ ] Versão web instalável (PWA) para iPhone
- [ ] Excluir conta e política de privacidade
- [ ] Traduções de parágrafo salvas na nuvem (hoje são refeitas sob demanda e ficam no cache)
- [ ] Tradução que preserva negrito e itálico (o backend devolve texto puro)
- [ ] Diagramas vetoriais de PDF (os que não estão embutidos como imagem não aparecem)
- [ ] Interface em outros idiomas
- [ ] Play Billing, AdMob e Firebase

Limitação conhecida: livros importados antes da versão com hash de conteúdo não entram na sincronização. Basta importá-los de novo.

Veja as [issues abertas](https://github.com/VictorrMendes/Entrelinhas/issues) para a lista completa de ideias e problemas conhecidos.

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Contribuindo

Sugestões e correções são bem-vindas. Se tiver uma ideia, abra uma issue com a etiqueta `enhancement`, ou mande um pull request:

1. Faça um fork do projeto.
2. Crie uma branch a partir da `homolog`: `git checkout -b feature/minha-ideia homolog`.
3. Rode os testes: `npm test` no `backend/` e `./gradlew lintDebug testDebugUnitTest` no `android/`.
4. Faça o commit: `git commit -m "Adiciona minha ideia"`.
5. Envie a branch: `git push origin feature/minha-ideia`.
6. Abra um pull request para a `homolog`. A CI roda os testes e comenta no PR o link do APK para testar.

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Licença

Ainda não há uma licença definida. Até lá, o código pode ser lido e estudado, mas os direitos ficam com o autor.

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Contato

Victor Mendes: [@VictorrMendes](https://github.com/VictorrMendes)

Projeto: [https://github.com/VictorrMendes/Entrelinhas](https://github.com/VictorrMendes/Entrelinhas)

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

## Agradecimentos

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template), a base deste README
* [Project Gutenberg](https://www.gutenberg.org), [Standard Ebooks](https://standardebooks.org), [Wikisource](https://wikisource.org) e [Internet Archive](https://archive.org), pelos livros grátis
* [Google ML Kit](https://developers.google.com/ml-kit), pela tradução offline, pela detecção de idioma e pelo OCR
* [PdfBox-Android](https://github.com/TomRoush/PdfBox-Android), pela leitura dos PDFs
* [Nunito](https://fonts.google.com/specimen/Nunito) e [Literata](https://fonts.google.com/specimen/Literata), pelas fontes do app e do leitor
* [Shields.io](https://shields.io), pelos badges

<p align="right">(<a href="#readme-top">voltar ao topo</a>)</p>

<!-- LINKS E IMAGENS -->
[ci-shield]: https://img.shields.io/github/actions/workflow/status/VictorrMendes/Entrelinhas/ci.yml?branch=master&style=for-the-badge&label=CI
[ci-url]: https://github.com/VictorrMendes/Entrelinhas/actions/workflows/ci.yml
[apk-shield]: https://img.shields.io/github/actions/workflow/status/VictorrMendes/Entrelinhas/android.yml?branch=master&style=for-the-badge&label=APK
[apk-url]: https://github.com/VictorrMendes/Entrelinhas/actions/workflows/android.yml
[security-shield]: https://img.shields.io/github/actions/workflow/status/VictorrMendes/Entrelinhas/security.yml?branch=master&style=for-the-badge&label=Security
[security-url]: https://github.com/VictorrMendes/Entrelinhas/actions/workflows/security.yml
[commit-shield]: https://img.shields.io/github/last-commit/VictorrMendes/Entrelinhas?style=for-the-badge&label=%C3%BAltimo%20commit
[commit-url]: https://github.com/VictorrMendes/Entrelinhas/commits/master
[issues-shield]: https://img.shields.io/github/issues/VictorrMendes/Entrelinhas?style=for-the-badge
[issues-url]: https://github.com/VictorrMendes/Entrelinhas/issues
[kotlin-badge]: https://img.shields.io/badge/Kotlin-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white
[kotlin-url]: https://kotlinlang.org
[compose-badge]: https://img.shields.io/badge/Jetpack%20Compose-4285F4?style=for-the-badge&logo=jetpackcompose&logoColor=white
[compose-url]: https://developer.android.com/compose
[mlkit-badge]: https://img.shields.io/badge/ML%20Kit-FF6F00?style=for-the-badge&logo=google&logoColor=white
[mlkit-url]: https://developers.google.com/ml-kit
[node-badge]: https://img.shields.io/badge/Node.js%2024-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org
[ts-badge]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org
[fastify-badge]: https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white
[fastify-url]: https://fastify.dev
[sqlite-badge]: https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white
[sqlite-url]: https://nodejs.org/api/sqlite.html
[gemini-badge]: https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white
[gemini-url]: https://ai.google.dev
[nvidia-badge]: https://img.shields.io/badge/NVIDIA%20NIM-76B900?style=for-the-badge&logo=nvidia&logoColor=white
[nvidia-url]: https://build.nvidia.com
[docker-badge]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[docker-url]: https://www.docker.com
[actions-badge]: https://img.shields.io/badge/GitHub%20Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white
[actions-url]: https://github.com/features/actions
