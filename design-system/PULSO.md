# Pulso — alvo aprovado em 18/10/2026

O usuário escolheu a segunda imagem exibida: `conceito-2-pulso.png`, produzida na exploração visual e guardada na pasta de validação irmã do projeto. Implementar no popup existente; não criar aplicação ou alterar automação.

Após a implementação e o ajuste de largura da 0.3.1, o usuário aprovou o resultado em 18/10/2026: “agr ficou bom, obg”. Preservar essa direção nas próximas correções, salvo novo pedido de mudança visual.

## Inventário e medidas

- Referência original: aproximadamente 390 × 680 px. Na versão 0.3.1, largura intrínseca fixa de 420 px para impedir que o navegador comprima o popup; corpo com altura máxima de 600 px e rolagem vertical interna. A ação principal deve continuar acessível. Não substituir por largura percentual dependente do viewport inicial.
- Fundo: grafite quase preto, `#111218`; texto `#F5F3FA`; auxiliares `#B5AACC`; linhas `#302C3F`; acento lavanda `#B497F5`; sucesso menta `#7CE3B4`.
- Cabeçalho aberto: símbolo de radar 36 px, FullRadar em Inter 24/700, atalho de opções 24 px. Sem cartão exterior.
- Contexto em uma linha: ponto de estado, estado curto e ID extraído da aba. Descrição completa disponível quando necessário.
- Próxima verificação: número tabular 56/800 à esquerda, título e intervalo à direita. Progresso de estabilidade abaixo, com quantidade e próxima tentativa vindas de `cadenceStatus`.
- Datas: ícone de calendário, título e resumo; seleção de período ou prioridade; calendário com células conectadas no intervalo, hoje distinguido. Manter controles explícitos de início/fim para edição previsível e acessível.
- Confirmação: controle desligado por padrão e explicação do efeito real; ícone de sino seguindo a proposta.
- Ação: lavanda com texto escuro; Parar quando rodando, Iniciar quando parado e Retomar quando necessário. Edições do formulário exigem ação explícita de aplicar/reiniciar; nunca são transmitidas automaticamente como autorização.
- Opções secundárias: frequência mínima, Telegram, outras buscas, várias abas e histórico. Sem retirar funcionalidades.
- Versão de entrega: 0.3.1. Não mostrar “prévia” na extensão real; apenas no servidor local.

## Ativos

- Marca: PNG transparente gerado a partir do símbolo da imagem aprovada. Exportações 16/32/48/128 e mestre para o popup em alta densidade. Não redesenhar o símbolo com CSS ou SVG improvisado.
- Ícones: família Tabler (MIT), contornos de 2 px e cantos arredondados; geometria oficial, armazenada localmente. Ver https://github.com/tabler/tabler-icons.
- Fonte: Inter (SIL OFL), arquivos WOFF2 locais, sem dependência de CDN. Ver https://github.com/rsms/inter.

## Limite da mudança

`core.js`, `scheduler.js`, `content.js`, `dom-adapter.js`, `background.js` e configuração do Telegram devem conservar os hashes anteriores. O popup apenas apresenta o estado existente e envia os mesmos comandos mediante cliques. Nenhuma interação com Mercado Livre real ou recarga da extensão instalada durante o trabalho.
