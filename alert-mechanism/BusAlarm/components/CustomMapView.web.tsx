import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

export interface MarkerProps {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  description?: string;
  pinColor?: string;
  onPress?: () => void;
  children?: React.ReactNode;
}

export const Marker: React.FC<MarkerProps> = () => null;

export interface PolylineProps {
  coordinates: Array<{ latitude: number; longitude: number }>;
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
}

export const Polyline: React.FC<PolylineProps> = () => null;

interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
}

interface MapViewProps {
  initialRegion?: Region;
  style?: any;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  onPress?: (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  children?: React.ReactNode;
}

const CustomMapView = React.forwardRef<any, MapViewProps>(({ initialRegion, style, onPress, children }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region: Region) => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ type: 'ANIMATE_TO_REGION', region }),
          '*'
        );
      }
    },
  }));

  // Extract markers and polylines from children
  const markers: MarkerProps[] = [];
  let polylineCoords: Array<{ latitude: number; longitude: number }> = [];
  let strokeColor = '#007bff';

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type === Marker) {
        markers.push(child.props as MarkerProps);
      } else if (child.type === Polyline) {
        const props = child.props as PolylineProps;
        polylineCoords = props.coordinates || [];
        if (props.strokeColor) strokeColor = props.strokeColor;
      }
    }
  });

  const lat = initialRegion?.latitude ?? 6.9271;
  const lng = initialRegion?.longitude ?? 79.8612;

  // Post message to iframe when markers/polyline change
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          type: 'UPDATE_DATA',
          markers: markers.map((m, i) => ({
            lat: m.coordinate.latitude,
            lng: m.coordinate.longitude,
            title: m.title,
            description: m.description,
            pinColor: m.pinColor,
            id: i,
          })),
          polyline: polylineCoords.map((p) => [p.latitude, p.longitude]),
          strokeColor,
        }),
        '*'
      );
    }
  }, [JSON.stringify(markers.map((m) => m.coordinate)), JSON.stringify(polylineCoords), strokeColor]);

  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'MAP_CLICK' && onPress) {
          onPress({
            nativeEvent: {
              coordinate: {
                latitude: data.lat,
                longitude: data.lng,
              },
            },
          });
        } else if (data.type === 'MARKER_CLICK') {
          const marker = markers[data.id];
          if (marker && marker.onPress) {
            marker.onPress();
          }
        }
      } catch (e) {
        // ignore non-json messages
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [onPress, markers]);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map').setView([${lat}, ${lng}], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(map);

        var markersLayer = L.layerGroup().addTo(map);
        var polylineLayer = L.layerGroup().addTo(map);

        map.on('click', function(e) {
          window.parent.postMessage(JSON.stringify({
            type: 'MAP_CLICK',
            lat: e.latlng.lat,
            lng: e.latlng.lng
          }), '*');
        });

        window.addEventListener('message', function(event) {
          try {
            var data = JSON.parse(event.data);
            if (data.type === 'ANIMATE_TO_REGION' && data.region) {
              map.flyTo([data.region.latitude, data.region.longitude], 14);
            } else if (data.type === 'UPDATE_DATA') {
              markersLayer.clearLayers();
              polylineLayer.clearLayers();

              if (data.polyline && data.polyline.length > 0) {
                L.polyline(data.polyline, { color: data.strokeColor || '#007bff', weight: 4, dashArray: '5, 5' }).addTo(polylineLayer);
              }

              if (data.markers) {
                data.markers.forEach(function(m) {
                  var marker = L.marker([m.lat, m.lng]).addTo(markersLayer);
                  if (m.title) marker.bindPopup(m.title);
                  marker.on('click', function() {
                    window.parent.postMessage(JSON.stringify({
                      type: 'MARKER_CLICK',
                      id: m.id
                    }), '*');
                  });
                });
              }
            }
          } catch(e){}
        });
      </script>
    </body>
    </html>
  `;

  return (
    <View style={[styles.container, style]}>
      <iframe
        ref={iframeRef}
        srcDoc={htmlContent}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Map"
      />
    </View>
  );
});

export default CustomMapView;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
