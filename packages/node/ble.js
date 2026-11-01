var noble = require('./src/bluetooth').createLink();
var protocol = require('./src/yunmai/protocol');
const WebSocket = require('ws');

const wsPort = Number(process.env.WS_PORT) || 8080;
const wss = new WebSocket.Server({ port: wsPort });

const broadcast = function broadcast(data) {
  const stringData = JSON.stringify(data);
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(stringData);
    }
  });
};

noble.on('stateChange', function(state) {
  console.log('Bluetooth', state)
  if (state === 'poweredOn') {
    noble.startScanning();
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', function(peripheral) {
  console.log('Looking for peripheral...')
  var advertisement = peripheral.advertisement;
  var localName = advertisement.localName;
  if(localName && localName.includes('YUNMAI')) {
    console.log('Yunmai scales detected')
    noble.stopScanning();
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
    process.exit(0);
  });

  peripheral.connect(function(error) {
    connectedPeripheral = peripheral;
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
    }).catch((err) => { console.log('error', err)});
  });
}


function handleWeighting(data) {
  const packet = protocol.parsePacket(data);
  if(packet.packetType === protocol.PacketType.MEASURING) {
    const measuring = protocol.parseWeightingProgress(packet.data);
    display(measuring);
    broadcast({ firmwareVersion: packet.firmwareVersion, packetType: 'measuring', data: measuring });
  } else if(packet.packetType === protocol.PacketType.MEASURED) {
    const measured = protocol.parseWeightingCompleted(packet.data);
    display(measured);
    broadcast({ firmwareVersion: packet.firmwareVersion, packetType: 'measured', data: measured });
  } else {
    broadcast({ firmwareVersion: packet.firmwareVersion, data: packet.data, packetType: 'unknown' });
  }
}

function display(data) {
  if(data.historicalInfo === 1) { console.log('Historical'); }
  if(data.userId) { console.log(`User: ${data.userId}`) }
  if(data.resistance) { console.log(`Resistance: ${data.resistance}`) }
  if(data.fatPercentage) { console.log(`Fat: ${data.fatPercentage}`) }
  console.log(`[${new Date(data.date*1000)}] ${data.weight / 100} kg`);
}

let connectedPeripheral;

process.on('SIGINT', function() {
  if(connectedPeripheral) {
    console.log( "Disconnecting..." );
    connectedPeripheral.disconnect();
  } else {
    process.exit(0);
  }
})

