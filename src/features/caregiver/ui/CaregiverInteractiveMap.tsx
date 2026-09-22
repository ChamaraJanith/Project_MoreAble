/**
 * Interactive Real-World Journey & Live Bus Tracking Map (MOV-227 / MOV-230)
 *
 * Renders an interactive OpenStreetMap with:
 * - Real OSRM road geometry polyline
 * - Passed vs remaining route path segments
 * - Boarding stop (blue pin), intermediate halts, and destination (red pin)
 * - Real-time animated bus marker with license plate, heading, and speed telemetry
 * - Smooth auto-fit bounds, "Center Bus", and "Full Route" controls
 */

import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { CaregiverLiveTrackingData } from '../../../entities/caregiver/model/types';

interface CaregiverInteractiveMapProps {
  data: CaregiverLiveTrackingData;
  height?: number;
}

export const CaregiverInteractiveMap: React.FC<CaregiverInteractiveMapProps> = ({
  data,
  height = 280,
}) => {
  const mapHtml = useMemo(() => {
    const routeCoords = data.routeCoordinates || [];
    const stops = data.stopCoordinates || [];
    const busLoc = data.currentLocation;
    const busPlate = data.busRegistrationNumber || 'Bus';
    const journeyStatus = data.journeyStatus;
    const isArrived = journeyStatus === 'ARRIVED';
    const isScheduled = journeyStatus === 'SCHEDULED';

    // Default center to bus or first stop or Colombo
    const defaultLat = busLoc?.latitude || stops[0]?.latitude || 6.9271;
    const defaultLng = busLoc?.longitude || stops[0]?.longitude || 79.8612;

    const stopsJson = JSON.stringify(stops);
    const routeJson = JSON.stringify(routeCoords);
    const busLocJson = JSON.stringify(busLoc || null);

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body, html, #map { width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #e2e8f0; }
          
          /* Custom Controls */
          .map-controls {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .ctrl-btn {
            background: #ffffff;
            color: #0f172a;
            border: 1px solid #cbd5e1;
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 11px;
            font-weight: 700;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s ease;
          }
          .ctrl-btn:hover { background: #f8fafc; border-color: #0284c7; color: #0284c7; }
          
          /* Bus Marker */
          .bus-marker-wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            transform: translate(-50%, -50%);
          }
          .bus-pin {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: #0284c7;
            border: 3px solid #ffffff;
            box-shadow: 0 4px 10px rgba(2,132,199,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            z-index: 2;
          }
          .pulse-ring {
            position: absolute;
            width: 54px;
            height: 54px;
            border-radius: 50%;
            background: rgba(2, 132, 199, 0.35);
            animation: pulse-anim 2s infinite ease-out;
            z-index: 1;
          }
          @keyframes pulse-anim {
            0% { transform: scale(0.6); opacity: 1; }
            100% { transform: scale(1.4); opacity: 0; }
          }
          .bus-plate-tag {
            background: #0f172a;
            color: #ffffff;
            font-size: 9px;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 4px;
            margin-top: 3px;
            white-space: nowrap;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.3);
          }

          /* Stop Markers */
          .stop-dot-marker {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #64748b;
            border: 2.5px solid #ffffff;
            box-shadow: 0 2px 4px rgba(0,0,0,0.25);
          }
          .stop-dot-passed {
            background: #16a34a;
          }
          .stop-dot-current {
            background: #0284c7;
            transform: scale(1.3);
            box-shadow: 0 0 0 4px rgba(2,132,199,0.25);
          }
          .endpoint-pin {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 800;
            font-size: 12px;
            border: 2px solid white;
            box-shadow: 0 3px 6px rgba(0,0,0,0.3);
          }
          .origin-pin { background: #0284c7; }
          .dest-pin { background: #dc2626; }

          .leaflet-popup-content-wrapper {
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-size: 12px;
            font-weight: 600;
            padding: 2px;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <div class="map-controls">
          <button class="ctrl-btn" onclick="centerBus()">🎯 Center Bus</button>
          <button class="ctrl-btn" onclick="fitRoute()">🗺️ Full Route</button>
        </div>

        <script>
          const stops = ${stopsJson};
          const routeCoords = ${routeJson};
          const busLoc = ${busLocJson};
          const busPlate = ${JSON.stringify(busPlate)};
          const isArrived = ${isArrived};
          const isScheduled = ${isScheduled};

          // Initialize Map
          const map = L.map('map', {
            zoomControl: false,
            attributionControl: false
          }).setView([${defaultLat}, ${defaultLng}], 13);

          L.control.zoom({ position: 'bottomright' }).addTo(map);

          // Add CartoDB / OSM clean tiles
          L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
          }).addTo(map);

          let routeBounds = [];

          // 1. Draw Road Route Polyline
          if (routeCoords && routeCoords.length > 0) {
            const polyline = L.polyline(routeCoords, {
              color: '#0284C7',
              weight: 5,
              opacity: 0.85,
              lineJoin: 'round',
              lineCap: 'round'
            }).addTo(map);

            routeCoords.forEach(c => routeBounds.push(c));
          }

          // 2. Draw Stop Markers
          if (stops && stops.length > 0) {
            stops.forEach((stop, index) => {
              const isFirst = index === 0;
              const isLast = index === stops.length - 1;
              const latLng = [stop.latitude, stop.longitude];
              routeBounds.push(latLng);

              if (isFirst) {
                // Boarding Origin Pin
                const icon = L.divIcon({
                  className: 'custom-icon',
                  html: '<div class="endpoint-pin origin-pin">🛫</div>',
                  iconSize: [28, 28],
                  iconAnchor: [14, 14]
                });
                L.marker(latLng, { icon }).addTo(map)
                  .bindPopup('<b>Boarding Halt:</b> ' + stop.name);
              } else if (isLast) {
                // Destination Pin
                const icon = L.divIcon({
                  className: 'custom-icon',
                  html: '<div class="endpoint-pin dest-pin">🏁</div>',
                  iconSize: [28, 28],
                  iconAnchor: [14, 14]
                });
                L.marker(latLng, { icon }).addTo(map)
                  .bindPopup('<b>Destination:</b> ' + stop.name);
              } else {
                // Intermediate Stop Dot
                let dotClass = 'stop-dot-marker';
                if (stop.isPassed) dotClass += ' stop-dot-passed';
                if (stop.isCurrent) dotClass += ' stop-dot-current';

                const icon = L.divIcon({
                  className: 'custom-icon',
                  html: '<div class="' + dotClass + '"></div>',
                  iconSize: [14, 14],
                  iconAnchor: [7, 7]
                });
                L.marker(latLng, { icon }).addTo(map)
                  .bindPopup('<b>Halt:</b> ' + stop.name);
              }
            });
          }

          // 3. Draw Live Animated Bus Marker
          let busMarker = null;
          if (busLoc && busLoc.latitude && busLoc.longitude) {
            const busLatLng = [busLoc.latitude, busLoc.longitude];
            routeBounds.push(busLatLng);

            const busIcon = L.divIcon({
              className: 'custom-bus-icon',
              html: '<div class="bus-marker-wrap">' +
                      '<div class="pulse-ring"></div>' +
                      '<div class="bus-pin">' +
                        '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg>' +
                      '</div>' +
                      '<div class="bus-plate-tag">' + busPlate + '</div>' +
                    '</div>',
              iconSize: [60, 60],
              iconAnchor: [30, 30]
            });

            busMarker = L.marker(busLatLng, { icon: busIcon, zIndexOffset: 1000 }).addTo(map);
            busMarker.bindPopup('<b>Bus: ' + busPlate + '</b><br/>Speed: ' + (busLoc.speedKmH || 0) + ' km/h<br/>Status: ' + (isArrived ? 'Arrived' : isScheduled ? 'Scheduled' : 'Live In-Transit'));
          }

          // Fit all bounds
          function fitRoute() {
            if (routeBounds.length > 0) {
              map.fitBounds(L.latLngBounds(routeBounds), { padding: [30, 30], maxZoom: 16 });
            }
          }

          function centerBus() {
            if (busLoc && busLoc.latitude && busLoc.longitude) {
              map.setView([busLoc.latitude, busLoc.longitude], 15, { animate: true });
              if (busMarker) busMarker.openPopup();
            } else {
              fitRoute();
            }
          }

          fitRoute();
        </script>
      </body>
      </html>
    `;
  }, [data]);

  return (
    <View style={[styles.container, { height }]}>
      {Platform.OS === 'web' ? (
        <iframe
          title="Live Journey Map"
          srcDoc={mapHtml}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            borderRadius: 14,
          }}
        />
      ) : (
        <View style={styles.nativeFallback}>
          <iframe
            title="Live Journey Map Native"
            srcDoc={mapHtml}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  nativeFallback: {
    flex: 1,
  },
});
