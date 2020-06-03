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

var io = require('socket.io').listen(server);

io.set('destroy upgrade', false);

io.sockets.on('connection', function (socket) {
  console.log('connection');

  socket.on('control', function (ev) {
    console.log('[control]', JSON.stringify(ev));
    if (ev.action == 'animate') {
      mission.client().animate(ev.animation, ev.duration)
    } else {
      mission.client()[ev.action].call(mission.client(), ev.speed);
    }
  });

  socket.on('takeoff', function (data) {
    console.log('takeoff', data)
    mission.client().takeoff()
  });

  socket.on('land', function (data) {
    console.log('land', data)
    mission.client().land()
  });

  socket.on('reset', function (data) {
    console.log('reset', data)
    mission.client().disableEmergency()
  });

  socket.on('phone', function (data) {
    console.log('phone', data)
    targetLat = data.lat
    targetLon = data.lon
    phoneAccuracy = data.accuracy
  });

  socket.on('go', function (data) {
    targetLat = data.lat
    targetLon = data.lon
    console.log('go', data);
    //Go to waypoint
    run();
  });

  socket.on('stop', function (data) {
    stop();
  })

  setInterval(function () {
    io.sockets.emit('drone', { lat: currentLat, lon: currentLon, yaw: currentYaw, distance: currentDistance, battery: battery })
    io.sockets.emit('phone', { lat: targetLat, lon: targetLon, accuracy: phoneAccuracy })
  }, 1000)
});

var autonomy = require('ardrone-autonomy');
var PID = require('./PID');
var geolib = require("geolib");

var mission = autonomy.createMission();
var ctrl = new autonomy.Controller(mission.client(), { debug: false });

mission.client().config('general:navdata_demo', 'FALSE');

var targetLat, targetLon, targetYaw, currentLat, currentLon, currentDistance, currentYaw, phoneAccuracy, distance, droneBearing, droneAbsoluteBearing, displacementVector, yawAdjustment, displacement;
var battery = 0;

var stop = function () {
  console.log('stop');
  targetYaw = null
  targetLat = null
  targetLon = null
  mission.client().stop();
};

// Get the drone absolute bearing
let getDroneAbsoluteBearing = function () {
  return mission.control()._ekf.state().absoluteYaw;
};

let run = function () {

  //Instant commands to waiting and load navdata necessary variables
  ctrl.up(2);
  ctrl.hover(10000);

  if (displacement > 1) {
    // Craft mission
    console.log("Crafting mision");
    mission.zero()
      .up(altitude)
      .hover(1000)
      .cw(yawAdjustment)
      .forward(distance);

    mission.run(function (err, result) {
      if (err) {
        console.trace("Oops, something bad happened: %s", err.message);
        mission.client().stop();
        mission.client().land();
      } else {
        io.sockets.emit('waypointReached', { lat: targetLat, lon: targetLon });
        console.log('Reached ', targetLat, targetLon);
        stop();
      }
    });
  }
};

//Process all navdata from drone
let handleNavData = async function (data) {
  if (data.demo == null || data.gps == null) return;
  battery = data.demo.batteryPercentage;
  currentLat = data.gps.latitude;
  currentLon = data.gps.longitude;
  currentYaw = data.demo.rotation.yaw;
  shouldRotateTowardsWaypoint = true;

  if (targetLat == null || targetLon == null || currentYaw == null || currentLat == null || currentLon == null) return;

  // Calculate distance to waypoint
  distance = await geolib.getPreciseDistance({ latitude: currentLat, longitude: currentLon },
    { latitude: targetLat, longitude: targetLon }, 1, 2);
  currentDistance = distance;

  // Get angle of drone
  droneBearing = await geolib.getGreatCircleBearing({ latitude: currentLat, longitude: currentLon },
    { latitude: targetLat, longitude: targetLon });

  // Find X and Y components of displacement vector
  displacementVector = $V([Math.cos(droneBearing) * distance, Math.sin(droneBearing) * distance]);

  // Get angle of drone
  droneAbsoluteBearing = getDroneAbsoluteBearing();
  if (droneAbsoluteBearing === null) {
    droneAbsoluteBearing = droneBearing;
  }
  // Calculate angle needed to rotate so that the drone is facing the waypoint
  var yawAdjustment = droneBearing - droneAbsoluteBearing;

  // Convert yaw adjsutment to degrees and normalize
  yawAdjustment *= 180 / Math.PI;
  while (yawAdjustment > 180) { yawAdjustment -= 360; }
  while (yawAdjustment < -180) { yawAdjustment += 360; }
  currentYaw = yawAdjustment;

  if (shouldRotateTowardsWaypoint) {
    displacement = Math.hypot(displacementVector.elements[0], displacementVector.elements[1]);
  } else {
    displacement = distance;
  }
};

mission.client().on('navdata', handleNavData);