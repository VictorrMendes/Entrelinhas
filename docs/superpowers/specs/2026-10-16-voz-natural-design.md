# Voz natural no Entrelinhas

**Status:** proposta, aguardando aprovação · 2026-10-16

## Por quê

A voz do Android soa robótica, e o Entrelinhas fala inglês o tempo todo: na leitura em voz alta, na pronúncia das palavras, no Ouvir, no Ditado e no Aprender. Em 16/10/2026 o usuário testou no próprio celular uma versão descartável com vozes Piper rodando no aparelho, pelo sherpa-onnx. As vozes de qualidade alta e média ficaram boas. A primeira fala demora um pouco para começar, e isso foi considerado aceitável.

Caminhos descartados antes deste desenho:
- **VoiceStudio/clonagem no servidor:** o servidor é um notebook sem placa de vídeo. Além disso, clonar a voz de quem grava copia o sotaque dessa pessoa, o que é ruim para quem está aprendendo pronúncia.
- **Kokoro no celular:** mais lento do que a fala em aparelhos intermediários.
- **Instalar outro app de voz:** o usuário precisa de um app só.

## Objetivos

- Voz neural **offline, dentro do Entrelinhas**, para todo o inglês que o app fala.
- A voz é baixada **uma vez**, fica nos dados do app e continua lá depois das atualizações.
- **Opcional.** A voz do Android continua sendo o padrão e a reserva.

## Fora do escopo agora

- Clonagem de voz.
- Vozes em outros idiomas. O Piper tem pt_BR, que fica para depois.
- Kokoro.
- Gerar áudio no servidor.
- Destaque palavra a palavra durante a leitura. O motor não informa qual palavra está sendo falada.

## O que não pode acontecer

- Usar voz com licença **não comercial**. As vozes do teste (lessac, ryan) são não comerciais e ficam de fora.
- Travar a tela enquanto o áudio é gerado.
- Perder a leitura quando a voz natural falha.
- Fazer cada atualização carregar as vozes junto.

## Restrições técnicas (verificadas)

- **Motor: sherpa-onnx 1.13.8, licença Apache-2.0.**
  - Não está no Maven Central. Está no JitPack como `com.github.k2-fsa.sherpa-onnx:sherpa-onnx:v1.13.8@aar`.
  - O AAR do JitPack tem o mesmo SHA-256 do release oficial no GitHub: `633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96`.
  - O repositório JitPack entra só para esse grupo, com `exclusiveContent`.
- **Contrato do callback:** o JNI procura `invoke([F)Ljava/lang/Integer;` no objeto passado para `generateWithCallback`. Uma lambda Kotlin comum derruba o app com um erro nativo, como aconteceu no teste. O callback precisa ser um `object : (FloatArray) -> Int` com `override fun invoke`.
- **Release com R8:** o JNI acessa classes e campos de `com.k2fsa.sherpa.onnx` pelo nome, então é preciso uma regra `-keep` para esse pacote.
- **Tamanho:** as bibliotecas nativas ocupam, sem compressão, uns 32 MB no APK arm64, 22 MB no armeabi-v7a e 36 MB no x86_64. Os APKs por ABI já existem no release. Medir o APK antes e depois.
- **Páginas de 16 KB:** as bibliotecas carregaram no emulador com páginas de 16 KB.

## Decisões

### 1. Vozes oferecidas

Só vozes de domínio público ou CC0, na versão int8 do sherpa-onnx:

| Voz | Quem | Qualidade | Tamanho aprox. |
|---|---|---|---|
| ljspeech | feminina, EUA | alta | 32 MB |
| cori | feminina, britânica | alta | 33 MB |
| joe | masculina, EUA | média (não existe alta) | 20 MB (CC0) |

O usuário escolheu a joe ouvindo as amostras em <https://rhasspy.github.io/piper-samples/>. As licenças vêm do `MODEL_CARD` de cada voz em `rhasspy/piper-voices`.

### 2. De onde o app baixa (decisão do agente)

- **Onde ficam os arquivos:** num GitHub Release do próprio repositório, com a tag `voices-v1`.
  - Um `.zip` por voz, com `model.onnx`, `tokens.txt` e `espeak-ng-data` só com o inglês (cerca de 1 MB).
  - Uma amostra curta em áudio por voz.
