import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:final_project/screens/attendance/attendance_record_screen.dart';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/backend_panels.dart';

import 'support/backend_fixture.dart';

void main() {
  for (final correct in [false, true]) {
    testWidgets(
      correct
          ? 'Correct Absence returns to Not Checked In Yet'
          : 'Mark Absent waits for confirmation and authoritative save',
      (tester) async {
        final fixture = useBackend(tester, role: 'TEACHER');
        final row = <String, dynamic>{
          'id': 'attendance-fixture',
          'attendanceId': 'attendance-fixture',
          'child': {'id': 'child-fixture', 'name': 'Fixture Child'},
          'day': '2026-10-27',
          'status': correct ? 'ABSENT' : 'NOT_CHECKED_IN',
          'attendanceEpoch': 'epoch-current',
          'canMarkAbsent': !correct,
          'canCorrectAbsence': correct,
          'absenceId': 'absence-current',
          'absenceHistory': [
            {'id': 'absence-current', 'type': 'ABSENT'},
          ],
        };
        fixture.respond = (r) {
          if (r.url.path == '/api/v1/attendance/roster') {
            return BackendFixture.data([row]);
          }
          if (r.method == 'POST') {
            row['status'] = correct ? 'NOT_CHECKED_IN' : 'ABSENT';
            row['canMarkAbsent'] = false;
            row['canCorrectAbsence'] = false;
            return BackendFixture.data({'status': row['status']});
          }
          return null;
        };
        await tester.pumpWidget(
          const MaterialApp(home: Scaffold(body: PendingAttendancePanel())),
        );
        await tester.pumpAndSettle();
        final label = correct ? 'Correct Absence' : 'Mark Absent';
        await tapVisible(tester, find.widgetWithText(FilledButton, label));
        expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
        await tapVisible(tester, find.widgetWithText(TextButton, 'Cancel'));
        expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
        await tapVisible(tester, find.widgetWithText(FilledButton, label));
        await tapVisible(tester, find.widgetWithText(FilledButton, label).last);
        final sent = fixture.requests.singleWhere((r) => r.method == 'POST');
        expect(
          sent.url.path,
          correct
              ? '/api/v1/attendance/attendance-fixture/absence/correct'
              : '/api/v1/attendance/absence',
        );
        final body = jsonDecode(sent.body) as Map;
        expect(body['confirmed'], true);
        expect(body['day'], '2026-10-27');
        expect(body.containsKey('role'), false);
        expect(body.containsKey('centerId'), false);
        if (correct) {
          expect(body['absenceId'], 'absence-current');
          expect(find.textContaining('Absence corrected.'), findsOneWidget);
        } else {
          expect(body['expectedStatus'], 'NOT_CHECKED_IN');
          expect(body['attendanceEpoch'], 'epoch-current');
          expect(
            find.text('Fixture Child has been marked absent.'),
            findsOneWidget,
          );
        }
      },
    );
  }
  test(
    'Absent is distinct from missing attendance and pending confirmation',
    () {
      expect(attendanceLabel('ABSENT'), 'Absent');
      expect(attendanceLabel('NO_RECORD'), 'No Attendance Recorded');
      expect(attendanceLabel('CHECKIN_PENDING'), 'Waiting for Confirmation');
    },
  );
  testWidgets('Parent reads Absent without a Teacher mutation action', (
    tester,
  ) async {
    final fixture = useBackend(tester, role: 'PARENT');
    fixture.attendance['status'] = 'ABSENT';
    await tester.pumpWidget(const MaterialApp(home: AttendanceRecordScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('Absent'), findsOneWidget);
    expect(find.text('A Teacher recorded this absence.'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Mark Absent'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Correct Absence'), findsNothing);
    expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
  });
  testWidgets('failed absence does not claim success', (tester) async {
    final fixture = useBackend(tester, role: 'TEACHER');
    fixture.respond = (r) {
      if (r.url.path == '/api/v1/attendance/roster') {
        return BackendFixture.data([
          {
            'id': 'a',
            'attendanceId': null,
            'child': {'id': 'child', 'name': 'Fixture Child'},
            'day': '2026-10-27',
            'status': 'NO_RECORD',
            'canMarkAbsent': true,
          },
        ]);
      }
      if (r.method == 'POST') {
        return http.Response(
          jsonEncode({
            'error': {
              'code': 'ATTENDANCE_CYCLE_CHANGED',
              'message': 'Attendance changed. Refresh before marking absence',
            },
          }),
          409,
          headers: {'content-type': 'application/json'},
        );
      }
      return null;
    };
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: PendingAttendancePanel())),
    );
    await tester.pumpAndSettle();
    await tapVisible(tester, find.widgetWithText(FilledButton, 'Mark Absent'));
    await tapVisible(
      tester,
      find.widgetWithText(FilledButton, 'Mark Absent').last,
    );
    expect(
      find.text('Attendance changed. Refresh before marking absence'),
      findsOneWidget,
    );
    expect(find.text('Fixture Child has been marked absent.'), findsNothing);
    expect(fixture.requests.where((r) => r.method == 'POST'), hasLength(1));
  });
}
