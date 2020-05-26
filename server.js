var express = require('express')
  , app = express()
  , server = require('http').createServer(app)

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
var vincenty = require('node-vincenty');
const geolib = require("geolib");

var yawPID = new PID(1.0, 0, 0.30);
var client = arDrone.createClient();

client.config('general:navdata_demo', 'FALSE');

var targetLat, targetLon, targetYaw, cyaw, currentLat, currentLon, currentDistance, currentYaw, phoneAccuracy;
var battery = 0;

var pidOptions = {
  x_axis: { p_constant: 0.5, i_constant: 0, d_constant: 0.35 },
  y_axis: { p_constant: 0.5, i_constant: 0, d_constant: 0.35 },
  z_axis: { p_constant: 0.8, i_constant: 0, d_constant: 0.35 },
  yaw_axis: { p_constant: 1.0, i_constant: 0.1, d_constant: 0.30 }
};

var missionOptions = {
  pid: pidOptions,
  droneConfiguration: [
    { key: "general:navdata_demo", value: false },
    { key: "control:outdoor", value: true },
    { key: "control:flight_without_shell", value: true },
    { key: "control:altitude_min", value: 3 },
    { key: "control:altitude_max", value: 15 },
    { key: "control:control_yaw", value: 1.6 }
  ]
};

var mission = autonomy.createMission(missionOptions);

var stop = function () {
  console.log('stop', data)
  targetYaw = null
  targetLat = null
  targetLon = null
  client.stop()
}

module.exports = WaypointNavigator;
function WaypointNavigator() {
  'use strict';
  // The waypoint buffer is like a To-Do list of waypoints yet to reach. The waypoints are targeted in succession
  this.waypointBuffer = [new this.Waypoint(0, 0, 1, "m", startFlight)]; // Fill the buffer with a waypoint that goes nowhere
  // A boolean value which indicates whether there is a thread executing the waypoints in the buffer.
  // It is to prevent two waypoints from being executed at the same time
  this.isAllowedToActivateWaypoints = true;
  // A memo to store an estimates of the drone's location when devices such as GPS are unavailable
  this.locationCache = { coordinateGrid: [0, 0, 0], gps: undefined };
}

// Get the drone's absolute bearing (see flight terminology)
WaypointNavigator.prototype.getDroneAbsoluteBearing = function () {
  return mission.control()._ekf.state().absoluteYaw;
};

var handleNavData = function (data) {
  if (data.demo == null || data.gps == null) return;
  battery = data.demo.batteryPercentage
  currentLat = data.gps.latitude
  currentLon = data.gps.longitude
  currentYaw = data.demo.rotation.yaw;
  shouldRotateTowardsWaypoint = true;

  if (targetLat == null || targetLon == null || currentYaw == null || currentLat == null || currentLon == null) return;

  var bearingVincenty = vincenty.distVincenty(currentLat, currentLon, targetLat, targetLon)

  // Calculate distance to waypoint
  var displacement = geolib.getDistance(
    { latitude: currentLat, longitude: currentLon },
    { latitude: targetLat, longitude: targetLon },
    1, 2);
  var displacementBearing = geolib.getCompassDirection(
    { latitude: currentLat, longitude: currentLon },
    { latitude: targetLat, longitude: targetLon },
  ).bearing;
  // Find X and Y components of displacement vector
  var displacementVector = $V([Math.cos(displacementBearing) * displacement, Math.sin(displacementBearing) * displacement]);
  // Get angle of drone
  var droneBearing = this.getDroneAbsoluteBearing();
  if (droneBearing === null) {
    droneBearing = displacementBearing;
  }
  // Calculate angle needed to rotate so that the drone is facing the waypoint
  var yawAdjustment = displacementBearing - droneBearing;

  // Convert yaw adjsutment to degrees and normalize
  yawAdjustment *= 180 / Math.PI;
  while (yawAdjustment > 180) { yawAdjustment -= 360; }
  while (yawAdjustment < -180) { yawAdjustment += 360; }
  console.log(chalk.dim.red("yawAdjustment: " + yawAdjustment));

  // Craft mission
  console.log(chalk.dim("Crafting mision"));
  mission.zero();
  mission.hover(100);
  mission.up(12);
  if (shouldRotateTowardsWaypoint) {
    var displacement = Math.hypot(displacementVector.elements[0], displacementVector.elements[1]);

    if (Math.abs(yawAdjustment) > 0.1) {
      mission.cw(yawAdjustment);
    }

    if (displacement > 1) {
      console.log('distance', displacement)
      
      mission.forward(displacement);

    } else {
      targetYaw = null
      io.sockets.emit('waypointReached', { lat: targetLat, lon: targetLon })
      console.log('Reached ', targetLat, targetLon)
      stop()
    }
  }
}

client.on('navdata', handleNavData);

function within(x, min, max) {
  if (x < min) {
    return min;
  } else if (x > max) {
    return max;
  } else {
    return x;
  }
}
