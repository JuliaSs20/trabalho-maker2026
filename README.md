# trabalho-maker-1G

## Conexão do sensor HM-06

- No Windows, dê dois cliques em `Iniciar BioPhysio.bat` e mantenha a janela do terminal aberta. O navegador abrirá o endereço `http://localhost:8080`. Não abra `index.html` diretamente.
- Alternativamente, abra um terminal nesta pasta e execute `node server.js`.
- No Chrome ou Edge, clique em **Conectar sensor BLE** e escolha o HM-06 no seletor Bluetooth. A conexão usa BLE UART padrão: serviço `FFE0` e característica `FFE1`.
- O firmware pode enviar o ângulo em texto numérico (por exemplo, `45.2`) ou com um rótulo como `Cotovelo: 45,2 graus`. O site decodifica o texto BLE, prioriza o número depois de `Cotovelo`, `Ângulo`, `Angle` ou `Flexão`, aceita vírgula decimal e atualiza o card **Flexão Articular**. Em mensagens que também incluem outros números, como `Bruto: 420 | Cotovelo: 45.2`, o valor após `Cotovelo` é usado.
- Se o Arduino enviar uma porcentagem, inclua o símbolo `%` (por exemplo, `Cotovelo: 45%`); nesse formato o site converte o percentual para ângulo. Um número simples de `0` a `100`, sem rótulo de ângulo, também é interpretado como percentual. O ângulo é comparado com a faixa **Alvo** do exercício selecionado e controla o aviso **Correção Necessária**.
- A leitura de um único ângulo não mede alinhamento, postura ou compensações; esses itens não são incluídos na avaliação do sensor.
- Web Bluetooth requer um navegador e sistema com Bluetooth BLE compatíveis. O Safari no iPhone não oferece Web Bluetooth para páginas web; publicar o site em HTTPS não remove essa limitação. Para receber o HM-06 no iPhone, é necessário um aplicativo iOS que encaminhe os dados ao site ou uma solução nativa/gateway.
