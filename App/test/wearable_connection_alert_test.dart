import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/core/widgets/teacher_alert_card.dart';
import 'package:final_project/core/widgets/teacher_alert_watch.dart';
import 'package:final_project/screens/home/teacher_home_dashboard.dart';

import 'support/backend_fixture.dart';

Map<String, dynamic> warning(String id) => {
  'id': id,
  'kind': 'WEARABLE_CONNECTION_LOST',
  'state': 'RECORDED',
  'createdAt': '2026-10-27T05:02:00Z',
  'child': {'id': 'actual-child', 'name': 'Recorded Child'},
  'event': {
    'device': {'hardwareId': 'ORIGINAL-WEARABLE'},
  },
  'connection': {
    'lastCommunicationAt': '2026-10-27T05:00:00Z',
    'detectedAt': '2026-10-27T05:02:00Z',
  },
  'canCheck': true,
  'reviewToken': 'synthetic-review',
  'checkedByMe': false,
};

void main() {
  test('connection warnings are amber and never enter Home danger groups', () {
    expect(
      teacherAlertStyle('WEARABLE_CONNECTION_LOST').background,
      const Color(0xFFFFF7E6),
    );
    expect(
      teacherAlertStyle('DANGER_ZONE_NEAR').background,
      const Color(0xFFFFF1F1),
    );
    expect(teacherHomeDangerAlerts([warning('warning')]), isEmpty);
    expect(
      teacherHomeDangerAlerts([
        {'id': 'ble', 'kind': 'BEACON_SIGNAL_LOST'},
      ]),
      isEmpty,
    );
  });
  testWidgets(
    'Teacher sees real connection details, checks only that incident and retains history',
    (tester) async {
      final f = useBackend(tester, role: 'TEACHER');
      final checked = <String>{};
      final rows = [warning('older'), warning('newer')];
      f.respond = (request) {
        if (request.method == 'POST' && request.url.path.endsWith('/check')) {
          expect(
            (jsonDecode(request.body) as Map)['reviewToken'],
            'synthetic-review',
          );
          final id = request.url.path.split('/').reversed.elementAt(1);
          checked.add(id);
          return BackendFixture.data({
            'checkedByMe': true,
            'checkedAt': '2026-10-27T05:03:00Z',
          });
        }
        if (request.url.path == '/api/v1/mobile/alerts') {
          return BackendFixture.data(
            rows
                .map(
                  (r) => {
                    ...r,
                    'checkedByMe': checked.contains(r['id']),
                    'canCheck': !checked.contains(r['id']),
                    'checkedAt': checked.contains(r['id'])
                        ? '2026-10-27T05:03:00Z'
                        : null,
                  },
                )
                .toList(),
          );
        }
        return null;
      };
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: TeacherAlertsPanel()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Wearable Connection Lost'), findsNWidgets(2));
      expect(find.text('Child: Recorded Child'), findsNWidgets(2));
      expect(find.text('Wearable: ORIGINAL-WEARABLE'), findsNWidgets(2));
      expect(
        find.text('Last communication: 2026-10-27 10:30 (Sri Lanka)'),
        findsNWidgets(2),
      );
      expect(
        find.text('Connection warning recorded: 2026-10-27 10:32 (Sri Lanka)'),
        findsNWidgets(2),
      );
      expect(find.textContaining('Wi-Fi disconnected'), findsNothing);
      expect(find.textContaining('Beacon:'), findsNothing);
      await tapVisible(tester, find.text('Mark as Checked').first);
      expect(checked, {'older'});
      expect(find.text('Checked by you'), findsOneWidget);
      expect(find.text('New'), findsOneWidget);
      expect(find.byType(TeacherAlertCard), findsNWidgets(2));
      expect(rows, hasLength(2));
    },
  );
  testWidgets('Parent card is read-only with honest missing-value fallbacks', (
    tester,
  ) async {
    final f = useBackend(tester, role: 'PARENT');
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: TeacherAlertCard(
            alert: {
              'id': 'missing',
              'kind': 'WEARABLE_CONNECTION_LOST',
              'canCheck': true,
              'reviewToken': 'unusable',
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Child: Child not available'), findsOneWidget);
    expect(find.text('Wearable: Wearable not available'), findsOneWidget);
    expect(find.text('Last communication: Time not available'), findsOneWidget);
    expect(find.text('Mark as Checked'), findsNothing);
    expect(f.requests.where((r) => r.method == 'POST'), isEmpty);
  });
  testWidgets(
    'existing foreground watcher shows a new connection warning and ignores BLE diagnostics',
    (tester) async {
      final f = useBackend(tester, role: 'TEACHER');
      f.alerts.clear();
      await tester.pumpWidget(
        MaterialApp(
          home: TeacherAlertWatch(
            onOpen: () {},
            child: const Scaffold(body: Text('Existing Home')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      f.alerts.add(warning('new-offline'));
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.textContaining('Wearable Connection Lost'), findsOneWidget);
      expect(find.textContaining('Recorded danger-zone alert'), findsNothing);
      expect(
        find.textContaining('Wearable has stopped communicating'),
        findsOneWidget,
      );
      expect(
        tester.widget<SnackBar>(find.byType(SnackBar)).backgroundColor,
        const Color(0xFF805500),
      );
    },
  );
  for (final width in [320.0, 390.0]) {
    testWidgets('connection details and check action fit ${width.toInt()}px', (
      tester,
    ) async {
      useBackend(tester, role: 'TEACHER');
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final row = warning('long');
      row['child']['name'] =
          'A very long legitimate child name that wraps safely';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: TeacherAlertCard(alert: row)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Mark as Checked'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
