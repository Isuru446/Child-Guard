import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:final_project/core/map_actions.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/screens/map/stored_location_map.dart';
import 'package:final_project/screens/map/wearable_location_panel.dart';

import 'support/backend_fixture.dart';
import 'support/memory_tile_provider.dart';

void main() {
  testWidgets(
    'switching authorized children refetches the selected child and rejects mismatched location identity',
    (tester) async {
      final f = useBackend(tester);
      backendTab.value = 1;
      f.children.add({
        'id': BackendFixture.otherChildId,
        'name': 'Second Child',
      });
      f.respond = (r) => r.url.path.endsWith('/location')
          ? BackendFixture.data({
              'child': f.children.first,
              'device': null,
              'gpsMonitoring': {'lastValidLocation': null},
            })
          : null;
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: WearableLocationPanel())),
      );
      await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Second Child').last);
      await tester.pumpAndSettle();
      expect(
        f.requests.any(
          (r) =>
              r.url.path.endsWith('/${BackendFixture.otherChildId}/location'),
        ),
        isTrue,
      );
      expect(
        find.text("Unable to verify this child's location."),
        findsOneWidget,
      );
      expect(find.byType(FlutterMap), findsNothing);
    },
  );
  testWidgets(
    'a configured safe area alone does not create a child marker or enable Google Maps',
    (tester) async {
      final f = useBackend(tester);
      backendTab.value = 1;
      f.respond = (r) => r.url.path.endsWith('/location')
          ? BackendFixture.data({
              'child': f.children.first,
              'device': null,
              'gpsMonitoring': {'lastValidLocation': null},
              'geofence': {
                'latitude': 6.8,
                'longitude': 79.9,
                'radiusM': 50,
                'active': true,
              },
            })
          : null;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WearableLocationPanel(tileProvider: MemoryTileProvider()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(CircleLayer), findsOneWidget);
      expect(
        tester.widget<MarkerLayer>(find.byType(MarkerLayer)).markers,
        hasLength(1),
      );
      expect(find.byIcon(Icons.location_on_rounded), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Open in Google Maps'),
            )
            .onPressed,
        isNull,
      );
    },
  );
  testWidgets(
    'interactive map places the saved marker and safe-zone circle in meters; camera survives updates',
    (tester) async {
      final tiles = MemoryTileProvider();
      Widget view(double lat) => MaterialApp(
        home: Scaffold(
          body: StoredLocationMap(
            latitude: lat,
            longitude: 79.9,
            childName: 'Authorized Child',
            tileProvider: tiles,
            zone: const {
              'latitude': 6.81,
              'longitude': 79.91,
              'radiusM': 50,
              'active': true,
            },
          ),
        ),
      );
      await tester.pumpWidget(view(6.8));
      await tester.pumpAndSettle();
      final map = tester.widget<FlutterMap>(find.byType(FlutterMap));
      expect(map.options.initialCenter, const LatLng(6.8, 79.9));
      final markers = tester.widget<MarkerLayer>(find.byType(MarkerLayer));
      expect(markers.markers.last.point, const LatLng(6.8, 79.9));
      final circle = tester
          .widget<CircleLayer>(find.byType(CircleLayer))
          .circles
          .single;
      expect(circle.point, const LatLng(6.81, 79.91));
      expect(circle.radius, 50);
      expect(circle.useRadiusInMeter, isTrue);
      expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
      await tester.tap(find.byTooltip('Zoom in'));
      await tester.pumpAndSettle();
      expect(map.mapController!.camera.zoom, 17);
      map.mapController!.move(const LatLng(7, 80), 17);
      await tester.pumpAndSettle();
      await tester.pumpWidget(view(6.82));
      await tester.pumpAndSettle();
      expect(map.mapController!.camera.center, const LatLng(7, 80));
      expect(
        tester.widget<MarkerLayer>(find.byType(MarkerLayer)).markers.last.point,
        const LatLng(6.82, 79.9),
      );
      await tester.tap(find.byTooltip('Recenter to child'));
      await tester.pumpAndSettle();
      expect(map.mapController!.camera.center, const LatLng(6.82, 79.9));
      await tester.drag(find.byType(FlutterMap), const Offset(60, 30));
      await tester.pumpAndSettle();
      expect(map.mapController!.camera.center, isNot(const LatLng(6.82, 79.9)));
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'no valid location invents no marker; one child needs no dropdown',
    (tester) async {
      useBackend(tester);
      backendTab.value = 1;
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: WearableLocationPanel())),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FlutterMap), findsNothing);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      expect(find.text('No valid stored GPS position.'), findsOneWidget);
      final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Open in Google Maps'),
      );
      expect(button.onPressed, isNull);
    },
  );
  testWidgets(
    'historical coordinates require confirmation and launch the same saved point; failure shows Snackbar',
    (tester) async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(MapActions.channel, (call) async {
            calls.add(call);
            return false;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(MapActions.channel, null),
      );
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: GoogleMapsButton(
              point: {
                'latitude': 6.8,
                'longitude': 79.9,
                'recordedChildId': 'child',
              },
              historical: true,
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open in Google Maps'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      expect(find.text('Open last known location?'), findsOneWidget);
      await tester.tap(find.text('Open Location'));
      await tester.pumpAndSettle();
      expect(calls.single.arguments, googleMapsLocation(6.8, 79.9).toString());
      expect(
        find.text('Unable to open Google Maps. Please try again.'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'hidden map tab removes tiles and resumes without resetting the explored camera',
    (tester) async {
      final f = useBackend(tester);
      backendTab.value = 1;
      final tiles = MemoryTileProvider();
      await tester.pumpWidget(
        MaterialApp(
          home: BackendTabScope(
            child: Scaffold(
              body: StoredLocationMap(
                latitude: 6.8,
                longitude: 79.9,
                childName: f.children.first['name'] as String,
                tileProvider: tiles,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final controller = tester
          .widget<FlutterMap>(find.byType(FlutterMap))
          .mapController!;
      controller.move(const LatLng(7, 80), 16);
      await tester.pumpAndSettle();
      backendTab.value = 0;
      await tester.pumpAndSettle();
      expect(find.byType(TileLayer), findsNothing);
      final count = tiles.requests;
      await tester.pump(const Duration(seconds: 10));
      expect(tiles.requests, count);
      backendTab.value = 1;
      await tester.pumpAndSettle();
      expect(controller.camera.center, const LatLng(7, 80));
    },
  );
  for (final width in [320.0, 390.0]) {
    testWidgets('map controls and attribution fit $width', (tester) async {
      tester.view.physicalSize = Size(width, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StoredLocationMap(
              latitude: 6.8,
              longitude: 79.9,
              childName: 'A long authorized child name',
              tileProvider: MemoryTileProvider(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Recenter to child'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
