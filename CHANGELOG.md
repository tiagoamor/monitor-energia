# Changelog

Todas as mudanças relevantes deste projeto. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

## [2.0.0] — 2026-08-26

### Adicionado
- Ilustração isométrica da casa real (3 pavimentos, laje plana, grafiato,
  sacada com guarda-corpo de vidro, faixa de madeira, porta pivotante,
  garagem aberta e painéis na laje), com céu, gramado, calçada e poste da rede.
- Gráfico "Consumo da casa por origem" agora cobre as **últimas 24 h**
  (antes só o dia corrente) com **zoom e pan** por roda do mouse, pinça ou arraste,
  e botão para restaurar o zoom.
- Parâmetro `?horas=N` no endpoint `/api/origem` (até 48 h), cruzando a virada
  do dia e buscando a curva de geração dos dois dias envolvidos.
- Campo `iso` na série de origem, para rotular data + hora no tooltip.
- Badge de versão no cabeçalho.

### Alterado
- O bloco "Fases do medidor · ao vivo" foi movido para logo abaixo do card de
  autossuficiência ("do consumo da casa vindo do sol agora").
- Estrutura do repositório: código do backend, schema e documentação
  passaram a ser versionados junto com a página.

### Corrigido
- Colisão de constantes (`K`, `W`, `D`) entre o desenho da casa e o restante do
  script, que impedia o carregamento da página.

## [1.5.0] — 2026-08-25

### Adicionado
- Tema claro/escuro com alternância instantânea e persistência.
- Dock flutuante inferior em vidro (Agora / Solar / Histórico) com indicador deslizante.
- Cache compartilhado em tabela `kv` (stale-while-revalidate), já que Edge Functions
  do Supabase não compartilham memória entre instâncias.

### Corrigido
- **Cálculo de fluxo em tempo real.** O medidor SPM02 publica apenas a magnitude
  de cada fase, sem sentido. Como o inversor é monofásico, algumas fases injetam
  enquanto outras importam, e somar as magnitudes superestimava muito o consumo
  (6.952 W medidos contra 2.137 W reais). Passou-se a derivar importação e injeção
  dos deltas dos contadores `forward`/`reverse` numa janela móvel de 240 s com
  suavização exponencial.
- Autossuficiência era calculada como `casa ÷ geração` (aproveitamento) e exibida
  com o rótulo errado. Agora são duas métricas distintas.
- `innerHTML` não funciona em elementos SVG no WebKit; passou-se a usar `DOMParser`.

## [1.4.0] — 2026-08-24

### Adicionado
- Endpoints `/api/meter` (leve, para polling de 5 s) e `/api/origem`.
- Card "Origem do consumo" separando o que vem do sol e o que vem da rede.

## [1.3.0] — 2026-08-23

### Adicionado
- Integração com a API SolisCloud: potência do inversor, curva de geração,
  produção diária/mensal/anual, strings e temperatura.
- Navegação por abas e histórico mensal comparativo.

## [1.0.0] — 2026-08-23

### Adicionado
- Primeira versão: leitura do medidor trifásico Tuya SPM02 via Edge Function
  no Supabase, registro em banco e página no GitHub Pages protegida por senha.
