import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/parent_danger_notifications.dart';
import 'package:final_project/core/widgets/teacher_alert_card.dart';
import 'package:final_project/core/widgets/tamper_status.dart';
import 'package:final_project/screens/home/home_screen.dart';

import 'support/backend_fixture.dart';

Map<String, dynamic> tamper(String id) => {
  'id': id,
  'kind': 'TAMPER_LOOP_OPEN',
  'state': 'RECORDED',
  'createdAt': '2026-10-28T05:00:00Z',
  'child': {'id': BackendFixture.childId, 'name': 'Recorded Child'},
  'event': {
    'device': {'hardwareId': 'SYNTHETIC-BELT'},
    'observedAt': '2026-10-28T04:59:00Z',
  },
};
void main() {
  testWidgets(
    'Parent Home shows one latest tamper in Danger Notifications and preserves Activity action',
    (tester) async {
      final f = useBackend(tester);
      f.alerts
        ..clear()
        ..addAll([tamper('one'), tamper('two')]);
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Danger Notifications'), findsOneWidget);
      expect(find.text('Wearable tamper detected'), findsOneWidget);
      expect(find.byType(TeacherAlertCard), findsOneWidget);
      expect(find.text('Activity'), findsOneWidget);
      expect(
        find.textContaining('tamper loop was disconnected'),
        findsOneWidget,
      );
    },
  );
  testWidgets('restoration does not enter the danger preview', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ParentDangerNotifications(
            alerts: [
              {'id': 'restore', 'kind': 'TAMPER_LOOP_RESTORED'},
            ],
            onRetry: () {},
          ),
        ),
      ),
    );
    expect(find.text('No danger alerts recorded.'), findsOneWidget);
  });
  testWidgets('Teacher card shows tamper wording, wearable and recorded time', (
    tester,
  ) async {
    useBackend(tester, role: 'TEACHER');
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: TeacherAlertCard(alert: tamper('one'))),
      ),
    );
    expect(find.text('Wearable tamper detected'), findsOneWidget);
    expect(find.text('Wearable: SYNTHETIC-BELT'), findsOneWidget);
    expect(
      find.textContaining('Reconnection does not dismiss this alert.'),
      findsOneWidget,
    );
    expect(teacherAlertStyle('TAMPER_LOOP_OPEN').ink, const Color(0xFFB42323));
  });
  test('tamper status expires and preserves only a last-known label', () {
    final now = DateTime.utc(2026, 10, 28, 10);
    final device = {
      'tamper': {
        'state': 'CLOSED',
        'lastKnownState': 'CLOSED',
        'stale': false,
        'observedAt': now.toIso8601String(),
      },
    };
    expect(tamperStatusText(device, now: now), 'Tamper loop: Connected');
    expect(
      tamperStatusText(device, now: now.add(const Duration(seconds: 61))),
      'Tamper loop: Unavailable (last known: Connected)',
    );
    expect(tamperStatusText(null), 'Tamper loop: Unavailable');
  });
}
