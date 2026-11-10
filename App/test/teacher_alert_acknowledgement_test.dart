import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:final_project/core/backend.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/core/widgets/teacher_alert_card.dart';
import 'package:final_project/models/user_role.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/alerts/alerts_screen.dart';

import 'support/backend_fixture.dart';

Map<String, dynamic> saved(
  String id,
  String child,
  int minute, {
  String kind = 'DANGER_ZONE_NEAR',
}) => {
  'id': id,
  'kind': kind,
  'state': 'RECORDED',
  'createdAt': '2026-10-27T05:${minute.toString().padLeft(2, '0')}:00Z',
  'child': {'id': child, 'name': 'Child $child'},
  'event': {
    'device': {'hardwareId': 'HISTORIC-$child'},
    'beacon': {'name': 'Recorded Beacon', 'location': 'Recorded Place'},
  },
};

class CheckFixture {
  final BackendFixture backend;
  final records = <Map<String, dynamic>>[];
  final checked = <String>{};
  bool fail = false;
  CheckFixture(WidgetTester tester)
    : backend = useBackend(tester, role: 'TEACHER') {
    records.addAll([
      for (var i = 0; i < 5; i++) saved('a$i', 'A', i),
      saved('b', 'B', 0),
      saved('signal', 'B', 1, kind: 'LOW_ACTIVITY'),
    ]);
    Map<String, dynamic> view(Map<String, dynamic> row) => {
      ...row,
      'checkedByMe': checked.contains(row['id']),
      'checkedAt': checked.contains(row['id']) ? '2026-10-27T06:00:00Z' : null,
      'canCheck':
          row['kind'] == 'DANGER_ZONE_NEAR' && !checked.contains(row['id']),
      'reviewToken': 'review:${row['id']}',
    };
    backend.respond = (r) {
      if (r.method == 'POST' && r.url.path.endsWith('/check')) {
        if (fail) {
          return BackendFixture.error(503, 'Unable to save. Try again.');
        }
        final id = r.url.path.split('/').reversed.elementAt(1);
        final row = records.firstWhere((row) => row['id'] == id);
        if ((jsonDecode(r.body) as Map)['reviewToken'] != 'review:$id') {
          return BackendFixture.error(
            409,
            'Refresh notifications before checking',
          );
        }
        checked.addAll(
          records
              .where(
                (a) =>
                    a['kind'] == 'DANGER_ZONE_NEAR' &&
                    a['child']['id'] == row['child']['id'] &&
                    (a['createdAt'] as String).compareTo(row['createdAt']) <= 0,
              )
              .map((a) => a['id'] as String),
        );
        return BackendFixture.data({
          'checkedByMe': true,
          'checkedAt': '2026-10-27T06:00:00Z',
        });
      }
      if (r.url.path == '/api/v1/mobile/alerts/danger-groups') {
        final groups = <String, Map<String, dynamic>>{};
        final eligible =
            records
                .where(
                  (a) =>
                      a['kind'] == 'DANGER_ZONE_NEAR' &&
                      !checked.contains(a['id']),
                )
                .toList()
              ..sort(
                (a, b) => (b['createdAt'] as String).compareTo(a['createdAt']),
              );
        for (final row in eligible) {
          final child = row['child']['id'] as String;
          groups.putIfAbsent(
            child,
            () => {
              ...view(row),
              'uncheckedCount': eligible
                  .where((a) => a['child']['id'] == child)
                  .length,
            },
          );
        }
        return BackendFixture.data(groups.values.take(5).toList());
      }
      if (r.url.path == '/api/v1/mobile/alerts') {
        final offset = int.parse(r.url.queryParameters['offset'] ?? '0');
        return BackendFixture.data(
          records.skip(offset).take(25).map(view).toList(),
        );
      }
      return null;
    };
  }
}

Finder childCard(String child) => find.byWidgetPredicate(
  (w) => w is TeacherAlertCard && w.alert['child']?['id'] == child,
);
Finder checkButton(Finder card) =>
    find.descendant(of: card, matching: find.text('Mark as Checked'));
