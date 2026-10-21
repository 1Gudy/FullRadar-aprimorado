# Full Radar

Extensão local para acompanhar datas de coleta disponíveis em envios Full do Mercado Livre. A busca fica vinculada ao envio aberto e pode retomar a navegação pela Gestão se a página apresentar um erro.

## Instalação para desenvolvimento

1. Clone este repositório e abra `chrome://extensions` no Chrome ou Brave.
2. Ative o **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação** e escolha a pasta clonada.
4. Abra a página de edição da coleta de um envio Full para usar a extensão.

## Uso

- Escolha um período de datas ou datas em ordem no calendário da extensão.
- Clique em **Iniciar busca nesta aba** para monitorar sem selecionar uma data.
- A opção **Confirmação automática** é opcional e vem desativada. Quando ligada, a extensão pode selecionar e confirmar uma data disponível de acordo com as preferências configuradas.
- Use **Parar** para interromper a busca.

A disponibilidade depende do Mercado Livre e pode mudar. Confira os dados do envio e as preferências antes de iniciar. Esta extensão não substitui a revisão do resultado no Mercado Livre.

## Desenvolvimento

Requer Node.js. Instale as dependências e execute os comandos:

```sh
npm install
npm test
npm run check
```

Os testes usam páginas e dados simulados; eles não confirmam disponibilidade nem fazem reservas reais.

## Privacidade

A extensão roda no navegador e solicita acesso às páginas do Mercado Livre indicadas no manifesto. O recurso opcional do Telegram usa o serviço público configurado em `telegram-config.js`; a extensão não inclui o token do bot. Não adicione credenciais, cookies ou dados pessoais a commits ou issues.

## Créditos

Os ativos locais de Inter e Tabler acompanham suas respectivas licenças em `licenses/`.
