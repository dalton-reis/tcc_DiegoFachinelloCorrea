var express = require('express'),
  app = express(),
  server = require('http').createServer(app)

app.use(express.static(__dirname + '/public'));
app.use(app.router);

app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

app.get('/phone', function (req, res) {
  res.sendfile(__dirname + '/phone.html');
});

server.listen(8080);

require("dronestream").listen(server);

var io = require('socket.io').listen(server)

io.set('destroy upgrade', false)

io.sockets.on('connection', function (socket) {
  console.log('connection')

  socket.on('control', function (ev) {
    console.log('[control]', JSON.stringify(ev));
    if (ev.action == 'animate') {
      client.animate(ev.animation, ev.duration)
    } else {
      client[ev.action].call(client, ev.speed);
    }
  })

  socket.on('takeoff', function (data) {
    console.log('takeoff', data)
    client.takeoff()
  })

  socket.on('land', function (data) {
    console.log('land', data)
    client.land()
  })

  socket.on('reset', function (data) {
    console.log('reset', data)
    client.disableEmergency()
  })

  socket.on('phone', function (data) {
    console.log('phone', data)
    targetLat = data.lat
    targetLon = data.lon
    phoneAccuracy = data.accuracy
  })

  socket.on('go', function (data) {
    targetLat = data.lat
    targetLon = data.lon
    console.log('go', data)
  })

  socket.on('stop', function (data) {
    stop()
  })

  setInterval(function () {
    io.sockets.emit('drone', { lat: currentLat, lon: currentLon, yaw: currentYaw, distance: currentDistance, battery: battery })
    io.sockets.emit('phone', { lat: targetLat, lon: targetLon, accuracy: phoneAccuracy })
  }, 1000)
});

var arDrone = require('ar-drone');
var autonomy = require('ardrone-autonomy');
var PID = require('./PID');
var geolib = require("geolib");

var client = arDrone.createClient();
var mission = autonomy.createMission();

client.config('general:navdata_demo', 'FALSE');

var targetLat, targetLon, targetYaw, currentLat, currentLon, currentDistance, currentYaw, phoneAccuracy;
var battery = 0;

var stop = function () {
  console.log('stop')
  targetYaw = null
  targetLat = null
  targetLon = null
  client.stop()
}

var handleNavData = async function (data) {
  if (data.demo == null || data.gps == null) return;
  battery = data.demo.batteryPercentage
  currentLat = data.gps.latitude
  currentLon = data.gps.longitude
  currentYaw = data.demo.rotation.yaw;
  shouldRotateTowardsWaypoint = true;

  if (targetLat == null || targetLon == null || currentYaw == null || currentLat == null || currentLon == null) return;

  console.log("navdata");

  // Calculate distance to waypoint
  var distance = await geolib.getPreciseDistance({ latitude: currentLat, longitude: currentLon }, 
    { latitude: targetLat, longitude: targetLon }, 1, 2);
    currentDistance = distance;
    console.log("geolib distance " + distance);
  
  // Get angle of drone
  var droneBearing = await geolib.getGreatCircleBearing({ latitude: currentLat, longitude: currentLon }, 
    { latitude: targetLat, longitude: targetLon });
    console.log("droneBearing " + droneBearing);

  // Find X and Y components of displacement vector
  var displacementVector = $V([Math.cos(droneBearing) * distance, Math.sin(droneBearing) * distance]);
  console.log("displacementVector: " + displacementVector.elements[0]);
  
  // Calculate angle needed to rotate so that the drone is facing the waypoint
  var yawAdjustment = droneBearing;

  // Convert yaw adjsutment to degrees and normalize
  yawAdjustment *= 180 / Math.PI;
  while (yawAdjustment > 180) { yawAdjustment -= 360; }
  while (yawAdjustment < -180) { yawAdjustment += 360; }
  currentYaw = yawAdjustment;
  console.log("yawAdjustment: " + yawAdjustment);
  
  if (shouldRotateTowardsWaypoint) {
    var displacement = Math.hypot(displacementVector.elements[0], displacementVector.elements[1]);
    console.log("displacement " + displacement);

    /*if (Math.abs(yawAdjustment) > 0.1) {
       mission.cw(yawAdjustment);
    }*/

    if (displacement > 1) {
      console.log('distance', displacement)

      // Craft mission
      console.log("Crafting mision");

      mission.zero()
      .cw(yawAdjustment)
      .hover(100)
      .altitude(6)
      .forward(displacement);  

      //client.front(displacement);

      mission.run(function (err, result) {
        if (err) {
            console.trace("Oops, something bad happened: %s", err.message);
            mission.client().stop();
            mission.client().land();
        }
    });

    } else {
      targetYaw = null
      io.sockets.emit('waypointReached', { lat: targetLat, lon: targetLon })
      console.log('Reached ', targetLat, targetLon)
      stop()
    }
  }
}

client.on('navdata', handleNavData);