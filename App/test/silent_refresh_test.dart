import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/backend.dart';
import 'package:final_project/core/widgets/backend_panels.dart';
import 'package:final_project/core/widgets/daily_activity_history.dart';
import 'package:final_project/screens/home/home_screen.dart';
import 'package:final_project/screens/map/stored_location_map.dart';

import 'support/backend_fixture.dart';
import 'support/memory_tile_provider.dart';

Map<String, dynamic> routine(String child) => {
  'id': 'saved-$child',
  'kind': 'PICKUP_COMPLETED',
  'createdAt': '2026-10-28T05:00:00Z',
  'child': {'id': child, 'name': child},
};

void main() {
  testWidgets(
    'authorization failure drops section caches before any subsequent network fallback',
    (tester) async {
      final fixture = useBackend(tester);
      var status = 200;
      fixture.respond = (r) => r.url.path.endsWith('/updates')
          ? status == 200
                ? BackendFixture.data([routine(BackendFixture.childId)])
                : BackendFixture.error(status, 'Unavailable')
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Pickup completed'), findsOneWidget);
      status = 403;
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.text('Pickup completed'), findsNothing);
      status = 503;
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.text('Pickup completed'), findsNothing);
      expect(find.text('Unable to load recent updates.'), findsOneWidget);
    },
  );
  testWidgets(
    'Parent Home keeps identical bounds and scroll during 66 seconds of automatic requests',
    (tester) async {
      final fixture = useBackend(tester);
      fixture.respondAsync = (request) async {
        if (request.url.path.endsWith('/updates')) {
          await Future<void>.delayed(const Duration(milliseconds: 400));
          return BackendFixture.data([routine(BackendFixture.childId)]);
        }
        return null;
      };
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      final targets = [
        find.byKey(const ValueKey('child-profile-avatar')),
        find.text('Danger Notifications'),
        find.text('Other Notifications'),
        find.text('Activity'),
      ];
      final positions = targets.map(tester.getTopLeft).toList();
      final scroll = tester
          .state<ScrollableState>(find.byType(Scrollable).first)
          .position;
      final offset = scroll.pixels;
      for (var i = 0; i < 22; i++) {
        await tester.pump(const Duration(seconds: 3));
        await tester.pump();
        expect(find.byType(LinearProgressIndicator), findsNothing);
        for (var n = 0; n < targets.length; n++) {
          expect(tester.getTopLeft(targets[n]), positions[n]);
        }
        expect(scroll.pixels, offset);
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump();
      }
      expect(
        fixture.requests.where((r) => r.url.path.endsWith('/updates')).length,
        greaterThan(20),
      );
    },
  );

  testWidgets(
    'partial Home refresh failure retains notifications in the same positions',
    (tester) async {
      final fixture = useBackend(tester);
      var fail = false;
      fixture.respond = (r) => r.url.path.endsWith('/updates')
          ? fail
                ? BackendFixture.error(503, 'Unavailable')
                : BackendFixture.data([routine(BackendFixture.childId)])
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      final point = tester.getTopLeft(find.text('Other Notifications'));
      final activityPoint = tester.getTopLeft(find.text('Activity'));
      fail = true;
      backendRefresh.value++;
      await tester.pumpAndSettle();
      expect(find.text('Pickup completed'), findsOneWidget);
      expect(
        find.text('Updates unavailable. Showing last received information.'),
        findsOneWidget,
      );
      expect(tester.getTopLeft(find.text('Other Notifications')), point);
      expect(tester.getTopLeft(find.text('Activity')), activityPoint);
      fail = false;
      await tapVisible(tester, find.byTooltip('Refresh'));
      expect(
        find.text('Updates unavailable. Showing last received information.'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'retained sections never follow the child selector into another child',
    (tester) async {
      final fixture = useBackend(tester);
      fixture.children.add({
        'id': BackendFixture.otherChildId,
        'name': 'Second child',
      });
      fixture.respond = (r) => r.url.path.endsWith('/updates')
          ? r.url.path.contains(BackendFixture.otherChildId)
                ? BackendFixture.error(503, 'Unavailable')
                : BackendFixture.data([routine(BackendFixture.childId)])
          : null;
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Pickup completed'), findsOneWidget);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Second child').last);
      await tester.pump();
      expect(find.text('Pickup completed'), findsNothing);
      await tester.pumpAndSettle();
      expect(find.text('Unable to load recent updates.'), findsOneWidget);
      expect(find.text('Pickup completed'), findsNothing);
    },
  );

  testWidgets(
    'pending refresh and errors preserve activity chart selection and map state',
    (tester) async {
      useBackend(tester);
      final history = jsonDecode(
        File('../backend/tests/fixtures/activity-history.contract.json')
            .readAsStringSync(),
      ) as Map<String, dynamic>;
      final tiles = MemoryTileProvider();
      Completer<String>? pending;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BackendFeed(
              load: () => pending?.future ?? Future.value('received'),
              builder: (context, value) => Column(
                children: [
                  DailyActivityHistory(activity: {'dailyHistory': history}),
                  StoredLocationMap(
                    latitude: 6.9,
                    longitude: 79.8,
                    childName: 'Fixture',
                    tileProvider: tiles,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('Last 21 Days'));
      final chart = tester.state(find.byType(DailyActivityHistory));
      final map = tester.state(find.byType(StoredLocationMap));
      pending = Completer<String>();
      backendRefresh.value++;
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(tester.state(find.byType(DailyActivityHistory)), same(chart));
      expect(tester.state(find.byType(StoredLocationMap)), same(map));
      pending.completeError(const ApiFailure('Offline'));
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(DailyActivityHistory)), same(chart));
      expect(tester.state(find.byType(StoredLocationMap)), same(map));
      expect(
        (tester.widget<ChoiceChip>(
          find.widgetWithText(ChoiceChip, 'Last 21 Days'),
        )).selected,
        isTrue,
      );
      pending = Completer<String>();
      await tester.ensureVisible(find.byTooltip('Refresh'));
      await tester.tap(find.byTooltip('Refresh'));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(tester.state(find.byType(StoredLocationMap)), same(map));
      pending.complete('fresh');
      await tester.pumpAndSettle();
      expect(find.byType(CircularProgressIndicator), findsNothing);
    },
  );

  testWidgets(
    'logout clears retained content immediately and ignores a late request',
    (tester) async {
      final fixture = useBackend(tester);
      Completer<String>? pending;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BackendFeed(
              load: () =>
                  pending?.future ?? Future.value('Protected saved data'),
              builder: (_, value) => Text('$value'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      pending = Completer<String>();
      backendRefresh.value++;
      await tester.pump();
      await fixture.session.logout();
      await tester.pump();
      expect(find.text('Protected saved data'), findsNothing);
      pending.complete('Obsolete protected data');
      await tester.pumpAndSettle();
      expect(find.text('Obsolete protected data'), findsNothing);
    },
  );
}
