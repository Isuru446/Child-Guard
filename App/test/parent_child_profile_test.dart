import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/widgets/parent_child_profile_card.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/history/history_screen.dart';

import 'support/backend_fixture.dart';

void main() {
  for (final width in [320.0, 390.0]) {
    testWidgets('integrated multi-child profile wraps long names at $width', (
      tester,
    ) async {
      final f = useBackend(tester);
      f.children.first['name'] =
          'A long authorized full child name which must remain readable';
      f.children.add({
        'id': BackendFixture.otherChildId,
        'name': 'Another long authorized full child name for this profile card',
      });
      tester.view.physicalSize = Size(width, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(ParentChildProfileCard), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text(f.children.last['name'] as String).last);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets(
    'Home profile uses authorized name and assignment with a default child avatar, without lower telemetry',
    (tester) async {
      final f = useBackend(tester);
      f.children.first.addAll({
        'name': 'Authorized Child',
        'dateOfBirth': '2022-03-01',
        'groupName': 'Saved group',
      });
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(ParentChildProfileCard), findsOneWidget);
      expect(find.text('Authorized Child'), findsOneWidget);
      expect(find.text('FIXTURE-WEARABLE'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('child-profile-avatar')),
        findsOneWidget,
      );
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      for (final text in [
        'Child details',
        "Today's attendance",
        "Today's Activity",
        'No recorded confirmation',
      ]) {
        expect(find.text(text), findsNothing);
      }
      for (final text in [
        'Birth date:',
        'GPS:',
        'Movement monitoring',
        'Sensor:',
        'Last communication:',
      ]) {
        expect(find.textContaining(text), findsNothing);
      }
      expect(find.text('Danger Notifications'), findsOneWidget);
      expect(find.text('Other Notifications'), findsOneWidget);
      expect(find.text('View All'), findsNWidgets(2));
      expect(
        tester.getTopLeft(find.byType(ParentChildProfileCard)).dy,
        lessThan(tester.getTopLeft(find.text('Danger Notifications')).dy),
      );
      expect(
        f.requests.any(
          (r) =>
              r.url.path.endsWith('/attendance') ||
              r.url.path.endsWith('/activity'),
        ),
        isFalse,
      );
      // The current schema has no child photograph. Do not request an adult or
      // Pickup photograph, or load a public image as a child profile substitute.
      expect(f.requests.any((r) => r.url.path.contains('/photos')), isFalse);
      expect(find.byType(Image), findsNothing);
    },
  );
  testWidgets(
    'unassigned and failed wearable reads are distinct and do not hide notifications',
    (tester) async {
      final f = useBackend(tester);
      var failed = false;
      f.respond = (r) => r.url.path.endsWith('/device')
          ? failed
                ? BackendFixture.error(503, 'unavailable')
                : BackendFixture.data(null)
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('No wearable assigned'), findsOneWidget);
      failed = true;
      await tapVisible(tester, find.byTooltip('Refresh'));
      expect(
        find.text('Updates unavailable. Showing last received information.'),
        findsOneWidget,
      );
      expect(find.text('No wearable assigned'), findsOneWidget);
      expect(find.text('Danger Notifications'), findsOneWidget);
      expect(find.text('Other Notifications'), findsOneWidget);
      expect(find.textContaining('Online'), findsNothing);
    },
  );
  testWidgets(
    'switching the integrated selector replaces the profile wearable with the selected child assignment',
    (tester) async {
      final f = useBackend(tester);
      f.children.add({
        'id': BackendFixture.otherChildId,
        'name': 'Second Child',
      });
      f.respond = (r) => r.url.path.endsWith('/device')
          ? BackendFixture.data({
              'hardwareId': r.url.path.contains(BackendFixture.otherChildId)
                  ? 'SECOND-WEARABLE'
                  : 'FIRST-WEARABLE',
              'connectionState': 'ONLINE',
              'lastSeen': '2020-01-01T00:00:00Z',
            })
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('FIRST-WEARABLE'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(ParentChildProfileCard),
          matching: find.byType(DropdownButtonFormField<String>),
        ),
        findsOneWidget,
      );
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Second Child').last);
      await tester.pumpAndSettle();
      expect(find.text('SECOND-WEARABLE'), findsOneWidget);
      expect(find.text('FIRST-WEARABLE'), findsNothing);
      expect(find.textContaining('Online'), findsNothing);
      expect(find.text('Danger Notifications'), findsOneWidget);
      expect(find.text('Other Notifications'), findsOneWidget);
    },
  );
  testWidgets(
    'Activity remains reachable in its existing dedicated history screen',
    (tester) async {
      final f = useBackend(tester);
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.textContaining('Movement monitoring'), findsNothing);
      await tapVisible(tester, find.text('Activity'));
      expect(find.byType(HistoryScreen), findsOneWidget);
      expect(find.text('Not enough data yet'), findsOneWidget);
      expect(f.requests.any((r) => r.url.path.endsWith('/activity')), isTrue);
    },
  );
}
