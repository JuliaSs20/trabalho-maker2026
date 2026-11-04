# trabalho-maker-1G

## Conexão do sensor HM-06

- No Windows, dê dois cliques em `Iniciar BioPhysio.bat` e mantenha a janela do terminal aberta. O navegador abrirá o endereço `http://localhost:8080`. Não abra `index.html` diretamente.
- Alternativamente, abra um terminal nesta pasta e execute `node server.js`.
- No Chrome ou Edge, clique em **Conectar sensor BLE** e escolha o HM-06 no seletor Bluetooth. A conexão usa BLE UART padrão: serviço `FFE0` e característica `FFE1`.
- O formato atual do Arduino é `Cotovelo:XX`, em que `XX` é o percentual de flexão entre `0` e `100` (por exemplo, `Cotovelo:87`). O site converte esse percentual em uma estimativa angular: `0% = 180°` (braço estendido) e `100% = 90°` (braço dobrado). O card **Flexão Articular** e o alerta usam o ângulo convertido. Como a relação entre o sensor flexível e o ângulo pode não ser perfeitamente linear, ajuste os extremos `extendedAngleDeg` e `flexedAngleDeg` em `leanstar_ble.js` comparando com posições medidas do braço.
- Para o firmware BLE binário do ESP32, o site converte tensão em ângulo interior de `180°` (braço estendido) a `90°` (braço dobrado). A calibração inicial usa `2.150 V` e `1.687 V`, respectivamente; o segundo valor ajusta a leitura que antes aparecia em torno de `46,3°` para perto de `90°`. Se os extremos físicos ainda divergirem, ajuste `voltageStraight180Deg` e `voltageBent90Deg` em `leanstar_ble.js` com as tensões medidas nas posições estendida e dobrada.
- Também são aceitos ângulos em texto numérico (por exemplo, `45.2`) ou com rótulos como `Ângulo: 45,2 graus`; nesses formatos o site prioriza o número rotulado e aceita vírgula decimal. Para transmitir porcentagem e convertê-la para ângulo, inclua `%` explicitamente (por exemplo, `45%`).
- Para enviar percentual convertido em ângulo fora do formato Arduino, use o símbolo `%` (por exemplo, `45%`). Um número simples de `0` a `100`, sem rótulo, também é interpretado como percentual.
- A leitura de um único ângulo não mede alinhamento, postura ou compensações; esses itens não são incluídos na avaliação do sensor.
- Web Bluetooth requer um navegador e sistema com Bluetooth BLE compatíveis. O Safari no iPhone não oferece Web Bluetooth para páginas web; publicar o site em HTTPS não remove essa limitação. Para receber o HM-06 no iPhone, é necessário um aplicativo iOS que encaminhe os dados ao site ou uma solução nativa/gateway.
