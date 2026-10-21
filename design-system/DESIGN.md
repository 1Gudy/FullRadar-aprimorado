# FullRadar Design System — Pulso

Versão 2.0.1 · Popup v0.3.1 · pt-BR

## Direção aprovada

Em 18/10/2026, o usuário escolheu a **opção 2** da exploração visual: Pulso. Referência: ../../FullRadar-validacao-2026-10-18/design-references/conceito-2-pulso.png. Substitui a composição anterior de cartões roxos, preservando a preferência por tema escuro.

## Hierarquia

1. Marca, atalho de opções, estado curto e ID automático.
2. Próxima verificação e progresso de estabilidade usando o estado real da busca.
3. Datas monitoradas, escolha de período ou prioridade e calendário.
4. Confirmação automática, com explicação explícita.
5. Parar, Iniciar ou Retomar conforme o estado. Edições pendentes mostram Aplicar e reiniciar.
6. Opções avançadas: frequência, Telegram, buscas do navegador, várias abas e histórico.

A interface não conta tempo ocioso como sucesso nem altera a cadência. A função cadenceStatus continua sendo a fonte dos contadores. O cronômetro é estimado; ao vencer, informa que aguarda a atualização. Recuperação, leitura, seleção, confirmação, pausa e resultado têm apresentações próprias.

## Tokens

Os valores semânticos estão em tokens.css.

| Papel | Token | Valor |
| --- | --- | --- |
| Fundo | --fr-canvas | #111218 |
| Superfície | --fr-surface | #1B1924 |
| Superfície secundária | --fr-surface-soft | #252131 |
| Texto | --fr-text | #F5F3FA |
| Texto auxiliar | --fr-muted | #B5AACC |
| Ação e contador | --fr-accent | #B497F5 |
| Texto sobre ação | --fr-accent-ink | #171020 |
| Borda | --fr-border | #302C3F |
| Estado ativo | --fr-success | #7CE3B4 |
| Atenção | --fr-warning | #F0CD83 |
| Erro | --fr-danger | #F5A0AD |

## Tipografia e componentes

- Inter local (400–800), com Segoe UI/sans-serif de reserva; sem dependência de CDN.
- Marca 25 px; contador 56 px com números tabulares; títulos 16 px; controles 13 px; detalhes 11–12 px.
- Raios 8/10/12 px, fundo plano, separadores discretos. Evitar empilhar cartões.
- Calendário: intervalo contínuo com extremidades arredondadas; hoje distinguido; passado desabilitado; foco visível.
- Switch mantém input nativo e rótulo. Ligado informa que pode alterar a reserva; editar não autoriza reinício.
- Largura intrínseca fixa de 420 px no documento e no corpo; altura máxima do corpo de 600 px. A rolagem vertical acontece dentro do corpo, reservando espaço para a barra sem comprimir o popup ou criar rolagem horizontal. Evitar regras de largura percentual ou breakpoints que dependam da largura inicial da janela de extensão. A ação principal fica fixa na área visível.
- Datas em andamento ficam compactas; Editar revela início/fim. Mudanças pendentes são distinguidas da busca atual.
- Preferência por movimento reduzido respeitada; sem animação decorativa de radar.

## Ativos e licenças

- Marca PNG transparente criada a partir do conceito escolhido: ../icons/fullradar-master.png.
- Exportações 16/32/48/128 px; popup usa 128 px reduzido para 40 px.
- Ícones oficiais [Tabler](https://github.com/tabler/tabler-icons), MIT, 24 × 24, contorno de 2 px; Parar usa ícone preenchido. Arquivos locais em ../icons/ui/, sem desenho SVG improvisado.
- Fonte [Inter](https://github.com/rsms/inter), SIL Open Font License. Arquivos locais em ../fonts/.
- Licenças completas em ../licenses/; ativos reproduzíveis com node tools/package-assets.cjs.

## Limites

A mudança é de apresentação e comandos do popup. Os arquivos de automação, recuperação, confirmação, domínio e Telegram não foram alterados. Dados ilustrativos existem somente no servidor de prévia, com acesso de rede bloqueado. A interface de produção não mostra números fictícios nem banner de simulação.
