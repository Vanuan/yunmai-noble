var noble = require('./src/bluetooth').createLink();
var protocol = require('./src/yunmai/protocol');
var messages = require('./src/yunmai/messages');
const WebSocket = require('ws');

const wsPort = Number(process.env.WS_PORT) || 8080;
const deviceId = process.env.NODE_ID || 'yunmai-noble';
const capabilities = [
  'measurement.measuring',
  'measurement.completed',
  'status',
  'error'
];

const wss = new WebSocket.Server({ port: wsPort });
let bluetoothState = 'unknown';
let scanning = false;
let peripheralName = null;
let connectedPeripheral;

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

const broadcast = function broadcast(message) {
  const stringData = JSON.stringify(message);
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(stringData);
    }
  });
};

function broadcastStatus() {
  broadcast(messages.buildStatusMessage(deviceId, {
    bluetooth: bluetoothState,
    scanning: scanning,
    connected: Boolean(connectedPeripheral),
    peripheralName: peripheralName
  }));
}

wss.on('connection', function(socket) {
  send(socket, messages.buildHelloMessage(deviceId, capabilities));
  send(socket, messages.buildStatusMessage(deviceId, {
    bluetooth: bluetoothState,
    scanning: scanning,
    connected: Boolean(connectedPeripheral),
    peripheralName: peripheralName
  }));
});

noble.on('stateChange', function(state) {
  console.log('Bluetooth', state);
  bluetoothState = state;
  if (state === 'poweredOn') {
    scanning = true;
    noble.startScanning();
  } else {
    scanning = false;
    noble.stopScanning();
  }
  broadcastStatus();
});

noble.on('discover', function(peripheral) {
  console.log('Looking for peripheral...')
  var advertisement = peripheral.advertisement;
  var localName = advertisement.localName;
  if(localName && localName.includes('YUNMAI')) {
    console.log('Yunmai scales detected')
    scanning = false;
    noble.stopScanning();
    peripheralName = localName;
    broadcastStatus();
    explore(peripheral);
  }
});

const discoverCharacteristics = (service, charUUIDs) => {
  return new Promise((resolve, reject) => {
    service.discoverCharacteristics(charUUIDs, function(error, chars) {
      if(error) { reject(error); } else { resolve(chars); }
    })
  });
}

const discoverServices = (peripheral, serviceUUIDs) => {
  return new Promise((resolve, reject) => {
    peripheral.discoverServices(serviceUUIDs, function(error, services) {
      if(error) { reject(error); } else { resolve(services); }
    })
  });
}

function explore(peripheral) {
  peripheral.on('disconnect', function() {
    connectedPeripheral = null;
    peripheralName = null;
    broadcastStatus();
    setTimeout(function() { process.exit(0); }, 50);
  });

  peripheral.connect(function(error) {
    connectedPeripheral = peripheral;
    peripheralName = peripheral.advertisement.localName;
    broadcastStatus();
    discoverServices(peripheral, ['ffe0']).then((services) => {
      if(services.length > 0) {
        return services[0];
      } else { throw new Error('Service not found') }
    }).then((weightService) => {
      return discoverCharacteristics(weightService, ['ffe4']).then((chars) => {
        if(chars.length > 0) {
          return chars[0];
        } else { throw new Error('Characteristic not found') }
      });
    }).then((characteristic) => {
      characteristic.on('data', function(data, isNotification) {
        if(isNotification) {
          if(data !== null) {
            handleWeighting(data);
          }
        }
      });
      characteristic.subscribe((error) => { if(error) console.log(error); });
      console.log('Waiting for weighting...')
    }).then(() => {
    }).catch((err) => {
      console.log('error', err);
      broadcast(messages.buildErrorMessage(deviceId, 'ble_error', String(err)));
    });
  });
}


function handleWeighting(data) {
  const packet = protocol.parsePacket(data);
  if(packet.packetType === protocol.PacketType.MEASURING) {
    const measuring = protocol.parseWeightingProgress(packet.data);
    display(measuring);
    broadcast(messages.buildMeasuringMessage(deviceId, measuring));
  } else if(packet.packetType === protocol.PacketType.MEASURED) {
    const measured = protocol.parseWeightingCompleted(packet.data);
    display(measured);
    broadcast(messages.buildCompletedMessage(deviceId, measured, packet.firmwareVersion));
  } else {
    broadcast(messages.buildErrorMessage(
      deviceId,
      'unsupported_packet',
      'Packet type ' + packet.packetType + ' is not supported'
    ));
  }
}

function display(data) {
  if(data.historicalInfo === 1) { console.log('Historical'); }
  if(data.userId) { console.log(`User: ${data.userId}`) }
  if(data.resistance) { console.log(`Resistance: ${data.resistance}`) }
  if(data.fatPercentage) { console.log(`Fat: ${data.fatPercentage}`) }
  console.log(`[${new Date(data.date*1000)}] ${data.weight / 100} kg`);
}

process.on('SIGINT', function() {
  if(connectedPeripheral) {
    console.log( "Disconnecting..." );
    connectedPeripheral.disconnect();
  } else {
    process.exit(0);
  }
})
