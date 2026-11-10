import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/app_colors.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/screens/attendance/attendance_record_screen.dart';

import 'support/backend_fixture.dart';

const _listKey = ValueKey('teacher-attendance-student-list');
Finder student(String name) =>
    find.descendant(of: find.byKey(_listKey), matching: find.text(name));
Finder get absentPill => find.byKey(const ValueKey('attendance-filter-Absent'));

class AttendanceFixture {
  final BackendFixture backend;
  final List<Map<String, dynamic>> children = [];
  final List<Map<String, dynamic>> records = [];
  List<Map<String, dynamic>> actions = [];
  bool unavailable = false;
  AttendanceFixture(WidgetTester tester)
    : backend = useBackend(tester, role: 'TEACHER') {
    for (final status in [
      'ABSENT',
      'NOT_CHECKED_IN',
      'NO_RECORD',
      'CHECKIN_PENDING',
      'PRESENT',
      'CHECKED_OUT',
    ]) {
      final name = status == 'ABSENT' ? 'Demo Child One' : 'Child $status';
      final child = <String, dynamic>{'id': 'child-$status', 'name': name};
      children.add(child);
      if (status != 'NO_RECORD') {
        records.add({
          'id': 'attendance-$status',
          'attendanceId': 'attendance-$status',
          'childId': child['id'],
          'child': child,
          'day': '2026-10-27',
          'status': status,
          'canConfirm': false,
          'canCheckout': false,
          'canMarkAbsent': false,
          'canCorrectAbsence': false,
          'confirmations': [],
        });
      }
    }
    children.add({'id': 'absent-second', 'name': 'Demo Child Two'});
    records.add({
      'id': 'absence-second',
      'childId': 'absent-second',
      'day': '2026-10-27',
      'status': 'ABSENT',
    });
    backend.children
      ..clear()
      ..addAll(children);
    backend.respond = (request) {
      final offset = int.parse(request.url.queryParameters['offset'] ?? '0');
      if (request.url.path == '/api/v1/mobile/children') {
        return BackendFixture.data(children.skip(offset).take(100).toList());
      }
      if (request.url.path == '/api/v1/attendance') {
        return unavailable
            ? BackendFixture.error(503, 'Attendance is unavailable. Try again.')
            : BackendFixture.data(records.skip(offset).take(100).toList());
      }
      if (request.url.path == '/api/v1/attendance/roster') {
        return BackendFixture.data(actions);
      }
      if (request.url.path.endsWith('/absence/correct') &&
          request.method == 'POST') {
        final saved = records.first;
        saved['status'] = 'NOT_CHECKED_IN';
        saved['canCorrectAbsence'] = false;
        return BackendFixture.data({'status': 'NOT_CHECKED_IN'});
      }
      return null;
    };
  }
}

Future<void> mount(WidgetTester tester) async {
  await tester.pumpWidget(
    const MaterialApp(home: AttendanceRecordScreen(isTeacherView: true)),
  );
  await tester.pumpAndSettle();
}

