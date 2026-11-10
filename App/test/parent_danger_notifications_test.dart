import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/core/widgets/teacher_alert_card.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/alerts/alerts_screen.dart';
import 'package:final_project/screens/main_wrapper.dart';

import 'support/backend_fixture.dart';

Map<String, dynamic> saved(
  String id, {
  String kind = 'DANGER_ZONE_NEAR',
  String child = BackendFixture.childId,
  String name = 'Recorded Child',
}) => {
  'id': id,
  'kind': kind,
  'state': 'RECORDED',
  'createdAt': '2026-10-28T05:00:00Z',
  'child': {'id': child, 'name': name},
  'checkedByMe': true,
  'canCheck': true,
  'reviewToken': 'not-a-parent-credential',
  'event': {
    'device': {'hardwareId': 'ORIGINAL-BELT'},
    'beacon': {'name': 'Recorded Zone', 'location': 'Recorded Boundary'},
    'observedAt': '2026-10-28T04:59:59Z',
  },
  'connection': {
    'lastCommunicationAt': '2026-10-28T04:58:00Z',
    'detectedAt': '2026-10-28T05:00:00Z',
  },
  'details': {
    'zone': {'name': 'Recorded GPS Boundary'},
  },
};
Future<void> home(WidgetTester tester) =>
    tester.pumpWidget(const MaterialApp(home: HomeScreen()));
