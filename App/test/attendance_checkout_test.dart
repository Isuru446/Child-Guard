import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/backend_panels.dart';

import 'support/backend_fixture.dart';

void main() {
  testWidgets(
    'Teacher checkout requires explicit departure confirmation and the current confirmation version',
    (tester) async {
      final fixture = useBackend(tester, role: 'TEACHER');
      final row = <String, dynamic>{
        'id': 'attendance-fixture',
        'child': {'name': 'Fixture Child'},
        'day': '2026-10-27',
        'status': 'PRESENT',
        'canConfirm': false,
        'canCheckout': true,
        'attendanceEpoch': 'epoch-current',
        'confirmations': [
          {'confirmedAt': '2026-10-27T03:00:00.000Z'},
        ],
      };
      fixture.respond = (r) {
        if (r.url.path == '/api/v1/attendance/roster') {
          return BackendFixture.data([row]);
        }
        if (r.url.path.endsWith('/checkout')) {
          row['status'] = 'CHECKED_OUT';
          row['canCheckout'] = false;
          return BackendFixture.data({'status': 'CHECKED_OUT'});
        }
        return null;
      };
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: PendingAttendancePanel())),
      );
      await tester.pumpAndSettle();
      await tapVisible(tester, find.widgetWithText(FilledButton, 'Check Out'));
      expect(
        find.textContaining('does not verify a pickup person'),
        findsOneWidget,
      );
      expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
      await tapVisible(tester, find.widgetWithText(TextButton, 'Cancel'));
      expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
      await tapVisible(tester, find.widgetWithText(FilledButton, 'Check Out'));
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Check Out').last,
      );
      final sent = fixture.requests.singleWhere((r) => r.method == 'POST');
      expect(sent.url.path, '/api/v1/attendance/attendance-fixture/checkout');
      expect(jsonDecode(sent.body), {
        'confirmedAt': '2026-10-27T03:00:00.000Z',
        'departureConfirmed': true,
        'attendanceEpoch': 'epoch-current',
      });
      expect(find.text('Child checked out.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Check Out'), findsNothing);
    },
  );
  testWidgets('pending attendance does not expose checkout', (tester) async {
    final fixture = useBackend(tester, role: 'TEACHER');
    fixture.respond = (r) => r.url.path == '/api/v1/attendance/roster'
        ? BackendFixture.data([
            {
              'id': 'pending',
              'child': {'name': 'Fixture Child'},
              'day': '2026-10-27',
              'status': 'CHECKIN_PENDING',
              'canConfirm': false,
              'canCheckout': false,
            },
          ])
        : null;
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: PendingAttendancePanel())),
    );
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Check Out'), findsNothing);
    expect(fixture.requests.where((r) => r.method == 'POST'), isEmpty);
  });
}
