# trabalho-maker-1G

## Conexão do sensor HM-06

- No Windows, dê dois cliques em `Iniciar BioPhysio.bat` e mantenha a janela do terminal aberta. O navegador abrirá o endereço `http://localhost:8080`. Não abra `index.html` diretamente.
- Alternativamente, abra um terminal nesta pasta e execute `node server.js`.
- No Chrome ou Edge, clique em **Conectar sensor BLE** e escolha o HM-06 no seletor Bluetooth. A conexão usa BLE UART padrão: serviço `FFE0` e característica `FFE1`.
- O firmware `firmware_leanstar_ble.ino` envia `FLEX:valor`, com a leitura ADC original de `0` a `1023`, sem arredondá-la para percentual. O site converte a leitura calibrada para `0°` (braço estendido) a `45°` (cotovelo flexionado). A calibração inicial é `300` e `850` para coincidir com `VALOR_RETO` e `VALOR_DOBRADO`; ajuste ambos os pares de valores conforme as leituras reais do sensor.
- Para compatibilidade, o site também aceita `Cotovelo:XX` e `C:XX`, em que `XX` é percentual de `0` a `100`, e ângulos explícitos de texto. O percentual é convertido para `0°` a `45°`. Na rosca direta, a câmera acompanha o braço direito e mostra a leitura BLE sobre o cotovelo, mantendo o feedback visual de movimento.
- No perfil BLE binário do ESP32, o ADC de 12 bits é normalizado para a escala de `0` a `1023` antes da conversão para ângulo.
- Também são aceitos ângulos em texto numérico (por exemplo, `45.2`) ou com rótulos como `Ângulo: 45,2 graus`; nesses formatos o site prioriza o número rotulado e aceita vírgula decimal. Para transmitir porcentagem e convertê-la para ângulo, inclua `%` explicitamente (por exemplo, `45%`).
- Para enviar percentual convertido em ângulo fora dos formatos Arduino, use o símbolo `%` (por exemplo, `45%`). Um número simples de `0` a `100`, sem rótulo, também é interpretado como percentual.
- A leitura de um único ângulo não mede alinhamento, postura ou compensações; esses itens não são incluídos na avaliação do sensor.
- Web Bluetooth requer um navegador e sistema com Bluetooth BLE compatíveis. O Safari no iPhone não oferece Web Bluetooth para páginas web; publicar o site em HTTPS não remove essa limitação. Para receber o HM-06 no iPhone, é necessário um aplicativo iOS que encaminhe os dados ao site ou uma solução nativa/gateway.
