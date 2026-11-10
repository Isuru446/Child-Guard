import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/core/widgets/parent_routine_notifications.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/alerts/alerts_screen.dart';
import 'package:final_project/screens/history/history_screen.dart';

import 'support/backend_fixture.dart';

Map<String, dynamic> update(
  String id,
  String kind, {
  String child = BackendFixture.childId,
}) => {
  'id': id,
  'kind': kind,
  'createdAt': '2026-10-28T05:00:00Z',
  'child': {
    'id': child,
    'name': child == BackendFixture.childId ? 'First Child' : 'Second Child',
  },
};
void main() {
  testWidgets('zero children has no blank selector or notification data', (
    tester,
  ) async {
    useBackend(tester).children.clear();
    await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
    await tester.pumpAndSettle();
    expect(
      find.text('No children are linked to your account yet.'),
      findsWidgets,
    );
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    expect(find.byType(ParentRoutineCard), findsNothing);
  });
  testWidgets(
    'one child has a clean name and both previews with real routine evidence',
    (tester) async {
      final f = useBackend(tester);
      f.respond = (r) => r.url.path.endsWith('/updates')
          ? BackendFixture.data([update('pending', 'CHECKIN_PENDING')])
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      expect(find.text(f.children.first['name'] as String), findsWidgets);
      expect(find.text('Danger Notifications'), findsOneWidget);
      expect(find.text('Other Notifications'), findsOneWidget);
      expect(find.text('Arrival awaiting confirmation'), findsOneWidget);
      expect(
        find.text("First Child's arrival is waiting for Teacher confirmation."),
        findsOneWidget,
      );
      expect(find.byType(ParentRoutineCard), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Danger Notifications')).dy,
        lessThan(tester.getTopLeft(find.text('Other Notifications')).dy),
      );
      expect(
        f.requests
            .where((r) => r.url.path.endsWith('/updates'))
            .every((r) => r.url.queryParameters['limit'] == '1'),
        isTrue,
      );
    },
  );
  testWidgets(
    'two children use one selector and switch all Home panels; routine View All is child scoped',
    (tester) async {
      final f = useBackend(tester);
      f.children.add({
        'id': BackendFixture.otherChildId,
        'name': 'Second Child',
      });
      f.respond = (r) => r.url.path.endsWith('/updates')
          ? BackendFixture.data([
              update(
                'update',
                'PICKUP_COMPLETED',
                child: r.url.path.contains(BackendFixture.otherChildId)
                    ? BackendFixture.otherChildId
                    : BackendFixture.childId,
              ),
            ])
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
      f.requests.clear();
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Second Child').last);
      await tester.pumpAndSettle();
      expect(
        find.text(
          "Second Child's pickup was confirmed by an authorized Teacher.",
        ),
        findsOneWidget,
      );
      expect(
        find.text(
          "First Child's pickup was confirmed by an authorized Teacher.",
        ),
        findsNothing,
      );
      for (final section in ['device', 'alerts', 'updates']) {
        expect(
          f.requests.any(
            (r) =>
                r.url.path.endsWith('/${BackendFixture.otherChildId}/$section'),
          ),
          isTrue,
          reason: section,
        );
      }
      await tapVisible(tester, find.text('View All').last);
      final screen = tester.widget<AlertsScreen>(find.byType(AlertsScreen));
      expect(screen.category, 'updates');
      expect(screen.childId, BackendFixture.otherChildId);
      expect(find.text('Page 1'), findsOneWidget);
      expect(find.text('Mark as Checked'), findsNothing);
    },
  );
  testWidgets('Activity grid card opens the currently selected child', (
    tester,
  ) async {
    final f = useBackend(tester);
    f.children.add({'id': BackendFixture.otherChildId, 'name': 'Second Child'});
    await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Second Child').last);
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Activity'));
    final screen = tester.widget<HistoryScreen>(find.byType(HistoryScreen));
    expect(screen.childId, BackendFixture.otherChildId);
    expect(find.text('Not enough data yet'), findsOneWidget);
    expect(
      f.requests.any(
        (r) => r.url.path.endsWith('/${BackendFixture.otherChildId}/activity'),
      ),
      isTrue,
    );
    expect(f.unexpectedRequests, isEmpty);
  });
  testWidgets(
    'routine failure retains the profile and Retry refreshes saved state',
    (tester) async {
      final f = useBackend(tester);
      var fail = true;
      f.respond = (r) => r.url.path.endsWith('/updates')
          ? fail
                ? BackendFixture.error(503, 'unavailable')
                : BackendFixture.data([
                    update('confirmed', 'ATTENDANCE_CONFIRMED_TEACHER'),
                  ])
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Unable to load recent updates.'), findsOneWidget);
      expect(find.text('No recent updates.'), findsNothing);
      expect(find.text("Today's attendance"), findsNothing);
      expect(find.text("FIXTURE-WEARABLE"), findsOneWidget);
      fail = false;
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.text('Attendance confirmed'), findsOneWidget);
      expect(
        find.text("First Child's attendance was confirmed."),
        findsOneWidget,
      );
    },
  );
  testWidgets('routine history keeps older pages and only Home limits to one', (
    tester,
  ) async {
    final f = useBackend(tester);
    f.respond = (r) {
      if (!r.url.path.endsWith('/updates')) return null;
      final offset = int.parse(r.url.queryParameters['offset']!);
      return BackendFixture.data(
        List.generate(
          27,
          (i) => update(
            'event-$i',
            i == 26 ? 'PICKUP_CANCELLED' : 'CHECKIN_PENDING',
          ),
        ).skip(offset).take(25).toList(),
      );
    };
    await tester.pumpWidget(
      const MaterialApp(
        home: AlertsScreen(
          childId: BackendFixture.childId,
          category: 'updates',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(ParentRoutineCard), findsNWidgets(25));
    await tapVisible(tester, find.text('Next'));
    expect(find.byType(ParentRoutineCard), findsNWidgets(2));
    expect(find.text('Pickup cancelled'), findsOneWidget);
    expect(find.text('Page 2'), findsOneWidget);
  });
  for (final width in [320.0, 390.0]) {
    testWidgets('two preview sections have no overflow at $width', (
      tester,
    ) async {
      final f = useBackend(tester);
      f.children.first['name'] =
          'A very long authorized child name which must wrap';
      f.respond = (r) => r.url.path.endsWith('/updates')
          ? BackendFixture.data([
              update('long', 'PICKUP_REQUEST_CREATED')
                ..['child']['name'] =
                    'A very long child name which must wrap on mobile',
            ])
          : null;
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Other Notifications'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
  test('routine labels never expose raw unknown event codes', () {
    expect(routineTitle('UNRECOGNIZED_CODE'), 'Child update');
    for (final kind in [
      'ABSENT',
      'CHECKED_OUT',
      'ATTENDANCE_ABSENCE_CORRECTED',
      'PICKUP_REJECTED',
      'PICKUP_EXPIRED',
    ]) {
      expect(routineTitle(kind), isNot(contains('_')));
      expect(routineMessage(update('id', kind)), contains('First Child'));
    }
  });
}