void main() {
  testWidgets(
    'Parent Home keeps its header, profile and quick actions while showing one actual recorded danger',
    (tester) async {
      final f = useBackend(tester);
      f.children.first['groupName'] = 'Blue group';
      f.alerts
        ..clear()
        ..add(saved('latest'));
      await home(tester);
      await tester.pumpAndSettle();
      for (final text in [
        'Danger Notifications',
        'Danger-zone alert',
        'Child: Recorded Child',
        'Wearable: ORIGINAL-BELT',
        'Beacon: Recorded Zone',
        'Place: Recorded Boundary',
        'Recorded: 2026-10-28 10:30 (Sri Lanka)',
        'Live Location',
        'Attendance',
        'Alerts',
        'SOS',
        'Pickup',
        "Activity",
      ]) {
        expect(find.text(text), findsWidgets);
      }
      expect(find.textContaining('fixture-parent'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      expect(find.textContaining('GPS:'), findsNothing);
      expect(find.textContaining('Movement monitoring'), findsNothing);
      expect(find.text('Children Attendance'), findsNothing);
      expect(find.text('Mark as Checked'), findsNothing);
      expect(find.text('Checked by you'), findsNothing);
      expect(
        f.requests
            .where((r) => r.url.path.endsWith('/alerts'))
            .last
            .url
            .queryParameters,
        containsPair('category', 'safety'),
      );
      expect(
        f.requests.any(
          (r) =>
              r.method != 'GET' ||
              r.url.path.startsWith('/api/v1/mobile/alerts'),
        ),
        isFalse,
      );
    },
  );
  testWidgets(
    'Home excludes non-danger notifications and shows a genuine empty state',
    (tester) async {
      final f = useBackend(tester);
      f.alerts
        ..clear()
        ..addAll([
          saved('ble', kind: 'BEACON_SIGNAL_LOST'),
          saved('connection', kind: 'WEARABLE_CONNECTION_LOST'),
          saved('gps', kind: 'GPS_NO_FIX'),
          saved('activity', kind: 'ACTIVITY_WINDOW'),
        ]);
      await home(tester);
      await tester.pumpAndSettle();
      expect(find.text('No danger alerts recorded.'), findsOneWidget);
      expect(find.byType(TeacherAlertCard), findsNothing);
      expect(find.text('Wearable Connection Lost'), findsNothing);
    },
  );
  testWidgets(
    'Home displays one latest danger, refreshes to a newer saved incident and never suppresses it using Teacher checks',
    (tester) async {
      final f = useBackend(tester);
      f.alerts
        ..clear()
        ..addAll(
          List.generate(5, (i) => saved('event-$i', name: 'Event Child $i')),
        );
      await home(tester);
      await tester.pumpAndSettle();
      expect(find.byType(TeacherAlertCard), findsOneWidget);
      expect(find.text('Child: Event Child 0'), findsOneWidget);
      f.alerts.insert(0, saved('new', name: 'Newer Child'));
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.text('Child: Newer Child'), findsOneWidget);
      expect(find.text('Child: Event Child 0'), findsNothing);
      expect(find.byType(TeacherAlertCard), findsOneWidget);
    },
  );
  testWidgets(
    'danger API errors retain other Parent information and Retry does not claim a false empty response',
    (tester) async {
      final f = useBackend(tester);
      f.respond = (r) => r.url.path.endsWith('/alerts')
          ? BackendFixture.error(503, 'unavailable')
          : null;
      await home(tester);
      await tester.pumpAndSettle();
      expect(find.text('Unable to load danger notifications.'), findsOneWidget);
      expect(find.text('No danger alerts recorded.'), findsNothing);
      expect(find.text("Today's attendance"), findsNothing);
      expect(find.textContaining('GPS:'), findsNothing);
      f.respond = null;
      await tapVisible(tester, find.widgetWithText(TextButton, 'Retry'));
      expect(find.text('Danger-zone alert'), findsOneWidget);
    },
  );
  testWidgets(
    'child switching clears the prior alert and rejects an old response arriving later',
    (tester) async {
      final f = useBackend(tester);
      f.children.add({
        'id': BackendFixture.otherChildId,
        'name': 'Second Child',
      });
      f.respond = (r) => r.url.path.endsWith('/alerts')
          ? BackendFixture.data([
              r.url.path.contains(BackendFixture.otherChildId)
                  ? saved(
                      'b',
                      child: BackendFixture.otherChildId,
                      name: 'Second Child',
                    )
                  : saved('a', name: 'First Child'),
            ])
          : null;
      await home(tester);
      await tester.pumpAndSettle();
      expect(find.text('Child: First Child'), findsOneWidget);
      final pending = Completer<http.Response>();
      f.respondAsync = (r) =>
          r.url.path.contains(BackendFixture.childId) &&
              r.url.path.endsWith('/alerts')
          ? pending.future
          : Future.value(null);
      backendRefresh.value++;
      await tester.pump();
      await tester.ensureVisible(
        find.byType(DropdownButtonFormField<String>).first,
      );
      await tester.tap(find.byType(DropdownButtonFormField<String>).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Second Child').last);
      await tester.pumpAndSettle();
      expect(find.text('Child: First Child'), findsNothing);
      expect(find.text('Child: Second Child'), findsOneWidget);
      pending.complete(
        BackendFixture.data([saved('old', name: 'Obsolete First Child')]),
      );
      await tester.pumpAndSettle();
      expect(find.text('Child: Obsolete First Child'), findsNothing);
      expect(find.text('Child: Second Child'), findsOneWidget);
    },
  );
  testWidgets(
    'View All opens the existing Alerts screen with the selected child identity',
    (tester) async {
      final f = useBackend(tester);
      f.children.add({
        'id': BackendFixture.otherChildId,
        'name': 'Second Child',
      });
      f.respond = (r) => r.url.path.endsWith('/alerts')
          ? BackendFixture.data([
              saved(
                'selected',
                child: r.url.path.contains(BackendFixture.otherChildId)
                    ? BackendFixture.otherChildId
                    : BackendFixture.childId,
              ),
            ])
          : null;
      await home(tester);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Second Child').last);
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('View All').first);
      expect(
        tester.widget<AlertsScreen>(find.byType(AlertsScreen)).childId,
        BackendFixture.otherChildId,
      );
      expect(find.text('Page 1'), findsOneWidget);
    },
  );
  for (final item in [
    ('DANGER_ZONE_NEAR', 'Danger-zone alert', const Color(0xFFFFF1F1)),
    ('GEOFENCE_OUTSIDE', 'Outside GPS safe area', const Color(0xFFFFF1F1)),
    (
      'WEARABLE_CONNECTION_LOST',
      'Wearable Connection Lost',
      const Color(0xFFFFF7E6),
    ),
    ('LOW_ACTIVITY', 'Low movement detected', const Color(0xFFFFF7E6)),
    ('FUTURE_KIND', 'Saved notification', const Color(0xFFF1F5F9)),
  ]) {
    testWidgets(
      'Parent category ${item.$1} is readable, correctly colored and read-only',
      (tester) async {
        final f = useBackend(tester);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: TeacherAlertCard(
                  alert: saved('saved', kind: item.$1),
                  readOnly: true,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text(item.$2), findsOneWidget);
        final material = tester.widget<Material>(
          find
              .descendant(
                of: find.byType(TeacherAlertCard),
                matching: find.byType(Material),
              )
              .first,
        );
        expect(material.color, item.$3);
        expect(find.text('Wearable: ORIGINAL-BELT'), findsOneWidget);
        expect(find.text('Checked by you'), findsNothing);
        expect(find.text('Mark as Checked'), findsNothing);
        if (item.$1 != 'DANGER_ZONE_NEAR') {
          expect(find.textContaining('Beacon:'), findsNothing);
        }
        if (item.$1 == 'WEARABLE_CONNECTION_LOST') {
          expect(
            find.text('Last communication: 2026-10-28 10:28 (Sri Lanka)'),
            findsOneWidget,
          );
          expect(find.textContaining('Wi-Fi disconnected'), findsNothing);
        }
        expect(f.requests, isEmpty);
      },
    );
  }
  testWidgets(
    'Parent history retains complete paginated records, filters legacy signal loss and never posts checks',
    (tester) async {
      final f = useBackend(tester);
      f.alerts
        ..clear()
        ..addAll(List.generate(27, (i) => saved('row-$i')));
      await tester.pumpWidget(const MaterialApp(home: AlertsScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(TeacherAlertCard), findsNWidgets(25));
      await tapVisible(tester, find.widgetWithText(TextButton, 'Next'));
      expect(find.byType(TeacherAlertCard), findsNWidgets(2));
      expect(find.text('Page 2'), findsOneWidget);
      await tapVisible(tester, find.widgetWithText(TextButton, 'Previous'));
      expect(find.byType(TeacherAlertCard), findsNWidgets(25));
      expect(find.text('Checked by you'), findsNothing);
      expect(find.text('Mark as Checked'), findsNothing);
      expect(f.requests.every((r) => r.method == 'GET'), isTrue);
    },
  );
  testWidgets(
    'mismatched child data is never rendered as another child Home alert',
    (tester) async {
      final f = useBackend(tester);
      f.respond = (r) => r.url.path.endsWith('/alerts')
          ? BackendFixture.data([
              saved(
                'foreign',
                child: 'another-center-child',
                name: 'Private Child',
              ),
            ])
          : null;
      await home(tester);
      await tester.pumpAndSettle();
      expect(find.text('Child: Private Child'), findsNothing);
      expect(find.text('Unable to load danger notifications.'), findsOneWidget);
    },
  );
  testWidgets(
    'missing historical fields stay unavailable rather than substituting the current wearable',
    (tester) async {
      useBackend(tester);
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: TeacherAlertCard(
              alert: {'id': 'missing', 'kind': 'DANGER_ZONE_NEAR'},
              readOnly: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      for (final field in ['Child', 'Wearable', 'Beacon', 'Place']) {
        expect(find.text('$field: Not available'), findsOneWidget);
      }
      expect(find.text('Recorded: Time not available'), findsOneWidget);
    },
  );
  for (final width in [320.0, 390.0]) {
    testWidgets(
      'Parent Home and Alerts wrap long values at $width without changing navigation',
      (tester) async {
        final f = useBackend(tester);
        f.children.first['name'] =
            'A long authorized child name for narrow Android screens';
        f.alerts
          ..clear()
          ..add(
            saved(
              'long',
              name: 'A long recorded child name that wraps naturally',
            )..['event']['beacon']['location'] = 'A long recorded boundary description at the playground entrance',
          );
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(const MaterialApp(home: MainWrapperScreen()));
        await tester.pumpAndSettle();
        expect(find.text('Danger Notifications'), findsOneWidget);
        expect(find.byType(BottomNavigationBar), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tapVisible(tester, find.text('View All').first);
        expect(find.byType(AlertsScreen), findsOneWidget);
        expect(find.text('Danger-zone alert'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'Parent Home reuses feed lifecycle refresh and disposes listeners',
    (tester) async {
      final f = useBackend(tester);
      await home(tester);
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      final before = f.requests.length;
      await tester.pump(const Duration(seconds: 30));
      expect(f.requests.length, before);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(f.requests.length, greaterThan(before));
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      final disposed = f.requests.length;
      backendRefresh.value++;
      await tester.pump(const Duration(seconds: 30));
      expect(f.requests.length, disposed);
    },
  );
}
