# Monitor de Energia

Painel web para acompanhar em tempo real a geração solar, o consumo da casa e a
troca de energia com a rede, unindo duas fontes que normalmente não conversam:

- **Medidor trifásico Tuya SPM02** — mede o que entra e sai pelo padrão de entrada.
- **API SolisCloud** — informa o que o inversor está gerando.

A página é estática (GitHub Pages) e toda a integração acontece numa
**Supabase Edge Function**, que guarda as credenciais e registra o histórico.

🔗 https://tiagoamor.github.io/monitor-energia/

## Telas

| Aba | Conteúdo |
| --- | --- |
| **Agora** | Ilustração da casa com o fluxo animado sol → casa → rede, autossuficiência instantânea, fases do medidor ao vivo, consumo por origem nas últimas 24 h (com zoom) e balanço do dia. |
| **Solar** | Potência do inversor, produção diária/mensal/anual, curva de geração do dia, strings, temperatura e tensão de saída. |
| **Histórico** | Últimos 30 dias e comparativo mensal, com autossuficiência e valores em reais. |

## Como o consumo da casa é calculado

Não existe um sensor de consumo da casa. Ele é deduzido:

```
casa       = geração + importado − injetado
do sol     = geração − injetado
da rede    = importado
autossuf.  = (do sol) ÷ casa          quanto do que a casa gastou veio do sol
aproveit.  = (do sol) ÷ geração       quanto do que foi gerado ficou em casa
```

### Por que não usar a potência das fases

O SPM02 publica apenas a **magnitude** de cada fase, sem o sentido do fluxo.
Como o inversor é monofásico, uma fase pode estar injetando enquanto as outras
puxam da rede — os contadores `forward` e `reverse` avançam na mesma janela de
tempo. Somar `|A| + |B| + |C|` superestima muito o consumo (numa medição de
controle, 6.952 W de magnitude para 2.137 W de fluxo líquido real).

A única fonte confiável são os **deltas dos contadores de energia**. Como o passo
do contador é de 10 Wh, uma janela curta gera ruído enorme (±600 W em 60 s), por
isso a janela é de no mínimo 240 s, com suavização exponencial.

## Arquitetura

```
GitHub Pages (index.html)
        │  fetch  ?k=<senha>
        ▼
Supabase Edge Function  "energia"   (Deno)
        ├── Tuya Cloud  ── medidor SPM02
        ├── SolisCloud  ── inversor
        └── Postgres    ── energy_log, energy_daily, kv (cache)
```

O `pg_cron` chama `/api/collect` periodicamente para alimentar o histórico.

## Estrutura

```
index.html                        página completa (HTML + CSS + JS, sem build)
supabase/
  functions/energia/index.ts      Edge Function (todos os endpoints)
  schema.sql                      tabelas e índices
VERSION  CHANGELOG.md
```

## Endpoints

| Rota | Descrição |
| --- | --- |
| `GET /api/meter` | Leitura leve do medidor + fluxo (usado no polling de 5 s) |
| `GET /api/live` | Leitura completa, incluindo as fases |
| `GET /api/today` | Balanço do dia + curva de geração |
| `GET /api/origem?horas=24` | Consumo da casa separado por origem (até 48 h) |
| `GET /api/daily` | Últimos 30 dias |
| `GET /api/monthly` | Comparativo mensal |
| `GET /api/inverter` | Dados do inversor |
| `GET /api/phases` | Fases do medidor |
| `POST /api/collect` | Coleta agendada (pg_cron) |
| `GET/POST /api/config` | Lê/grava as credenciais (segredos mascarados na leitura) |
| `POST /api/password` | Troca a senha do app |
| `GET /api/test` | Testa Tuya e SolisCloud separadamente |

Todas exigem `?k=<APP_PASSWORD>`.

## Configuração

Todas as credenciais são informadas pela própria interface: entre no app e
clique na **engrenagem** do cabeçalho para abrir a tela de **Ajustes**.

- **Tuya / Smart Life** — Access ID, Access Secret, ID do dispositivo (medidor)
  e data center. Obtidos em [iot.tuya.com](https://iot.tuya.com) (Cloud → Projeto).
- **SolisCloud** — Key ID, Key Secret, ID da usina, ID e número de série do
  inversor. Obtidos no app SolisCloud (Serviço → Gerenciamento de API).
- **Senha do app** — pode ser trocada na mesma tela. É guardada como hash
  PBKDF2-SHA256 (120 mil iterações) no banco.

O botão **Testar conexão** valida cada serviço isoladamente e mostra o erro
retornado por cada um.

> Nada disso fica no repositório: as credenciais são gravadas na tabela `kv` do
> seu próprio projeto Supabase, protegida por RLS e acessível apenas pela Edge
> Function com a service role. Na leitura, os segredos voltam mascarados
> (`••••1234`).

Na primeira execução, se a tabela ainda estiver vazia, a função usa como valores
iniciais as variáveis de ambiente `APP_PASSWORD`, `TUYA_ID`, `TUYA_KEY`,
`TUYA_DEVICE`, `SOLIS_KEY_ID`, `SOLIS_KEY_SECRET`, `SOLIS_STATION`,
`SOLIS_INVERTER`, `SOLIS_INVERTER_SN` e `SOLIS_BASE`, caso existam.

Deploy:

```sh
supabase functions deploy energia --no-verify-jwt
```

## Licença

MIT — veja [LICENSE](LICENSE).
