import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/home/teacher_home_dashboard.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/core/widgets/teacher_alert_watch.dart';
import 'package:final_project/models/user_role.dart';

import 'support/backend_fixture.dart';

Map<String, dynamic> danger(
  String id, {
  String time = '2026-10-27T05:00:00Z',
}) => {
  'id': id,
  'kind': 'DANGER_ZONE_NEAR',
  'state': 'RECORDED',
  'createdAt': time,
  'child': {'id': 'alert-child', 'name': 'Recorded Child'},
  'event': {
    'device': {'hardwareId': 'HISTORIC-WEARABLE'},
    'beacon': {
      'hardwareId': 'ZONE-ID',
      'name': 'Recorded Zone',
      'location': 'Recorded Boundary',
    },
  },
};
Map<String, dynamic> attendance(
  String id,
  String status, {
  String day = '2026-10-27',
}) => {
  'id': 'record-$id',
  'child': {'id': id, 'name': id},
  'day': day,
  'status': status,
};

class HomeFixture {
  final BackendFixture backend;
  List<Map<String, dynamic>> alerts = [], roster = [];
  bool failAlerts = false, failAttendance = false;
  HomeFixture(WidgetTester tester, {String role = 'TEACHER'})
    : backend = useBackend(tester, role: role) {
    backend.respond = (r) {
      if (r.url.path == '/api/v1/mobile/alerts/danger-groups') {
        return failAlerts
            ? BackendFixture.error(503, 'synthetic unavailable')
            : BackendFixture.data(teacherHomeDangerAlerts(alerts));
      }
      if (r.url.path == '/api/v1/mobile/alerts') {
        return failAlerts
            ? BackendFixture.error(503, 'synthetic unavailable')
            : BackendFixture.data(
                r.url.queryParameters['kind'] == null
                    ? alerts
                    : alerts
                          .where((a) => a['kind'] == 'DANGER_ZONE_NEAR')
                          .toList(),
              );
      }
      if (r.url.path == '/api/v1/attendance/roster') {
        final offset = int.parse(r.url.queryParameters['offset'] ?? '0');
        return failAttendance
            ? BackendFixture.error(503, 'synthetic unavailable')
            : BackendFixture.data(roster.skip(offset).take(100).toList());
      }
      return null;
    };
  }
}

Future<void> home(
  WidgetTester tester, {
  UserRole role = UserRole.teacher,
}) async {
  await tester.pumpWidget(MaterialApp(home: HomeScreen(userRole: role)));
  await tester.pumpAndSettle();
}

String count(WidgetTester tester, String status) => tester
    .widgetList<Text>(
      find.descendant(
        of: find.byKey(ValueKey('teacher-home-count-$status')),
        matching: find.byType(Text),
      ),
    )
    .last
    .data!;
