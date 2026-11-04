# trabalho-maker-1G

## Conexão do sensor HM-06

- No Windows, dê dois cliques em `Iniciar BioPhysio.bat` e mantenha a janela do terminal aberta. O navegador abrirá o endereço `http://localhost:8080`. Não abra `index.html` diretamente.
- Alternativamente, abra um terminal nesta pasta e execute `node server.js`.
- No Chrome ou Edge, clique em **Conectar sensor BLE** e escolha o HM-06 no seletor Bluetooth. A conexão usa BLE UART padrão: serviço `FFE0` e característica `FFE1`.
- O formato atual do Arduino é `Cotovelo:XX`, em que `XX` é o percentual de flexão entre `0` e `100` (por exemplo, `Cotovelo:87`). A leitura original continua sendo usada internamente na avaliação, mas a interface reescala dinamicamente os valores observados durante cada conexão: o menor valor aparece como `0°` e o maior como `45°`. Na rosca direta, a câmera acompanha o braço direito e mostra a leitura BLE sobre o cotovelo, mantendo o feedback visual de movimento.
- Para o firmware BLE binário do ESP32, o site converte tensão em ângulo interior de `180°` (braço estendido) a `45°` (braço flexionado). A calibração inicial usa `2.150 V` e `1.687 V`, respectivamente. Se os extremos físicos ainda divergirem, ajuste `voltageStraight180Deg` e `voltageBent45Deg` em `leanstar_ble.js` com as tensões medidas nas posições estendida e flexionada.
- Também são aceitos ângulos em texto numérico (por exemplo, `45.2`) ou com rótulos como `Ângulo: 45,2 graus`; nesses formatos o site prioriza o número rotulado e aceita vírgula decimal. Para transmitir porcentagem e convertê-la para ângulo, inclua `%` explicitamente (por exemplo, `45%`).
- Para enviar percentual convertido em ângulo fora do formato Arduino, use o símbolo `%` (por exemplo, `45%`). Um número simples de `0` a `100`, sem rótulo, também é interpretado como percentual.
- A leitura de um único ângulo não mede alinhamento, postura ou compensações; esses itens não são incluídos na avaliação do sensor.
- Web Bluetooth requer um navegador e sistema com Bluetooth BLE compatíveis. O Safari no iPhone não oferece Web Bluetooth para páginas web; publicar o site em HTTPS não remove essa limitação. Para receber o HM-06 no iPhone, é necessário um aplicativo iOS que encaminhe os dados ao site ou uma solução nativa/gateway.
