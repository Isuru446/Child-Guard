import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:final_project/core/backend.dart';
import 'package:final_project/core/widgets/teacher_alert_watch.dart';
import 'package:final_project/core/widgets/attendance_confirmation.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/core/widgets/parent_danger_notifications.dart';
import 'package:final_project/core/widgets/parent_routine_notifications.dart';
import 'package:final_project/screens/home/home_screen.dart';

import 'support/backend_fixture.dart';

const confirmation = {
  'method': 'RFID_CARD',
  'confirmedAt': '2026-10-28T03:00:00Z',
  'user': null,
  'reader': {'hardwareId': 'SYNTHETIC-RFID'},
};
Map<String, dynamic> routine() => {
  'id': 'saved-rfid-scan',
  'kind': 'ATTENDANCE_CONFIRMED_RFID',
  'createdAt': '2026-10-28T03:00:00Z',
  'child': {'id': BackendFixture.childId, 'name': 'Synthetic Child'},
};
void main() {
  testWidgets(
    'Teacher attendance SSE invalidates the roster without a danger alert',
    (tester) async {
      final api = ApiClient(
        client: MockClient((request) async {
          return request.url.path.endsWith('/stream')
              ? http.Response(
                  'event: resync\ndata: {"topics":["alerts","attendance","pickups"],"alertIds":[]}\n\n',
                  200,
                  headers: {'content-type': 'text/event-stream'},
                )
              : http.Response(
                  '{"data":[]}',
                  200,
                  headers: {'content-type': 'application/json'},
                );
        }),
      );
      api.token = 'synthetic-rfid-teacher-token';
      final session = BackendSession(api: api, store: MemoryTokenStore());
      session.user = {
        'id': 'synthetic-teacher',
        'role': 'TEACHER',
        'centerId': 'synthetic-center',
      };
      final previous = BackendSession.replaceForTesting(session);
      backendTab.value = 0;
      final before = backendRefresh.value;
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: TeacherAlertWatch(
              onOpen: () {},
              child: const Scaffold(body: Text('Teacher attendance')),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(backendRefresh.value, greaterThan(before));
        expect(find.byType(SnackBar), findsNothing);
      } finally {
        await tester.pumpWidget(const SizedBox());
        BackendSession.replaceForTesting(previous);
        api.close();
      }
    },
  );
  test(
    'confirmation text attributes RFID and real recorded time, never a Teacher',
    () {
      expect(
        attendanceConfirmationText(confirmation),
        'Confirmed by RFID card: 2026-10-28 08:30 (Sri Lanka)',
      );
    },
  );
  testWidgets(
    'Parent Home shows one RFID routine notification, never a danger, and keeps Activity',
    (tester) async {
      final f = useBackend(tester);
      f.alerts.clear();
      f.respond = (request) => request.url.path.endsWith('/updates')
          ? BackendFixture.data([routine(), routine()])
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Attendance confirmed'), findsOneWidget);
      expect(
        find.text(
          'Synthetic Child was marked present using their registered RFID card.',
        ),
        findsOneWidget,
      );
      expect(find.byType(ParentRoutineCard), findsOneWidget);
      expect(find.text('No danger alerts recorded.'), findsOneWidget);
      expect(find.text('Activity'), findsOneWidget);
    },
  );
  testWidgets('Parent attendance reads RFID source with nullable staff user', (
    tester,
  ) async {
    final f = useBackend(tester);
    f.attendance['status'] = 'PRESENT';
    f.attendance['confirmations'] = [confirmation];
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(child: ChildPanel(section: 'attendance')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Confirmed by RFID card:'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'Teacher pending action disappears after authoritative RFID PRESENT refresh',
    (tester) async {
      final f = useBackend(tester, role: 'TEACHER');
      bool present = false;
      f.respond = (request) => request.url.path == '/api/v1/attendance/roster'
          ? BackendFixture.data([
              {
                'id': 'att-a',
                'attendanceId': 'att-a',
                'day': '2026-10-28',
                'child': {
                  'id': BackendFixture.childId,
                  'name': 'Synthetic Child',
                },
                'status': present ? 'PRESENT' : 'CHECKIN_PENDING',
                'canConfirm': !present,
                'confirmations': present ? [confirmation] : [],
              },
            ])
          : null;
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: PendingAttendancePanel()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.widgetWithText(FilledButton, 'Confirm'), findsOneWidget);
      present = true;
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.widgetWithText(FilledButton, 'Confirm'), findsNothing);
      expect(find.textContaining('Confirmed by RFID card:'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('RFID routine records cannot enter the danger preview', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ParentDangerNotifications(alerts: [routine()], onRetry: () {}),
        ),
      ),
    );
    expect(find.text('No danger alerts recorded.'), findsOneWidget);
    expect(find.text('Attendance confirmed'), findsNothing);
  });
}