void main() {
  test('only actual recorded danger alerts qualify, newest first, deduplicated and capped', () {
    final data = [
      danger('old'),
      danger('new', time: '2026-10-27T06:00:00Z'),
      danger('old'),
      for (final kind in [
        'BEACON_SIGNAL_LOST',
        'GPS_NO_FIX',
        'GPS_STATUS',
        'BLE_PROXIMITY',
        'ACTIVITY_WINDOW',
        'CHILD_NEAR_GATE',
        'DEVICE_ONLINE',
      ])
        {'id': kind, 'kind': kind, 'state': 'RECORDED'},
    ];
    expect(teacherHomeDangerAlerts(data).map((r) => r['id']), ['new']);
    expect(
      teacherHomeDangerAlerts(
        List.generate(
          9,
          (i) => {
            ...danger('$i'),
            'child': {'id': 'child-$i', 'name': 'Same name'},
          },
        ),
      ),
      hasLength(5),
    );
    expect(
      () => teacherHomeDangerAlerts([
        {'id': 'raw-near', 'kind': 'DANGER_ZONE_NEAR', 'state': 'OBSERVATION'},
      ]),
      throwsA(isA<Exception>()),
    );
  });
  test('complete roster counts distinct children and never invents absence from missing states', () {
    final rows = [
      for (final status in [
        'PRESENT',
        'CHECKIN_PENDING',
        'ABSENT',
        'CHECKED_OUT',
        'NOT_CHECKED_IN',
        'NO_RECORD',
        'UNKNOWN',
      ])
        attendance(status, status),
      attendance('ABSENT', 'ABSENT'),
    ];
    expect(teacherHomeAttendanceCounts(rows), {
      'PRESENT': 1,
      'CHECKIN_PENDING': 1,
      'ABSENT': 1,
      'CHECKED_OUT': 1,
    });
    expect(teacherHomeAttendanceCounts([]).values, everyElement(0));
    expect(
      () => teacherHomeAttendanceCounts([
        attendance('a', 'ABSENT'),
        attendance('a', 'PRESENT'),
      ]),
      throwsA(isA<Exception>()),
    );
    expect(
      () => teacherHomeAttendanceCounts([
        attendance('a', 'ABSENT'),
        attendance('b', 'PRESENT', day: '2026-10-28'),
      ]),
      throwsA(isA<Exception>()),
    );
  });
  testWidgets(
    'Teacher Home shows recorded danger identities in red before attendance, without child monitoring clutter',
    (tester) async {
      final f = HomeFixture(tester);
      f.alerts = [danger('real')];
      f.roster = [
        for (final state in [
          'PRESENT',
          'CHECKIN_PENDING',
          'ABSENT',
          'CHECKED_OUT',
          'NO_RECORD',
          'NOT_CHECKED_IN',
        ])
          attendance(state, state),
      ];
      await home(tester);
      for (final text in [
        'Danger Notifications',
        'Children Attendance',
        'Danger-zone alert',
        'Child: Recorded Child',
        'Wearable: HISTORIC-WEARABLE',
        'Beacon: Recorded Zone',
        'Place: Recorded Boundary',
        'Time: 2026-10-27 10:30 (Sri Lanka)',
      ]) {
        expect(find.text(text), findsOneWidget);
      }
      expect(
        tester.getTopLeft(find.text('Danger Notifications')).dy,
        lessThan(tester.getTopLeft(find.text('Children Attendance')).dy),
      );
      for (final state in [
        'PRESENT',
        'CHECKIN_PENDING',
        'ABSENT',
        'CHECKED_OUT',
      ]) {
        expect(count(tester, state), '1');
      }
      expect(find.byType(ChildPanel), findsNothing);
      expect(find.byType(DropdownButton<String>), findsNothing);
      expect(find.text("Today's Activity"), findsNothing);
      final warning = tester.widget<Icon>(
        find.byIcon(Icons.warning_amber_rounded),
      );
      expect(warning.color, const Color(0xFFB42323));
      expect(f.backend.requests.where((r) => r.method != 'GET'), isEmpty);
      expect(
        f.backend.requests.any(
          (r) =>
              r.url.path == '/api/v1/mobile/alerts/danger-groups' &&
              r.url.queryParameters['limit'] == '5',
        ),
        isTrue,
      );
    },
  );
  testWidgets(
    'genuine empty result differs from errors; cached danger and counts stay visible on failed refresh',
    (tester) async {
      final f = HomeFixture(tester);
      await home(tester);
      expect(find.text('No new danger notifications.'), findsOneWidget);
      expect(count(tester, 'ABSENT'), '0');
      f.alerts = [danger('saved')];
      f.roster = [attendance('a', 'ABSENT')];
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.text('Child: Recorded Child'), findsOneWidget);
      f.failAlerts = true;
      f.failAttendance = true;
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.text('Unable to load danger notifications.'), findsOneWidget);
      expect(find.text('Unable to load attendance.'), findsOneWidget);
      expect(find.text('Child: Recorded Child'), findsOneWidget);
      expect(count(tester, 'ABSENT'), '1');
      expect(find.text('No new danger notifications.'), findsNothing);
    },
  );
  testWidgets(
    'initial failures do not display fabricated zero counts or empty danger success',
    (tester) async {
      final f = HomeFixture(tester);
      f.failAlerts = true;
      f.failAttendance = true;
      await home(tester);
      expect(find.text('Unable to load danger notifications.'), findsOneWidget);
      expect(find.text('No new danger notifications.'), findsNothing);
      expect(
        find.byKey(const ValueKey('teacher-home-count-ABSENT')),
        findsNothing,
      );
      f.failAlerts = false;
      f.failAttendance = false;
      await tapVisible(tester, find.widgetWithText(TextButton, 'Retry').first);
      expect(find.text('No new danger notifications.'), findsOneWidget);
    },
  );
  testWidgets(
    'missing historical wearable and beacon/place remain unavailable, not current-assignment guesses',
    (tester) async {
      final f = HomeFixture(tester);
      f.alerts = [
        {
          ...danger('old'),
          'event': {
            'device': null,
            'beacon': {'name': '', 'location': ''},
          },
        },
      ];
      await home(tester);
      expect(find.text('Wearable: Wearable not available'), findsOneWidget);
      expect(find.text('Beacon: Beacon not available'), findsOneWidget);
      expect(find.text('Place: Place not available'), findsOneWidget);
    },
  );
  testWidgets(
    'all roster pages count, including absent children after the first 100',
    (tester) async {
      final f = HomeFixture(tester);
      f.roster = List.generate(
        101,
        (i) => attendance('$i', i == 100 ? 'ABSENT' : 'PRESENT'),
      );
      await home(tester);
      expect(count(tester, 'PRESENT'), '100');
      expect(count(tester, 'ABSENT'), '1');
      expect(
        f.backend.requests.any(
          (r) =>
              r.url.path == '/api/v1/attendance/roster' &&
              r.url.queryParameters['offset'] == '100',
        ),
        isTrue,
      );
    },
  );
  testWidgets(
    'attendance card opens existing Teacher Attendance with its filters and actions area',
    (tester) async {
      HomeFixture(tester);
      await home(tester);
      await tapVisible(
        tester,
        find.byKey(const ValueKey('teacher-home-attendance')),
      );
      for (final label in ['All Students', 'Present', 'Pending', 'Absent']) {
        expect(
          find.byKey(ValueKey('attendance-filter-$label')),
          findsOneWidget,
        );
      }
      expect(find.text("Today's Attendance Actions"), findsOneWidget);
      await tapVisible(tester, find.byTooltip('Back'));
      expect(find.text('Children Attendance'), findsOneWidget);
    },
  );
  testWidgets(
    'Parent Home keeps its child profile and never requests Teacher center feeds',
    (tester) async {
      final f = HomeFixture(tester, role: 'PARENT');
      await home(tester, role: UserRole.parent);
      expect(find.byType(ChildPanel), findsWidgets);
      expect(find.text('Danger Notifications'), findsOneWidget);
      expect(find.text('Children Attendance'), findsNothing);
      expect(
        f.backend.requests.any(
          (r) =>
              r.url.path.startsWith('/api/v1/mobile/alerts') ||
              r.url.path == '/api/v1/attendance/roster',
        ),
        isFalse,
      );
    },
  );
  testWidgets(
    'a Teacher route argument cannot give a Parent center-wide dashboard access',
    (tester) async {
      final f = HomeFixture(tester, role: 'PARENT');
      await home(tester);
      expect(
        find.text('Sign in as a Teacher to view this dashboard.'),
        findsOneWidget,
      );
      expect(
        f.backend.requests.any(
          (r) =>
              r.url.path.startsWith('/api/v1/mobile/alerts') ||
              r.url.path == '/api/v1/attendance/roster',
        ),
        isFalse,
      );
    },
  );
  testWidgets(
    'existing foreground watcher refreshes Home from the same persisted danger alert without duplication',
    (tester) async {
      final f = HomeFixture(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: TeacherAlertWatch(
            onOpen: () {},
            child: const HomeScreen(userRole: UserRole.teacher),
          ),
        ),
      );
      await tester.pumpAndSettle();
      f.alerts = [danger('new')];
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.text('Child: Recorded Child'), findsOneWidget);
      final readCount = f.backend.requests.length;
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.text('Child: Recorded Child'), findsOneWidget);
      expect(
        f.backend.requests.length - readCount,
        1,
      ); // Existing watcher only; no Home three-second polling.
    },
  );
  testWidgets(
    'returning from attendance refreshes counts after Teacher decisions',
    (tester) async {
      final f = HomeFixture(tester);
      f.roster = [attendance('child', 'ABSENT')];
      await home(tester);
      expect(count(tester, 'ABSENT'), '1');
      await tapVisible(
        tester,
        find.byKey(const ValueKey('teacher-home-attendance')),
      );
      f.roster = [attendance('child', 'CHECKED_OUT')];
      await tapVisible(tester, find.byTooltip('Back'));
      expect(count(tester, 'ABSENT'), '0');
      expect(count(tester, 'CHECKED_OUT'), '1');
    },
  );
  testWidgets(
    'background and disposal stop Home reads; logout removes prior center data',
    (tester) async {
      final f = HomeFixture(tester);
      f.alerts = [danger('private')];
      await home(tester);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      final before = f.backend.requests.length;
      await tester.pump(const Duration(seconds: 60));
      expect(f.backend.requests.length, before);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(f.backend.requests.length, greaterThan(before));
      await f.backend.session.logout();
      await tester.pumpAndSettle();
      expect(find.text('Child: Recorded Child'), findsNothing);
      expect(
        find.text('Sign in as a Teacher to view this dashboard.'),
        findsOneWidget,
      );
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      final disposed = f.backend.requests.length;
      backendRefresh.value++;
      await tester.pump(const Duration(seconds: 60));
      expect(f.backend.requests.length, disposed);
    },
  );
  for (final width in [320.0, 390.0]) {
    testWidgets(
      'Teacher dashboard wraps long names and scrolls at ${width.toInt()}px',
      (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final f = HomeFixture(tester);
        final alert = danger('long');
        alert['child'] = {
          'name': 'A long recorded child name that should remain readable',
        };
        alert['event']['beacon']['name'] =
            'A long danger-zone beacon name near the playground';
        alert['event']['beacon']['location'] =
            'The registered boundary beside the outdoor play area';
        f.alerts = [alert];
        await home(tester);
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('Children Attendance'));
        await tester.pumpAndSettle();
        expect(
          tester
              .getRect(find.byKey(const ValueKey('teacher-home-attendance')))
              .right,
          lessThanOrEqualTo(width),
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
