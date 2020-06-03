var socket = io.connect('/');
var lat, lon, map, laptop, drone, phone, phonePath, waypointPath, dronePath, startPosition;
var targetLat, targetLon;
var waypointMarkers = [];
var activeWaypoints = [];
var waypoints = [];
var liveDefaultPosition = {};
var follow = false;

var phoneIcon = L.icon({
    iconUrl: '../images/phone.png'
});

var laptopIcon = L.icon({
    iconUrl: '../images/laptop.png'
});

var droneIcon = L.icon({
    iconUrl: '../images/drone.gif'
});

new NodecopterStream(document.getElementById("droneStream"));

navigator.geolocation.getCurrentPosition(initMap, defaultMap, { enableHighAccuracy: true });

function initMap(position) {
    lat = position.coords.latitude;
    lon = position.coords.longitude;

    map = L.map('map').setView([lat, lon], 20);

    var googleLayer = new L.Google('SATELLITE');
    map.addLayer(googleLayer);

    laptop = L.marker([lat, lon], { icon: laptopIcon }).addTo(map)

    map.on('click', function(e) {
        waypointMarkers.push(L.marker(e.latlng).addTo(map))
        waypoints.push([e.latlng.lat, e.latlng.lng])
        if (waypointPath == undefined) {
            waypointPath = L.polyline(waypoints, { color: 'blue' }).addTo(map);
        } else {
            waypointPath.setLatLngs(waypoints)
        }
    });
}

function defaultMap(err) {
    console.log("Initial map failed" + err)
    initMap({ coords: { latitude: liveDefaultPosition.LAT_P, longitude: liveDefaultPosition.LON_P } })
}

function clearWaypoints() {
    waypoints = []
    map.removeLayer(waypointPath)
    waypointPath = undefined
    $.each(waypointMarkers, function(i, m) { map.removeLayer(m) })
}

function setCurrentTarget(lat, lon) {
    targetLat = lat
    targetLon = lon
    socket.emit('go', { lat: targetLat, lon: targetLon })
}

function clearCurrentTarget() {
    targetLat = undefined
    targetLon = undefined
    socket.emit('stop')
}

$(function() {
    $('#takeoff').click(function() {
        follow = false
        socket.emit('takeoff')
        if (drone != null) {
            startPosition = [drone._latlng.lat, drone._latlng.lng]
        }
    })
    $('#land').click(function() {
        follow = false
        socket.emit('land')
        startPosition = []
    })
    $('#reset').click(function() {
        socket.emit('reset')
    })
    $('#stop').click(function() {
        follow = false
        clearCurrentTarget()
    })
    $('#clear').click(function() {
        follow = false
        clearWaypoints()
    })
    $('#home').click(function() {
        follow = false
        activeWaypoints = [startPosition[0], startPosition[1]]
        setCurrentTarget(startPosition[0], startPosition[1])
    })
    $('#go').click(function() {
        follow = false
        if (waypoints.length > 0) {
            activeWaypoints = waypoints.slice(0);
            // Go to next waypoint
            setCurrentTarget(activeWaypoints[0][0], activeWaypoints[0][1])
        }
    })
    $('#follow').click(function() {
        follow = true
    })
    $('#manual').click(function() {
        follow = false
        clearCurrentTarget()
        nodecopterGamepad.initGamepad(socket);
    })
})

socket.on('connect', function() {
    socket.on('waypointReached', function(data) {
        activeWaypoints.shift()
        if (activeWaypoints.length > 0) {
            // Go to next waypoint
            setCurrentTarget(activeWaypoints[0][0], activeWaypoints[0][1])
        }
    })
    socket.on('drone', function(data) {
        if (data.lat != undefined) {
            liveDefaultPosition.LAT_P = data.lat;
            liveDefaultPosition.LON_P = data.lon;
            if (drone == null) {
                drone = L.marker([data.lat, data.lon], { icon: droneIcon }).addTo(map)
                /*dronePath = L.polyline([
                    [data.lat, data.lon]
                ], { color: 'red',
                     weight: 3,
                     opacity: 0.5,
                     smoothFactor: 1 }).addTo(map);*/
            } else {
                drone.setLatLng([data.lat, data.lon])
                dronePath.addLatLng([data.lat, data.lon])
            }
            $('#drone-position .battery').text(data.battery)
            $('#drone-position .lat').text(data.lat)
            $('#drone-position .lon').text(data.lon)
            $('#drone-position .distance').text(data.distance)
        }
    })

    socket.on('phone', function(data) {
        if (data.lat != undefined) {
            if (laptop == null) {
                initMap(data.lat, data.lon)
            }
            /*if (phone == null) {
                phone = L.marker([data.lat, data.lon], { icon: phoneIcon }).addTo(map)
                phonePath = L.polyline([
                    [data.lat, data.lon]
                ], { color: 'red' }).addTo(map);
            } else {*/
                phone.setLatLng([data.lat, data.lon])
                phonePath.addLatLng([data.lat, data.lon])
            //}
            if (follow) {
                setCurrentTarget(data.lat, data.lon)
            }
            $('#phone-position .lat').text(data.lat)
            $('#phone-position .lon').text(data.lon)
            $('#phone-position .accuracy').text(data.accuracy)
        }
    })
})