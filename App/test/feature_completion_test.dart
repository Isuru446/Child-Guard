import 'support/memory_tile_provider.dart';

import 'dart:async';
import 'dart:convert';

import 'package:final_project/core/backend.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/screens/map/wearable_location_panel.dart';
import 'package:final_project/screens/profile/account_management_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/backend_fixture.dart';

class LiveFixtureApi extends ApiClient {
  final updates = StreamController<Map<String, dynamic>>.broadcast();
  int subscriptions = 0;
  @override
  Stream<Map<String, dynamic>> childUpdates(String childId) {
    subscriptions++;
    return updates.stream;
  }
}

void main() {
  testWidgets(
    'activity uses backend MAD units, quality and partial history without medical claims',
    (tester) async {
      final fixture = useBackend(tester);
      fixture.respond = (r) => r.url.path.endsWith('/activity')
          ? BackendFixture.data({
              'state': 'INSUFFICIENT_DATA',
              'latestMeasurement': {
                'scoreMg': 120.5,
                'sensorStatus': 'OK',
                'coveragePercent': 85.0,
                'endAt': '2026-10-25T07:00:00Z',
              },
              'baselineScoreMg': null,
              'history': [
                {'day': '2026-10-24', 'scoreMg': 100.0, 'validMinutes': 30.0},
              ],
            })
          : null;
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: ChildPanel(section: 'activity')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Not enough data yet'), findsOneWidget);
      expect(find.textContaining('Latest movement: 120.5 mg'), findsNothing);
      await tapVisible(tester, find.text('More details'));
      expect(find.textContaining('Latest movement: 120.5 mg'), findsOneWidget);
      expect(find.textContaining('Sensor coverage: 85.0%'), findsOneWidget);
      expect(find.text('0.0 mg MAD'), findsNothing);
    },
  );

  testWidgets(
    'recorded danger alert opens actual authorized details without inventing GPS',
    (tester) async {
      final fixture = useBackend(tester);
      fixture.alerts[0] = {
        'id': 'stored-alert',
        'kind': 'DANGER_ZONE_NEAR',
        'createdAt': '2026-10-25T07:00:00Z',
        'child': {'name': 'Fixture Child'},
        'details': {'recorded': true},
        'event': {
          'device': {'hardwareId': 'FIXTURE-WEARABLE'},
          'observedAt': '2026-10-25T06:59:59Z',
        },
        'location': null,
      };
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: ChildPanel(section: 'alerts')),
        ),
      );
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('Danger-zone alert'));
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(
        find.textContaining('Wearable: FIXTURE-WEARABLE'),
        findsNWidgets(2),
      );
      expect(find.textContaining('No valid fix attached'), findsOneWidget);
      expect(
        find.textContaining('2026-10-25 12:29 (Sri Lanka)'),
        findsOneWidget,
      );
    },
  );
  for (final status in [403, 404, 409]) {
    testWidgets(
      'Teacher confirmation $status preserves pending state and reports rejection',
      (tester) async {
        final fixture = useBackend(tester, role: 'TEACHER');
        fixture.respond = (r) => r.url.path.endsWith('/confirm')
            ? BackendFixture.error(
                status,
                'Refresh pending attendance ($status)',
              )
            : null;
        await tester.pumpWidget(
          const MaterialApp(home: Scaffold(body: PendingAttendancePanel())),
        );
        await tester.pumpAndSettle();
        await tapVisible(tester, find.widgetWithText(FilledButton, 'Confirm'));
        expect(find.textContaining('physically seen'), findsOneWidget);
        expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
        await tapVisible(
          tester,
          find.widgetWithText(FilledButton, 'Confirm').last,
        );
        expect(
          find.text('Refresh pending attendance ($status)'),
          findsOneWidget,
        );
        expect(fixture.attendance['status'], 'CHECKIN_PENDING');
        expect(find.text('Attendance confirmed by the backend.'), findsNothing);
        expect(fixture.requests.where((r) => r.method == 'POST'), hasLength(1));
      },
    );
  }
  test(
    'JWT SSE parses split frames and never puts credentials in the URL',
    () async {
      final bytes = StreamController<List<int>>();
      late http.BaseRequest sent;
      final api = ApiClient(
        client: MockClient.streaming((request, _) async {
          sent = request;
          return http.StreamedResponse(bytes.stream, 200);
        }),
      )..token = 'in-memory-token';
      final events = <Map<String, dynamic>>[];
      final subscription = api.childUpdates('child-fixture').listen(events.add);
      await Future<void>.delayed(Duration.zero);
      bytes.add(utf8.encode(': heartbeat\n\nevent: update\ndata: {"topics":'));
      bytes.add(utf8.encode('["alerts"],"alertIds":["stored-id"]}\n\n'));
      await Future<void>.delayed(Duration.zero);
      expect(events.single['alertIds'], ['stored-id']);
      expect(sent.headers['Authorization'], 'Bearer in-memory-token');
      expect(sent.url.query, isEmpty);
      expect(sent.url.path, '/api/v1/mobile/children/child-fixture/stream');
      await bytes.close();
      await subscription.cancel();
      api.close();
    },
  );

  testWidgets(
    'foreground alert hint refreshes immediately and pauses in background',
    (tester) async {
      final api = LiveFixtureApi()..token = 'fixture-token';
      final session = BackendSession(api: api, store: MemoryTokenStore())
        ..user = {'id': 'parent', 'role': 'PARENT'};
      final previous = BackendSession.replaceForTesting(session);
      var loads = 0;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        BackendSession.replaceForTesting(previous);
        await api.updates.close();
        api.close();
        session.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BackendFeed(
              load: () async => ++loads,
              alertChild: (_) => 'child-fixture',
              builder: (_, value) => Text('Stored alert revision $value'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Stored alert revision 1'), findsOneWidget);
      final start = tester.binding.clock.now();
      api.updates.add({
        'topics': ['alerts'],
      });
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));
      expect(find.text('Stored alert revision 2'), findsOneWidget);
      expect(
        tester.binding.clock.now().difference(start),
        lessThan(const Duration(seconds: 1)),
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      api.updates.add({
        'topics': ['alerts'],
      });
      await tester.pump(const Duration(seconds: 4));
      expect(loads, 2);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(loads, 3);
      expect(api.subscriptions, 2);
    },
  );

  testWidgets(
    'no-fix and historical GPS show recorded evidence without live safety claims',
    (tester) async {
      final fixture = useBackend(tester);
      backendTab.value = 1;
      fixture.respond = (r) => r.url.path.endsWith('/location')
          ? BackendFixture.data({
              'child': fixture.children.first,
              'device': {'hardwareId': 'FIXTURE-WEARABLE'},
              'gpsMonitoring': {
                'latestStatus': 'GPS_NO_FIX',
                'lastValidLocation': {
                  'latitude': 6.9,
                  'longitude': 79.8,
                  'recordedChildId': BackendFixture.childId,
                  'observedAt': '2020-01-01T00:00:00Z',
                  'receivedAt': '2020-01-01T00:00:01Z',
                  'state': 'HISTORICAL',
                },
              },
              'configurationAvailable': true,
              'geofence': {
                'name': 'Stored center zone',
                'radiusM': 100,
                'active': true,
                'revision': 2,
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
      expect(find.text('Waiting for a GPS fix'), findsOneWidget);
      expect(find.textContaining('Historical GPS position'), findsOneWidget);
      expect(find.text('6.9, 79.8'), findsOneWidget);
      expect(find.textContaining('Stored center zone'), findsOneWidget);
      expect(find.text('Recent recorded GPS fix'), findsNothing);
      expect(find.textContaining('does not establish'), findsOneWidget);
    },
  );

  testWidgets(
    'registration disabled does not block own profile editing or enable requests',
    (tester) async {
      final fixture = useBackend(tester);
      fixture.respond = (r) =>
          r.url.path == '/api/v1/mobile/profile' && r.method == 'GET'
          ? BackendFixture.data({
              ...fixture.profile,
              'profile': fixture.accountProfile,
              'profileAvailable': true,
              'registrationEnabled': false,
            })
          : null;
      await tester.pumpWidget(
        const MaterialApp(home: AccountManagementScreen()),
      );
      await tester.pumpAndSettle();
      expect(
        fixture.requests.any((r) => r.url.path == '/api/v1/account/requests'),
        isFalse,
      );
      expect(
        find.textContaining('disabled by your administrator'),
        findsOneWidget,
      );
      final request = tester.widget<TextButton>(
        find.widgetWithText(TextButton, 'Request wearable assignment'),
      );
      expect(request.onPressed, isNull);
      await tapVisible(tester, find.text('Save profile'));
      expect(find.text('Profile saved to ChildGuard.'), findsOneWidget);
      expect(
        fixture.requests.any(
          (r) => r.url.path == '/api/v1/mobile/profile' && r.method == 'PATCH',
        ),
        isTrue,
      );
    },
  );
}
