import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:final_project/core/backend.dart';
import 'package:final_project/core/widgets/teacher_alert_watch.dart';

import 'support/backend_fixture.dart';

void main() {
  testWidgets(
    'different configured zones notify independently without relabelling them as Gate',
    (tester) async {
      final f = useBackend(tester, role: 'TEACHER');
      f.alerts.clear();
      await tester.pumpWidget(
        MaterialApp(
          home: TeacherAlertWatch(
            onOpen: () {},
            child: const Scaffold(body: Text('Teacher Home')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      for (final zone in ['Fixture Gate', 'Fixture Zone A', 'Fixture Zone B']) {
        f.alerts.add({
          'id': zone,
          'kind': 'DANGER_ZONE_NEAR',
          'createdAt': '2026-10-29T06:00:00Z',
          'child': {'name': 'Fixture Student'},
          'event': {
            'device': {'hardwareId': 'Fixture wearable'},
            'beacon': {'name': zone, 'location': 'Configured area'},
          },
        });
        await tester.pump(const Duration(seconds: 3));
        await tester.pumpAndSettle();
        expect(find.textContaining(zone), findsOneWidget);
        expect(find.textContaining('Fixture wearable'), findsOneWidget);
        expect(find.text('Teacher Home'), findsOneWidget);
        await tester.pump(const Duration(seconds: 12));
        await tester.pumpAndSettle();
      }
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsOneWidget);
    },
  );
  test('Teacher stream uses JWT header and existing SSE parser without putting credentials in URL', () async {
    final api = ApiClient(
      client: MockClient((request) async {
        expect(request.url.path, '/api/v1/mobile/alerts/stream');
        expect(request.url.hasQuery, false);
        expect(
          request.headers['Authorization'],
          'Bearer synthetic-teacher-token',
        );
        return http.Response(
          'event: update\ndata: {"id":"notification","topics":["alerts"],"alertIds":["recorded-alert"]}\n\n',
          200,
          headers: {'content-type': 'text/event-stream'},
        );
      }),
    );
    api.token = 'synthetic-teacher-token';
    try {
      expect((await api.teacherUpdates().first)['alertIds'], [
        'recorded-alert',
      ]);
    } finally {
      api.close();
    }
  });
  testWidgets(
    'Teacher foreground polling fallback shows one persisted new zone alert with navigation',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER');
      fixture.alerts.clear();
      var opened = false;
      await tester.pumpWidget(
        MaterialApp(
          home: TeacherAlertWatch(
            onOpen: () {
              opened = true;
            },
            child: const Scaffold(body: Text('Existing Teacher dashboard')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Recorded danger-zone alert'), findsNothing);
      fixture.alerts.add({
        'id': 'recorded-zone-alert',
        'kind': 'DANGER_ZONE_NEAR',
        'createdAt': '2026-10-26T12:00:00Z',
        'child': {'name': 'Fixture Student B'},
        'event': {
          'device': {'hardwareId': 'Fixture wearable'},
          'beacon': {'name': 'Fixture danger zone', 'location': 'Fixture area'},
        },
      });
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.textContaining('Fixture Student B'), findsOneWidget);
      expect(find.textContaining('Fixture danger zone'), findsOneWidget);
      await tester.tap(find.text('View alerts'));
      await tester.pumpAndSettle();
      expect(opened, true);
      await tester.pump(const Duration(seconds: 12));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.textContaining('Recorded danger-zone alert'), findsNothing);
    },
  );
  testWidgets('signal loss is not turned into a danger entry notification', (
    tester,
  ) async {
    final fixture = useBackend(tester, role: 'TEACHER');
    fixture.alerts.clear();
    await tester.pumpWidget(
      MaterialApp(
        home: TeacherAlertWatch(
          onOpen: () {},
          child: const Scaffold(body: Text('Teacher')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    fixture.alerts.add({'id': 'diagnostic', 'kind': 'BEACON_SIGNAL_LOST'});
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.textContaining('Recorded danger-zone alert'), findsNothing);
  });
  testWidgets(
    'checked history does not produce a fresh notice but a later unchecked event still does',
    (tester) async {
      final f = useBackend(tester, role: 'TEACHER');
      f.alerts.clear();
      await tester.pumpWidget(
        MaterialApp(
          home: TeacherAlertWatch(
            onOpen: () {},
            child: const Scaffold(body: Text('Teacher')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      f.alerts.add({
        'id': 'already-reviewed',
        'kind': 'DANGER_ZONE_NEAR',
        'checkedByMe': true,
        'child': {'name': 'Recorded Child'},
      });
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.textContaining('Recorded danger-zone alert'), findsNothing);
      f.alerts.add({
        'id': 'new-incident',
        'kind': 'DANGER_ZONE_NEAR',
        'checkedByMe': false,
        'child': {'name': 'Recorded Child'},
        'createdAt': '2026-10-27T06:00:00Z',
      });
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.textContaining('Recorded danger-zone alert'), findsOneWidget);
    },
  );
}
