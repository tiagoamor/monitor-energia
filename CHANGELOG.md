# Changelog

Todas as mudanças relevantes deste projeto. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

> **Nota:** a partir daqui o versionamento foi reiniciado em `0.2.0`, a pedido.
> As entradas `2.x` abaixo são o histórico anterior do projeto.

## [0.2.3] — 2026-09-01

### Adicionado
- Aviso de **qualidade do dado** no medidor Tuya: o backend agora detecta
  frequência de rede fora do padrão (fora de 55–65 Hz), fase com tensão
  anormalmente baixa (indício de queda de fase) e divergência grande entre a
  soma bruta das fases e o fluxo líquido calculado — sinais de que a leitura
  ao vivo está instável.
- Ícone de alerta (⚠) no cartão "Consumo da casa / W" quando o dado está
  instável, com o motivo no tooltip; e um aviso detalhado dentro do modal
  "Fases do medidor — ao vivo".

## [0.2.2] — 2026-08-27

### Adicionado
- Cartão de **Consumo — últimas 24 h**, ao lado do de Geração 24 h, com o
  mesmo estilo de barras e total em kWh.
- Deslizar o dedo (ou arrastar o mouse) sobre as barras de Geração 24 h e
  Consumo 24 h mostra o horário e o valor exato daquele ponto.
- Modal "Fases do medidor — ao vivo": clicar no cartão "Consumo da casa / W"
  abre a leitura das 3 fases por cima da tela, com o fundo desfocado; clicar
  fora fecha o modal.
- Seta de "abrir" (↗) agora só aparece nos cartões que realmente são
  clicáveis.

### Alterado
- Gradiente de fundo e transparência dos cartões reforçados para deixar o
  efeito *liquid glass* mais evidente (mais desfoque e saturação).

### Corrigido
- Cartão duplicado de "Consumo da casa" removido (só o primeiro, clicável,
  permanece).
- `ReferenceError` em `pintarLive` que deixava todos os cartões da tela
  inicial vazios sem nenhum aviso.
- Referência a um elemento removido (`#h-rede`) que travava a atualização do
  resumo; tabela de fases agora só é preenchida se existir na página.
- O cartão de Consumo 24 h havia sido publicado com o código dentro do
  bloco de estilos por engano (nunca rodava); função movida para o lugar
  certo e o HTML do cartão, que também tinha ficado corrompido, foi
  reconstruído.

## [0.2.1] — 2026-08-26

### Alterado
- Os três cartões de "agora" viraram **um só** ("Resumo agora"). O consumo por
  origem e a geração já aparecem nos medidores, então o resumo ficou apenas com
  a autossuficiência, o fluxo com a rede e o aproveitamento da geração.
- Cartões bem mais transparentes (opacidade de 0,44 para 0,24 no tema escuro e
  de 0,52 para 0,36 no claro), com desfoque maior e fundo ambiental mais vivo.

### Corrigido
- A animação do fluxo da rede usava coordenadas antigas e corria fora do
  desenho; agora percorre o próprio fio, da rede ao poste e do poste à casa
  (invertendo o sentido quando há injeção).
- Fluxo e valores da rede passaram para o cinza, como o restante da interface.

## [0.2.0] — 2026-08-26

### Adicionado
- Visual **Liquid Glass**: fundo ambiental fixo com gradientes suaves e todos os
  cartões translúcidos (`backdrop-filter: blur + saturate`), com brilho interno
  na borda superior.
- **Medidores semicirculares**: consumo da casa repartido em dois arcos
  (do sol / da rede) e geração atual sobre a potência instalada.
- **Gráfico de barras da geração nas últimas 24 h**, com o pico destacado,
  total em kWh e eixo de horários.

### Alterado
- Menu flutuante maior, na proporção do padrão iOS (64 px de altura,
  botões de 48 px e texto de 16 px).
- O azul deu lugar ao **cinza** em toda a interface: fluxo da rede na cena,
  legendas, barra de repartição, gráfico de origem, botões e campos.

### Corrigido
- Atalho CSS `font: <peso> <tamanho> inherit` era inválido e fazia botões e
  campos caírem para a fonte padrão do sistema; substituído por propriedades
  separadas.

## [2.1.0] — 2026-08-26

### Adicionado
- Tela de **Ajustes** (engrenagem no cabeçalho) para informar as credenciais da
  Tuya e da SolisCloud pela própria interface, sem mexer em variáveis de ambiente.
- Botão **Testar conexão**, que valida Tuya e SolisCloud separadamente e mostra
  a leitura atual de cada uma (ou o erro devolvido).
- Troca de senha pela interface, com validação de tamanho mínimo e confirmação.
- Endpoints `GET/POST /api/config`, `POST /api/password` e `GET /api/test`.

### Alterado
- As credenciais passaram a ser lidas da tabela `kv` (chave `config`), com as
  variáveis de ambiente servindo apenas de valor inicial. Salvar novas
  credenciais invalida os caches dependentes.
- A senha do app agora é guardada como hash PBKDF2-SHA256 (120 mil iterações)
  com salt aleatório, comparada em tempo constante.
- As chaves de cache passaram a incluir usina e inversor, permitindo trocar de
  instalação sem servir dados antigos.

### Segurança
- Segredos nunca voltam em claro pela API: a leitura devolve `••••` + 4 dígitos.
  Salvar um campo mascarado (ou vazio) mantém o valor já gravado.

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