bool selected(WidgetTester tester, String title) {
  final box = find
      .descendant(
        of: find.byKey(ValueKey('attendance-filter-$title')),
        matching: find.byType(Container),
      )
      .first;
  return (tester.widget<Container>(box).decoration as BoxDecoration).color ==
      AppColors.primaryBlue;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    // Use Android's real default font for text-fit assertions, not test-only Ahem.
    final config = File('.dart_tool/package_config.json').absolute;
    final packages =
        (jsonDecode(config.readAsStringSync()) as Map)['packages'] as List;
    final flutter = packages.firstWhere((p) => p['name'] == 'flutter') as Map;
    final sdk = Directory.fromUri(
      config.uri.resolve(flutter['rootUri'] as String),
    ).parent.parent;
    final fonts = FontLoader('Roboto');
    for (final face in ['regular', 'medium', 'bold']) {
      final file = File(
        '${sdk.path}/bin/cache/artifacts/material_fonts/roboto-$face.ttf',
      );
      fonts.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await fonts.load();
  });
  testWidgets(
    'Absent uses selected pill style and excludes every other stored/missing state',
    (tester) async {
      AttendanceFixture(tester);
      await mount(tester);
      expect(find.text('All Students'), findsOneWidget);
      expect(find.text('Present'), findsWidgets);
      expect(find.text('Pending'), findsOneWidget);
      expect(absentPill, findsOneWidget);
      await tapVisible(tester, absentPill);
      expect(selected(tester, 'Absent'), isTrue);
      expect(selected(tester, 'All Students'), isFalse);
      expect(student('Demo Child One'), findsOneWidget);
      expect(student('Demo Child Two'), findsOneWidget);
      for (final state in [
        'NOT_CHECKED_IN',
        'NO_RECORD',
        'CHECKIN_PENDING',
        'PRESENT',
        'CHECKED_OUT',
      ]) {
        expect(student('Child $state'), findsNothing);
      }
      final labels = find.descendant(
        of: find.byKey(_listKey),
        matching: find.text('Absent'),
      );
      expect(labels, findsNWidgets(2));
      await tapVisible(tester, find.text('All Students'));
      expect(selected(tester, 'All Students'), isTrue);
      expect(student('Child CHECKED_OUT'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(_listKey),
          matching: find.text('Checked Out'),
        ),
        findsOneWidget,
      );
    },
  );
  testWidgets('Present and Pending retain their exact attendance states', (
    tester,
  ) async {
    AttendanceFixture(tester);
    await mount(tester);
    await tapVisible(
      tester,
      find.byKey(const ValueKey('attendance-filter-Present')),
    );
    expect(student('Child PRESENT'), findsOneWidget);
    expect(student('Demo Child One'), findsNothing);
    await tapVisible(
      tester,
      find.byKey(const ValueKey('attendance-filter-Pending')),
    );
    expect(student('Child CHECKIN_PENDING'), findsOneWidget);
    expect(student('Child PRESENT'), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(_listKey),
        matching: find.text('Waiting for Confirmation'),
      ),
      findsOneWidget,
    );
  });
  testWidgets(
    'case-insensitive search combines with Absent and clearing restores absent results',
    (tester) async {
      AttendanceFixture(tester);
      await mount(tester);
      await tapVisible(tester, absentPill);
      await tester.enterText(find.byType(TextField), 'DEMO CHILD ONE');
      await tester.pumpAndSettle();
      expect(student('Demo Child One'), findsOneWidget);
      expect(student('Demo Child Two'), findsNothing);
      await tester.enterText(find.byType(TextField), 'no matching name');
      await tester.pumpAndSettle();
      expect(find.text('No matching absent children found.'), findsOneWidget);
      await tester.enterText(find.byType(TextField), '');
      await tester.pumpAndSettle();
      expect(student('Demo Child Two'), findsOneWidget);
      expect(selected(tester, 'Absent'), isTrue);
      await tapVisible(tester, find.text('All Students'));
      await tester.enterText(find.byType(TextField), 'checked_out');
      await tester.pumpAndSettle();
      expect(student('Child CHECKED_OUT'), findsOneWidget);
      expect(student('Demo Child One'), findsNothing);
    },
  );
  testWidgets(
    'successful Correct Absence refreshes the lower list and keeps Absent selected',
    (tester) async {
      final fixture = AttendanceFixture(tester);
      fixture.actions = [fixture.records.first];
      fixture.actions.first.addAll({
        'canCorrectAbsence': true,
        'absenceId': 'absence-current',
      });
      await mount(tester);
      await tapVisible(tester, absentPill);
      expect(student('Demo Child One'), findsOneWidget);
      // Filters apply to the student list, not the separate lower Teacher actions.
      expect(find.text("Today's Attendance Actions"), findsOneWidget);
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Correct Absence'),
      );
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Correct Absence').last,
      );
      expect(student('Demo Child One'), findsNothing);
      expect(student('Demo Child Two'), findsOneWidget);
      expect(selected(tester, 'Absent'), isTrue);
      final post = fixture.backend.requests.singleWhere(
        (r) => r.method == 'POST',
      );
      expect(jsonDecode(post.body)['absenceId'], 'absence-current');
      await tapVisible(tester, find.text('All Students'));
      expect(student('Demo Child One'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(_listKey),
          matching: find.text('Not Checked In Yet'),
        ),
        findsNWidgets(2),
      );
    },
  );
  testWidgets(
    'empty absence, backend errors and refreshed absence are distinct',
    (tester) async {
      final fixture = AttendanceFixture(tester);
      fixture.records.removeWhere((r) => r['status'] == 'ABSENT');
      await mount(tester);
      await tapVisible(tester, absentPill);
      expect(
        find.text('No children have been marked absent today.'),
        findsOneWidget,
      );
      fixture.unavailable = true;
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(
        find.text('Updates unavailable. Showing last received information.'),
        findsOneWidget,
      );
      expect(
        find.text('No children have been marked absent today.'),
        findsOneWidget,
      );
      fixture.unavailable = false;
      fixture.records.add({
        'id': 'new-absence',
        'childId': 'child-ABSENT',
        'day': '2026-10-27',
        'status': 'ABSENT',
      });
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(student('Demo Child One'), findsOneWidget);
      expect(selected(tester, 'Absent'), isTrue);
    },
  );
  testWidgets(
    'loads subsequent children and attendance pages before filtering',
    (tester) async {
      final fixture = AttendanceFixture(tester);
      fixture.children.clear();
      fixture.records.clear();
      for (var i = 0; i < 101; i++) {
        fixture.children.add({
          'id': 'child-$i',
          'name': i == 100 ? 'Last page absent child' : 'Child $i',
        });
        fixture.records.add({
          'id': 'record-$i',
          'childId': 'child-$i',
          'day': '2026-10-27',
          'status': i == 100 ? 'ABSENT' : 'PRESENT',
        });
      }
      await mount(tester);
      await tapVisible(tester, absentPill);
      expect(student('Last page absent child'), findsOneWidget);
      expect(student('Child 0'), findsNothing);
      for (final path in ['/api/v1/mobile/children', '/api/v1/attendance']) {
        expect(
          fixture.backend.requests.any(
            (r) =>
                r.url.path == path && r.url.queryParameters['offset'] == '100',
          ),
          isTrue,
        );
      }
    },
  );
  testWidgets(
    'Absent child details preserve identity and returning keeps the filter',
    (tester) async {
      final fixture = AttendanceFixture(tester);
      await mount(tester);
      await tapVisible(tester, absentPill);
      await tapVisible(tester, student('Demo Child One'));
      expect(find.widgetWithText(AppBar, 'Demo Child One'), findsOneWidget);
      expect(
        fixture.backend.requests.any(
          (r) =>
              r.url.path == '/api/v1/mobile/children/child-ABSENT/attendance',
        ),
        isTrue,
      );
      await tapVisible(tester, find.byTooltip('Back'));
      expect(selected(tester, 'Absent'), isTrue);
      expect(student('Demo Child One'), findsOneWidget);
      expect(student('Child PRESENT'), findsNothing);
    },
  );
  test('unknown attendance statuses retain the existing readable fallback', () {
    expect(attendanceLabel('FUTURE_STATUS'), 'FUTURE_STATUS');
  });
  for (final width in [320.0, 390.0]) {
    testWidgets(
      'all four filters share one row with unclipped text at ${width.toInt()}px',
      (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        AttendanceFixture(tester);
        await mount(tester);
        const titles = ['All Students', 'Present', 'Pending', 'Absent'];
        // Check all four selected font weights, not just the initially selected pill.
        for (final active in titles) {
          await tapVisible(
            tester,
            find.byKey(ValueKey('attendance-filter-$active')),
          );
          final rects = titles
              .map(
                (title) => tester.getRect(
                  find.byKey(ValueKey('attendance-filter-$title')),
                ),
              )
              .toList();
          for (var i = 0; i < titles.length; i++) {
            expect(rects[i].top, closeTo(rects.first.top, 0.01));
            expect(rects[i].bottom, closeTo(rects.first.bottom, 0.01));
            expect(rects[i].left, greaterThanOrEqualTo(0));
            expect(rects[i].right, lessThanOrEqualTo(width));
            if (i > 0) {
              expect(rects[i].left - rects[i - 1].right, closeTo(6, 0.01));
            }
            final text = find.descendant(
              of: find.byKey(ValueKey('attendance-filter-${titles[i]}')),
              matching: find.text(titles[i]),
            );
            final paragraph = tester.renderObject<RenderParagraph>(text);
            expect(paragraph.didExceedMaxLines, isFalse);
            expect(
              paragraph.getMaxIntrinsicWidth(double.infinity),
              lessThanOrEqualTo(paragraph.size.width + 0.01),
            );
            expect(tester.widget<Text>(text).style!.fontSize, 13);
            expect(selected(tester, titles[i]), titles[i] == active);
          }
          expect(rects.first.width, greaterThan(rects[1].width));
          expect(rects.last.left, greaterThan(rects[2].right));
          expect(tester.takeException(), isNull);
        }
      },
    );
  }
}