Future<void> mountHome(WidgetTester tester) async {
  await tester.pumpWidget(
    const MaterialApp(home: HomeScreen(userRole: UserRole.teacher)),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'Home groups by child, checks all reviewed events, retains other children and shows new incidents',
    (tester) async {
      final f = CheckFixture(tester);
      await mountHome(tester);
      expect(childCard('A'), findsOneWidget);
      expect(childCard('B'), findsOneWidget);
      expect(find.text('5 danger alerts'), findsOneWidget);
      expect(find.text('Time: 2026-10-27 10:34 (Sri Lanka)'), findsOneWidget);
      await tapVisible(tester, checkButton(childCard('A')));
      expect(f.checked, containsAll(['a0', 'a1', 'a2', 'a3', 'a4']));
      expect(childCard('A'), findsNothing);
      expect(childCard('B'), findsOneWidget);
      expect(f.records, hasLength(7));
      f.records.add(saved('a-new', 'A', 10));
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(childCard('A'), findsOneWidget);
      expect(find.text('Time: 2026-10-27 10:40 (Sri Lanka)'), findsOneWidget);
      expect(f.checked.contains('a-new'), isFalse);
    },
  );
  testWidgets(
    'failed saving keeps the group, shows error and allows retry; a new mount reads persisted checks',
    (tester) async {
      final f = CheckFixture(tester);
      f.fail = true;
      await mountHome(tester);
      await tapVisible(tester, checkButton(childCard('A')));
      expect(childCard('A'), findsOneWidget);
      expect(f.checked, isEmpty);
      expect(find.text('Unable to save. Try again.'), findsOneWidget);
      f.fail = false;
      await tapVisible(
        tester,
        find.descendant(of: childCard('A'), matching: find.text('Retry')),
      );
      expect(childCard('A'), findsNothing);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pumpAndSettle();
      await mountHome(tester);
      expect(childCard('A'), findsNothing);
      expect(childCard('B'), findsOneWidget);
      await tapVisible(tester, checkButton(childCard('B')));
      expect(find.text('No new danger notifications.'), findsOneWidget);
      expect(find.text('Children Attendance'), findsOneWidget);
    },
  );
  testWidgets(
    'Alerts retains every event, uses category colors, and checking history updates Home',
    (tester) async {
      final f = CheckFixture(tester);
      await mountHome(tester);
      await tapVisible(tester, find.text('View all'));
      expect(find.byType(TeacherAlertsPanel), findsOneWidget);
      expect(find.byType(TeacherAlertCard), findsNWidgets(7));
      expect(find.text('Danger-zone alert'), findsNWidgets(6));
      expect(find.text('Low movement detected'), findsOneWidget);
      final selected = find.byWidgetPredicate(
        (w) => w is TeacherAlertCard && w.alert['id'] == 'a4',
      );
      await tapVisible(tester, checkButton(selected));
      expect(find.text('Checked by you'), findsNWidgets(5));
      expect(find.text('New'), findsOneWidget);
      expect(
        find.text('Checked means reviewed, not resolved.'),
        findsOneWidget,
      );
      Navigator.of(tester.element(find.byType(AlertsScreen))).pop();
      await tester.pumpAndSettle();
      expect(childCard('A'), findsNothing);
      expect(childCard('B'), findsOneWidget);
      expect(f.records, hasLength(7));
    },
  );
  testWidgets('history pagination keeps older saved notifications accessible', (
    tester,
  ) async {
    final f = CheckFixture(tester);
    f.records
      ..clear()
      ..addAll(
        List.generate(
          27,
          (i) => saved('signal-$i', 'child-$i', i, kind: 'LOW_ACTIVITY'),
        ),
      );
    await tester.pumpWidget(
      const MaterialApp(home: AlertsScreen(userRole: UserRole.teacher)),
    );
    await tester.pumpAndSettle();
    expect(find.byType(TeacherAlertCard), findsNWidgets(25));
    await tapVisible(tester, find.text('Next'));
    expect(find.text('Page 2'), findsOneWidget);
    expect(find.byType(TeacherAlertCard), findsNWidgets(2));
    expect(
      f.backend.requests.any(
        (r) =>
            r.url.path == '/api/v1/mobile/alerts' &&
            r.url.queryParameters['offset'] == '25',
      ),
      isTrue,
    );
    await tapVisible(tester, find.text('Previous'));
    expect(find.text('Page 1'), findsOneWidget);
  });
  testWidgets(
    'checks from an independently opened Alerts route refresh Home on return',
    (tester) async {
      final f = CheckFixture(tester);
      await mountHome(tester);
      final navigator = Navigator.of(tester.element(find.byType(HomeScreen)));
      unawaited(
        navigator.push(
          MaterialPageRoute<void>(
            builder: (_) => const AlertsScreen(userRole: UserRole.teacher),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final card = find.byWidgetPredicate(
        (w) => w is TeacherAlertCard && w.alert['id'] == 'a4',
      );
      await tapVisible(tester, checkButton(card));
      navigator.pop();
      await tester.pumpAndSettle();
      expect(childCard('A'), findsNothing);
      expect(childCard('B'), findsOneWidget);
      expect(f.checked, hasLength(5));
    },
  );
  test('known saved kinds have readable, accurate styling and unknown types stay neutral', () {
    expect(
      teacherAlertStyle('DANGER_ZONE_NEAR').background,
      const Color(0xFFFFF1F1),
    );
    expect(
      teacherAlertStyle('WEARABLE_CONNECTION_LOST').background,
      const Color(0xFFFFF7E6),
    );
    expect(
      teacherAlertStyle('WEARABLE_CONNECTION_LOST').title,
      'Wearable Connection Lost',
    );
    expect(
      teacherAlertStyle('GEOFENCE_OUTSIDE').title,
      'Outside GPS safe area',
    );
    expect(teacherAlertStyle('LOW_ACTIVITY').title, 'Low movement detected');
    expect(teacherAlertStyle('FUTURE_NEAR').title, 'Saved notification');
    expect(
      teacherAlertStyle('FUTURE_NEAR').background,
      const Color(0xFFF1F5F9),
    );
  });
  testWidgets(
    'saving disables repeated submissions and waits for authoritative success',
    (tester) async {
      final response = Completer<http.Response>();
      var posts = 0, completed = 0;
      final api = ApiClient(
        client: MockClient((r) async {
          posts++;
          return response.future;
        }),
      );
      api.token = 'synthetic';
      final session = BackendSession(api: api, store: MemoryTokenStore());
      session.user = {'id': 'teacher', 'centerId': 'center', 'role': 'TEACHER'};
      final previous = BackendSession.replaceForTesting(session);
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        BackendSession.replaceForTesting(previous);
        api.close();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TeacherAlertCard(
              alert: {
                ...saved('pending', 'A', 1),
                'canCheck': true,
                'reviewToken': 'review',
              },
              onChecked: () {
                completed++;
              },
            ),
          ),
        ),
      );
      await tester.tap(find.text('Mark as Checked'));
      await tester.pump();
      expect(find.text('Saving…'), findsOneWidget);
      expect(find.text('Checked by you'), findsNothing);
      await tester.tap(find.text('Saving…'));
      await tester.pump();
      expect(posts, 1);
      response.complete(
        BackendFixture.data({
          'checkedByMe': true,
          'checkedAt': '2026-10-27T06:00:00Z',
        }),
      );
      await tester.pumpAndSettle();
      expect(completed, 1);
      expect(find.text('Checked by you'), findsOneWidget);
      expect(find.text('Mark as Checked'), findsNothing);
    },
  );
  for (final width in [320.0, 390.0]) {
    testWidgets('checkable danger cards remain usable at ${width.toInt()}px', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final f = CheckFixture(tester);
      f.records.first['child'] = {
        'id': 'A',
        'name': 'A long recorded child name that needs to wrap',
      };
      await mountHome(tester);
      expect(tester.takeException(), isNull);
      await tapVisible(tester, checkButton(childCard('A')));
      expect(childCard('A'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