- **Catálogo:** fica **fixo no código**, com id, nome, descrição, URL, tamanho e SHA-256 de cada arquivo.
- **Download e instalação:**
  - O app baixa por HTTPS e confere o SHA-256. Se não bater, descarta o arquivo.
  - Descompacta com `java.util.zip` numa pasta temporária em `filesDir/voices/` e só então renomeia para `filesDir/voices/<id>/`.
  - **Recusa entradas do zip que saiam da pasta de destino** (proteção contra *zip slip*).
- **Quem publica:** o usuário publica o release. O agente prepara os zips, os checksums e o comando `gh release create`.
- **Rejeitados:**
  - Baixar direto do release do k2-fsa: os arquivos são `tar.bz2`, o que exige uma biblioteca nova de descompactação, e ficaríamos dependendo dos links de terceiros.
  - Embutir as vozes no APK: pesaria em toda atualização.
  - Servir do servidor de casa: gastaria banda do servidor.

### 3. Tela de escolha da voz

O diálogo "Voz para English" ganha no topo a seção **"Vozes naturais"**. Cada voz mostra:
- nome, quem fala e o tamanho;
- ▶ para ouvir a amostra pela internet, antes de baixar;
- **Baixar**, que vira progresso e depois **Remover**.

Uma voz baixada se escolhe como qualquer outra. Abaixo vêm as vozes do Android, como hoje. Os outros idiomas continuam iguais. Se o usuário remover a voz que está em uso, a escolha volta para "Automática".

### 4. Como a voz é tocada

- A geração acontece **frase a frase**, e cada frase toca enquanto a seguinte é gerada, como no teste.
- **Carregar antes:** ao abrir o leitor, se a voz escolhida for natural, o modelo já é carregado em segundo plano. Isso reduz a espera da primeira fala.
- **Preparar o próximo parágrafo:** na leitura contínua, o próximo parágrafo é gerado enquanto o atual toca, para não haver pausa entre eles.
- **Memória:** só um modelo carregado por vez. Trocar de voz libera o anterior.
- **Velocidade:** a velocidade do app vira o parâmetro `speed` do motor.
- **Ritmo (pedido do usuário):** a leitura não pode soar apressada. Cada voz tem no catálogo seu próprio ritmo base (`lengthScale`) e a pausa entre frases (`silenceScale`). Os valores começam um pouco mais lentos que o padrão do Piper e são ajustados ouvindo no celular do usuário no passo 5. A "Velocidade da voz" de Ajustes continua valendo por cima disso.

### 5. Destaque durante a leitura (decisão do agente)

Com voz natural, acende **a frase** que está sendo falada. O motor entrega áudio por frase, e cada trecho é associado a uma frase de `sentenceRanges(texto)`. Se a quantidade de trechos não bater com a de frases, o app não acende nada; não inventa uma posição.

### 6. Onde a voz vale

Em tudo que usa a voz escolhida para o idioma (`voiceFor(lang)`): leitor, pronúncia no Vocabulário, Ouvir (inclusive com a tela apagada), Ditado, Aprender, painel da frase e, no futuro, as palavras dos kits.

### 7. Falhas

Se a voz não foi baixada, se o arquivo estiver corrompido ou se o motor der erro, o app **volta para a voz do Android**. Ele avisa uma vez por sessão e nunca derruba o app.

## Passos de construção (ordem para o plano)

1. Dependência, regra R8 e `NeuralVoice` com uma voz fixa para teste, ligada ao `Speech`. Teste do callback e build de release funcionando.
2. Catálogo, download, conferência do SHA-256 e descompactação segura, com testes do download e de zip corrompido ou malicioso.
3. Seção "Vozes naturais" na escolha de voz: amostra, baixar e remover.
4. Leitor: carregar antes, preparar o próximo parágrafo e acender a frase.
5. Publicação das vozes (`voices-v1`), feita pelo usuário com comando pronto, e teste no celular.

## Fica a critério de quem constrói

- Número de threads do motor (o teste usou 4).
- Formato e duração da amostra.
- Layout exato das linhas da voz.
- Textos da interface.
- Pedir ou não foco de áudio. O comportamento atual da voz do Android não pede.

## Como verificar

- Testes JVM: catálogo, checksum errado, zip com caminho `../`, troca de voz sem vazar memória e volta para a voz do Android.
- Robolectric: os estados da seção "Vozes naturais" (não baixada, baixando, baixada).
- Manual: emulador e o celular do usuário. A leitura contínua não pode pausar entre parágrafos, e o tamanho do APK precisa ser medido antes e depois.
