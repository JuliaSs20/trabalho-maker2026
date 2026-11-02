# trabalho-maker-1G

## Conexão do sensor HM-06

- No Windows, dê dois cliques em `Iniciar BioPhysio.bat` e mantenha a janela do terminal aberta. O navegador abrirá o endereço `http://localhost:8080`. Não abra `index.html` diretamente.
- Alternativamente, abra um terminal nesta pasta e execute `node server.js`.
- No Chrome ou Edge, clique em **Conectar sensor BLE** e escolha o HM-06 no seletor Bluetooth. A conexão usa BLE UART padrão: serviço `FFE0` e característica `FFE1`.
- O formato atual do Arduino é `Cotovelo:XX`, com `XX` como inteiro entre `0` e `100` (por exemplo, `Cotovelo:87`). O site remove o rótulo, converte o valor para inteiro e mostra esse mesmo número no card **Flexão Articular**. O alerta compara esse valor com a faixa **Alvo** do exercício selecionado.
- Também são aceitos ângulos em texto numérico (por exemplo, `45.2`) ou com rótulos como `Ângulo: 45,2 graus`; nesses formatos o site prioriza o número rotulado e aceita vírgula decimal. Para transmitir porcentagem e convertê-la para ângulo, inclua `%` explicitamente (por exemplo, `45%`).
- Para enviar percentual convertido em ângulo, use o símbolo `%` sem o rótulo `Cotovelo` (por exemplo, `45%`). Um número simples de `0` a `100`, sem rótulo, também é interpretado como percentual. O formato exato `Cotovelo:XX` sempre é tratado como inteiro recebido diretamente.
- A leitura de um único ângulo não mede alinhamento, postura ou compensações; esses itens não são incluídos na avaliação do sensor.
- Web Bluetooth requer um navegador e sistema com Bluetooth BLE compatíveis. O Safari no iPhone não oferece Web Bluetooth para páginas web; publicar o site em HTTPS não remove essa limitação. Para receber o HM-06 no iPhone, é necessário um aplicativo iOS que encaminhe os dados ao site ou uma solução nativa/gateway.
