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
  });

  socket.on('twitter', function (data) {
    executeTwitterEvent();
  });

  socket.on('thesis', function (data) {
    executeThesis();
  });

  socket.on('manualControl', function (key) {
    executeEvent(key);
  });

  socket.on('missionParams', function (params) {
    shouldRotate = params.shouldRotate;
    shouldCalibrate = params.shouldCalibrate;
    altitude = Number(params.altitude);
  });

  setInterval(function () {
    io.sockets.emit('drone', { lat: currentLat, lon: currentLon, yaw: currentYaw, distance: currentDistance, battery: battery })
    io.sockets.emit('phone', { lat: targetLat, lon: targetLon, accuracy: phoneAccuracy })
  }, 1000)
});

var autonomy = require('ardrone-autonomy');
//var PID = require('./PID');
var geolib = require("geolib");
var mission = autonomy.createMission();
var dateFormat = require('dateformat');
var pngStream = mission.client().getPngStream();
var ctrl = new autonomy.Controller(mission.client(), { debug: false }); //manual control

const Twitter = require("twitter");
const dotenv = require("dotenv");
//onst Path = require('path')
const fs = require("fs")

dotenv.config()

const twitter = new Twitter({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token_key: process.env.ACCESS_TOKEN_KEY,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET
})

//receive navdata configuration
mission.client().config('general:navdata_demo', 'FALSE');

var targetLat,
  targetLon,
  currentLat,
  currentLon,
  currentDistance,
  currentYaw,
  phoneAccuracy,
  yawAdjustment,
  distance,
  droneBearing,
  displacementVector,
  displacement,
  imagePost,
  altitude,
  shouldCalibrate,
  shouldRotate;

var battery = 0;

var stop = function () {
  console.log('stop');
  targetYaw = null
  targetLat = null
  targetLon = null
  mission.client().stop()
};

let takePhoto = function () {
  pngStream.once("data", function (data) {
    var now = new Date();
    var nowFormat = dateFormat(now, "isoDateTime");
    imagePost = "./public/images/tcc-" + nowFormat + ".png";

    fs.writeFile(imagePost, data, function (err) {
      return err ? false : true
    })
  });
};

let postTwitter = function () {

  const imageData = fs.readFileSync(imagePost)

  twitter.post("media/upload", { media: imageData }, function (error, media, response) {
    if (error) {
      console.log(error)
      return false
    } else {
      const status = {
        status: "Defesa do TCC, foto aérea capturada pelo AR.Drone 2.0 autonômo! FURB",
        media_ids: media.media_id_string
      }
      twitter.post("statuses/update", status, function (error, tweet, response) {
        return error ? false : true
      })
    }
  })
};

let executeTwitterEvent = async function () {

  mission.altitude(1.5)
    .hover(1000)
    .ccw(180)
    .hover(100)
    .backward(0.5)
  mission.run()

  await takePhoto.then((err) => {
    if (!err) {
      mission.client().animateLeds('doubleMissile', 5, 3)
      postTwitter().then((error) => {
        if (!error) {
          mission.client().animate('flipAhead', 1000)
        }
      })
    }
  }).finally(() => {
    mission.client().land()
  })
};

let executeThesis = function () {
  //Do the coolest autonomous fly
  mission.altitude(1.5)
    .forward(1)
    .ccw(180)
    .up(0.5)
    .cw(90)
    .backward(0.5)
    .cw(90)
    .down(0.5)
    .hover(1000)
  mission.run()

  mission.client.animate("yawShake", 1000)
  mission.client().animate("wave", 1000)
  mission.client().lan()
};

let executeEvent = function (key) {
  switch (key) {
    case "ArrowLeft":
      // Left
      ctrl.left(1)
      break;
    case "ArrowRight":
      // Right
      ctrl.right(1)
      break;
    case "ArrowUp":
      // Front
      ctrl.forward(1)
      break;
    case "ArrowDown":
      // Back
      ctrl.backward(1)
      break;
    case "w":
      //Up 
      ctrl.up(1)
    case "s":
      //Down
      ctrl.down(1)
  }
};

let run = function () {

  // Goes to destined altitude
  mission.altitude(altitude)
    .hover(1000)
  mission.run()

  /*console.log("currentYaw", currentYaw);
  console.log("displacement", displacement);
  console.log("distance", distance);
  console.log("yawAdjustment", yawAdjustment);*/

  if (displacement > 1) {
    // Craft mission
    console.log("Crafting mision");

    //Turn clockwise in the direction to face the waypoint
    mission.cw(yawAdjustment)
    mission.run()

    mission.zero()
      .up(2)
      .ccw(yawAdjustment)
      .hover(1000)
      .forward(displacement - 15) //Close test

    mission.run(function (err, result) {
      if (err) {
        console.log("Oops, something bad happened: %s", err.message);
        stop();
      } else if (result) {
        io.sockets.emit('waypointReached', { lat: targetLat, lon: targetLon });
        //console.log('Reached ', targetLat, targetLon);
        //stop();
      }
    });
  } else {
    // Drone calibrate 
    if (shouldCalibrate) {
      mission.client().calibrate()
    }
    //recursive run
    run();
  }
};

//Process all navdata from drone
let handleNavData = async function (data) {

  if (data.demo == null || data.gps == null) return;

  battery = data.demo.batteryPercentage;
  currentLat = data.gps.latitude;
  currentLon = data.gps.longitude;
  currentYaw = data.demo.rotation.yaw; // Live angle

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

  // Calculate angle needed to rotate so that the drone is facing the waypoint
  yawAdjustment = droneBearing;

  // Convert yaw adjsutment to degrees and normalize
  yawAdjustment *= 180 / Math.PI;
  while (yawAdjustment > 180) { yawAdjustment -= 360; }
  while (yawAdjustment < -180) { yawAdjustment += 360; }

  // Normalize the angle
  yawAdjustment -= currentYaw;

  if (shouldRotate) {
    displacement = Math.hypot(displacementVector.elements[0], displacementVector.elements[1]);
  } else {
    displacement = distance;
  }
};

mission.client().on('navdata', handleNavData);